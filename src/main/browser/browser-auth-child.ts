import { BrowserWindow, type App, type Cookie, session } from 'electron'
import { mkdirSync } from 'node:fs'
import type {
  BrowserAuthAcknowledgement,
  BrowserAuthChildMessage,
  BrowserAuthChildOptions,
  BrowserAuthCompleteMessage,
  BrowserAuthCookie,
} from './browser-auth-contract'
import {
  isAllowedBrowserAuthCookie,
  isRetryableBrowserAuthFailure,
  isSupportedBrowserAuthRequest,
  resolveBrowserAuthReturnUrl,
} from './browser-auth-contract'

const V2EX_URL = 'https://www.v2ex.com/'
const V2EX_AUTH_COOKIE = 'A2'
const MAX_NAVIGATION_RETRIES = 4
let activeBrowserAuthWindow: BrowserWindow | null = null

export function configureBrowserAuthChildApp(app: App, options: BrowserAuthChildOptions): void {
  mkdirSync(options.userDataPath, { recursive: true })
  app.setName('CCLink Login')
  app.setPath('userData', options.userDataPath)
}

export async function runBrowserAuthChild(options: BrowserAuthChildOptions): Promise<void> {
  if (!isSupportedBrowserAuthRequest(options)) {
    throw new Error('不支持的浏览器登录请求')
  }

  const authSession = session.fromPartition(`persist:cclink-browser-auth-${options.profileId}`)
  const window = new BrowserWindow({
    title: '登录 V2EX',
    width: 1100,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      session: authSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  activeBrowserAuthWindow = window

  let completed = false
  let acknowledgementTimer: ReturnType<typeof setTimeout> | null = null
  let navigationRetryCount = 0
  let navigationRetryTimer: ReturnType<typeof setTimeout> | null = null

  const send = (message: BrowserAuthChildMessage): void => {
    if (typeof process.send === 'function') process.send(message)
  }

  const finish = async (): Promise<void> => {
    if (completed) return
    const cookies = await authSession.cookies.get({ url: V2EX_URL })
    if (!cookies.some((cookie) => cookie.name === V2EX_AUTH_COOKIE)) return

    completed = true
    await authSession.cookies.flushStore()
    await authSession.flushStorageData()
    const message: BrowserAuthCompleteMessage = {
      type: 'browser-auth-complete',
      tabId: options.tabId,
      profileId: options.profileId,
      returnUrl: resolveBrowserAuthReturnUrl(options.profileId, window.webContents.getURL()),
      cookies: cookies
        .map(serializeCookie)
        .filter((cookie) => isAllowedBrowserAuthCookie(options.profileId, cookie)),
    }
    send(message)

    acknowledgementTimer = setTimeout(() => {
      if (!window.isDestroyed()) window.close()
    }, 10_000)
  }

  authSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (!removed && cookie.name === V2EX_AUTH_COOKIE) void finish()
  })
  window.webContents.on('did-navigate', (_event, url) => {
    try {
      const hostname = new URL(url).hostname
      if (
        hostname === 'accounts.google.com' ||
        hostname === 'v2ex.com' ||
        hostname.endsWith('.v2ex.com')
      ) {
        navigationRetryCount = 0
      }
    } catch {
      // Ignore non-URL navigation targets.
    }
    void finish()
  })
  window.webContents.on('did-navigate-in-page', () => void finish())
  window.webContents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame || !window.webContents.getURL().startsWith('data:text/html')) return
    try {
      if (new URL(url).hostname === 'accounts.google.com') navigationRetryCount = 0
    } catch {
      // Ignore non-URL navigation targets.
    }
  })
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (!isRetryableBrowserAuthFailure(options.profileId, validatedURL, errorCode, isMainFrame)) {
        return
      }

      if (navigationRetryCount >= MAX_NAVIGATION_RETRIES) {
        void showCallbackFailure(window, options.url)
        return
      }

      const retryDelay = 750 * 2 ** navigationRetryCount
      navigationRetryCount += 1
      console.warn(
        `[BrowserAuth] 登录页面连接失败，${retryDelay}ms 后进行第 ${navigationRetryCount} 次重试`,
      )
      if (navigationRetryTimer) clearTimeout(navigationRetryTimer)
      navigationRetryTimer = setTimeout(() => {
        if (!window.isDestroyed()) void window.loadURL(validatedURL).catch(() => undefined)
      }, retryDelay)
    },
  )
  window.webContents.setWindowOpenHandler(({ url }) => {
    void window.loadURL(url)
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (acknowledgementTimer) clearTimeout(acknowledgementTimer)
    if (navigationRetryTimer) clearTimeout(navigationRetryTimer)
    if (activeBrowserAuthWindow === window) activeBrowserAuthWindow = null
    if (!completed) {
      send({
        type: 'browser-auth-cancelled',
        tabId: options.tabId,
        profileId: options.profileId,
      })
    }
  })

  process.on('message', (message: BrowserAuthAcknowledgement) => {
    if (message?.type !== 'browser-auth-ack') return
    if (acknowledgementTimer) clearTimeout(acknowledgementTimer)
    if (!window.isDestroyed()) window.close()
  })

  const existingCookies = await authSession.cookies.get({ url: V2EX_URL })
  const startUrl = existingCookies.some((cookie) => cookie.name === V2EX_AUTH_COOKIE)
    ? V2EX_URL
    : options.url
  await window.loadURL(startUrl).catch(() => undefined)
  await finish()
}

async function showCallbackFailure(window: BrowserWindow, restartUrl: string): Promise<void> {
  const escapedRestartUrl = JSON.stringify(restartUrl).replace(/</g, '\\u003c')
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <title>V2EX 登录连接失败</title>
    <style>
      body { margin: 0; font: 16px -apple-system, BlinkMacSystemFont, sans-serif; color: #202124; background: #f6f8fa; }
      main { max-width: 560px; margin: 18vh auto 0; padding: 32px; background: white; border: 1px solid #d8dee4; border-radius: 8px; }
      h1 { margin: 0 0 16px; font-size: 24px; }
      p { line-height: 1.6; color: #57606a; }
      button { margin-top: 12px; padding: 10px 18px; border: 0; border-radius: 6px; color: white; background: #0969da; font: inherit; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>V2EX 登录连接失败</h1>
      <p>登录页面已经自动重试 ${MAX_NAVIGATION_RETRIES} 次。请检查网络后重新发起 Google 登录。</p>
      <button id="retry" type="button">重新登录</button>
    </main>
    <script>document.getElementById('retry').addEventListener('click', () => { location.href = ${escapedRestartUrl} })</script>
  </body>
</html>`
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function serializeCookie(cookie: Cookie): BrowserAuthCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? '',
    path: cookie.path ?? '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    session: Boolean(cookie.session),
    sameSite: cookie.sameSite,
    ...(typeof cookie.expirationDate === 'number' ? { expirationDate: cookie.expirationDate } : {}),
  }
}
