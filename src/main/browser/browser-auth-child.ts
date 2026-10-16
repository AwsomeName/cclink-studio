import { BrowserWindow, type App, type Cookie, session } from 'electron'
import { mkdirSync } from 'node:fs'
import { normalizeDesktopUserAgent } from './browser-stealth'
import type {
  BrowserAuthAcknowledgement,
  BrowserAuthChildMessage,
  BrowserAuthChildOptions,
  BrowserAuthCompleteMessage,
  BrowserAuthCookie,
  BrowserAuthFocusMessage,
} from './browser-auth-contract'
import {
  browserAuthCookieName,
  isAllowedBrowserAuthCookie,
  isRetryableBrowserAuthFailure,
  isSupportedBrowserAuthRequest,
  resolveBrowserAuthReturnUrl,
} from './browser-auth-contract'

const V2EX_URL = 'https://www.v2ex.com/'
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
  const siteUrl = options.provider === 'bigmodel' ? 'https://bigmodel.cn/' : V2EX_URL
  const authCookieName = browserAuthCookieName(options.provider)
  const identity = {
    requestId: options.requestId,
    tabId: options.tabId,
    profileId: options.profileId,
    runtimeGeneration: options.runtimeGeneration,
    provider: options.provider,
  }
  const window = new BrowserWindow({
    title: options.provider === 'bigmodel' ? '登录智谱 BigModel' : '登录 V2EX',
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
  if (options.provider === 'bigmodel') {
    window.webContents.setUserAgent(normalizeDesktopUserAgent(window.webContents.getUserAgent()))
  }

  let completed = false
  let completing = false
  let acknowledgementTimer: ReturnType<typeof setTimeout> | null = null
  let navigationRetryCount = 0
  let navigationRetryTimer: ReturnType<typeof setTimeout> | null = null

  const send = (message: BrowserAuthChildMessage): void => {
    if (typeof process.send === 'function') process.send(message)
  }

  const finish = async (): Promise<void> => {
    if (completed || completing || window.isDestroyed()) return
    // A token alone is not a successful BigModel login: wait for the site to leave /login.
    if (options.provider === 'bigmodel') {
      try {
        const current = new URL(window.webContents.getURL())
        if (current.origin !== 'https://bigmodel.cn' || /^\/login\/?$/.test(current.pathname))
          return
      } catch {
        return
      }
    }
    completing = true
    try {
      const cookies = (await authSession.cookies.get({ url: siteUrl }))
        .map(serializeCookie)
        .filter((cookie) => isAllowedBrowserAuthCookie(options.provider, cookie))
      if (
        window.isDestroyed() ||
        !cookies.some(
          (cookie) =>
            cookie.name === authCookieName &&
            cookie.value &&
            (cookie.expirationDate === undefined || cookie.expirationDate > Date.now() / 1000),
        )
      )
        return
      await authSession.cookies.flushStore()
      await authSession.flushStorageData()
      if (window.isDestroyed()) return
      completed = true
      const message: BrowserAuthCompleteMessage = {
        type: 'browser-auth-complete',
        ...identity,
        returnUrl: resolveBrowserAuthReturnUrl(options.provider, window.webContents.getURL()),
        cookies,
      }
      send(message)

      acknowledgementTimer = setTimeout(() => {
        if (!window.isDestroyed()) window.close()
      }, 10_000)
    } finally {
      completing = false
    }
  }

  authSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (!removed && cookie.name === authCookieName) void finish()
  })
  window.webContents.on('did-navigate', (_event, url) => {
    try {
      const hostname = new URL(url).hostname
      if (
        options.provider === 'v2ex' &&
        (hostname === 'accounts.google.com' ||
          hostname === 'v2ex.com' ||
          hostname.endsWith('.v2ex.com'))
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
    if (
      options.provider !== 'v2ex' ||
      !isMainFrame ||
      !window.webContents.getURL().startsWith('data:text/html')
    )
      return
    try {
      if (new URL(url).hostname === 'accounts.google.com') navigationRetryCount = 0
    } catch {
      // Ignore non-URL navigation targets.
    }
  })
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (!isRetryableBrowserAuthFailure(options.provider, validatedURL, errorCode, isMainFrame)) {
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
  const isAllowedNavigation = (value: string): boolean => {
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password) return false
      if (options.provider === 'v2ex') return true
      return ['bigmodel.cn', 'open.weixin.qq.com', 'mp.weixin.qq.com'].includes(url.hostname)
    } catch {
      return false
    }
  }
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) void window.loadURL(url).catch(() => undefined)
    return { action: 'deny' }
  })
  window.webContents.on('page-title-updated', (event) => event.preventDefault())
  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })
  window.on('closed', () => {
    if (acknowledgementTimer) clearTimeout(acknowledgementTimer)
    if (navigationRetryTimer) clearTimeout(navigationRetryTimer)
    if (activeBrowserAuthWindow === window) activeBrowserAuthWindow = null
    if (!completed) {
      send({
        type: 'browser-auth-cancelled',
        ...identity,
      })
    }
  })

  process.on('message', async (message: BrowserAuthAcknowledgement | BrowserAuthFocusMessage) => {
    if (message?.type === 'browser-auth-focus' && message.requestId === options.requestId) {
      if (!window.isDestroyed()) {
        window.show()
        window.focus()
      }
      return
    }
    if (message?.type !== 'browser-auth-ack' || message.requestId !== options.requestId) return
    if (acknowledgementTimer) clearTimeout(acknowledgementTimer)
    // The main Profile owns the durable BigModel login. Keep device/session compatibility
    // data in this process, but do not resurrect a logged-out account from a second token.
    if (options.provider === 'bigmodel') {
      try {
        await authSession.cookies.remove(siteUrl, authCookieName)
        await authSession.cookies.flushStore()
      } catch {
        console.error('[BrowserAuth] 认证临时登录状态清理失败')
      }
    }
    if (!window.isDestroyed()) window.close()
  })

  const existingCookies = await authSession.cookies.get({ url: siteUrl })
  const startUrl =
    options.provider === 'v2ex' && existingCookies.some((cookie) => cookie.name === authCookieName)
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
