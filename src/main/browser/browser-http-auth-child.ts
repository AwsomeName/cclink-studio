import { BrowserWindow, ipcMain, session, type App, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  BROWSER_HTTP_AUTH_RESPONSE_CHANNEL,
  parseBrowserHttpAuthRendererResponse,
  type BrowserHttpAuthAcknowledgement,
  type BrowserHttpAuthChildMessage,
  type BrowserHttpAuthChildOptions,
} from '../../shared/ipc/browser-http-auth'

let activeBrowserHttpAuthWindow: BrowserWindow | null = null

export function configureBrowserHttpAuthChildApp(
  app: App,
  options: BrowserHttpAuthChildOptions,
): void {
  mkdirSync(options.userDataPath, { recursive: true })
  app.setName('CCLink Login')
  app.setPath('userData', options.userDataPath)
}

export async function runBrowserHttpAuthChild(options: BrowserHttpAuthChildOptions): Promise<void> {
  const authSession = session.fromPartition('cclink-browser-http-auth')
  const window = new BrowserWindow({
    title: `登录 ${options.origin}`,
    width: 500,
    height: options.transport === 'insecure-http' ? 500 : 430,
    minWidth: 440,
    minHeight: options.transport === 'insecure-http' ? 460 : 390,
    show: false,
    autoHideMenuBar: true,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    webPreferences: {
      session: authSession,
      preload: join(__dirname, '../preload/browserHttpAuth.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  activeBrowserHttpAuthWindow = window

  let completed = false
  let acknowledgementTimer: ReturnType<typeof setTimeout> | null = null
  const send = (message: BrowserHttpAuthChildMessage): void => {
    if (typeof process.send === 'function') process.send(message)
  }
  const cancel = (): void => {
    if (completed) return
    completed = true
    send({
      type: 'browser-http-auth-cancelled',
      requestId: options.requestId,
      tabId: options.tabId,
      runtimeGeneration: options.runtimeGeneration,
    })
  }

  const handleResponse = async (event: IpcMainInvokeEvent, input: unknown): Promise<void> => {
    if (
      completed ||
      event.sender !== window.webContents ||
      !event.senderFrame ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new Error('认证窗口响应已失效')
    }
    const response = parseBrowserHttpAuthRendererResponse(input)
    if (!response || response.requestId !== options.requestId) {
      throw new Error('认证窗口响应格式无效')
    }
    if (response.action === 'cancel') {
      cancel()
      window.close()
      return
    }
    if (options.transport === 'insecure-http' && !response.allowInsecure) {
      throw new Error('必须明确确认明文 HTTP 风险')
    }

    completed = true
    send({
      type: 'browser-http-auth-submitted',
      requestId: options.requestId,
      tabId: options.tabId,
      runtimeGeneration: options.runtimeGeneration,
      username: response.username,
      password: response.password,
    })
    acknowledgementTimer = setTimeout(() => {
      if (!window.isDestroyed()) window.close()
    }, 10_000)
  }

  ipcMain.handle(BROWSER_HTTP_AUTH_RESPONSE_CHANNEL, handleResponse)
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (acknowledgementTimer) clearTimeout(acknowledgementTimer)
    ipcMain.removeHandler(BROWSER_HTTP_AUTH_RESPONSE_CHANNEL)
    if (activeBrowserHttpAuthWindow === window) activeBrowserHttpAuthWindow = null
    cancel()
  })

  process.on('message', (message: BrowserHttpAuthAcknowledgement) => {
    if (message?.type !== 'browser-http-auth-ack' || message.requestId !== options.requestId) {
      return
    }
    if (acknowledgementTimer) clearTimeout(acknowledgementTimer)
    if (!window.isDestroyed()) window.close()
  })
  process.once('disconnect', () => {
    if (!window.isDestroyed()) window.close()
  })

  await window.loadURL(buildBrowserHttpAuthPage(options))
}

function buildBrowserHttpAuthPage(options: BrowserHttpAuthChildOptions): string {
  const insecure = options.transport === 'insecure-http'
  const loopback = options.transport === 'loopback-http'
  const retryNotice =
    options.attempt > 1
      ? `<p class="error" role="alert">上次用户名或密码不正确，请重新输入。</p>`
      : ''
  const transportNotice = insecure
    ? `<section class="warning" role="alert">
        <strong>此连接不安全</strong>
        <p>这个地址使用明文 HTTP，用户名和密码可能被同一网络中的其他人看到。推荐先配置 HTTPS。</p>
        <label><input id="allow-insecure" type="checkbox"> 我了解风险，仍然只提交这一次</label>
      </section>`
    : loopback
      ? `<p class="notice">这是本机 HTTP 地址，凭证仍未经过 TLS 加密。</p>`
      : `<p class="notice secure">连接使用 HTTPS。</p>`
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
    <meta name="cclink-http-auth-request-id" content="${escapeHtml(options.requestId)}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>登录受保护页面</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 28px; color: #202124; background: #f6f8fa; }
      main { max-width: 444px; margin: 0 auto; padding: 26px; background: #fff; border: 1px solid #d8dee4; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.12); }
      h1 { margin: 0 0 8px; font-size: 22px; }
      .origin { margin: 0 0 4px; overflow-wrap: anywhere; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: #0969da; }
      .realm { margin: 0 0 18px; color: #57606a; }
      label { display: block; margin: 12px 0 5px; font-size: 13px; font-weight: 600; }
      input[type="text"], input[type="password"] { width: 100%; padding: 10px 11px; border: 1px solid #afb8c1; border-radius: 6px; font: inherit; background: #fff; color: #202124; }
      input:focus { border-color: #0969da; outline: 2px solid rgba(9,105,218,.2); }
      .notice, .error, .warning { margin: 14px 0; padding: 10px 12px; border-radius: 6px; font-size: 13px; line-height: 1.45; }
      .notice { background: #ddf4ff; color: #0550ae; }
      .secure { background: #dafbe1; color: #116329; }
      .error { background: #ffebe9; color: #cf222e; }
      .warning { background: #fff8c5; color: #633c01; border: 1px solid #d4a72c; }
      .warning p { margin: 6px 0 10px; }
      .warning label { display: flex; gap: 8px; align-items: flex-start; margin: 0; font-weight: 500; }
      .warning input { margin-top: 3px; }
      .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
      button { padding: 9px 16px; border: 1px solid #afb8c1; border-radius: 6px; background: #f6f8fa; color: #24292f; font: inherit; cursor: pointer; }
      button.primary { border-color: #0969da; background: #0969da; color: #fff; }
      button:disabled { cursor: default; opacity: .55; }
      #status { min-height: 20px; margin-top: 10px; color: #57606a; font-size: 12px; }
      @media (prefers-color-scheme: dark) {
        body { color: #e6edf3; background: #0d1117; }
        main { background: #161b22; border-color: #30363d; }
        .realm, #status { color: #8b949e; }
        input[type="text"], input[type="password"] { color: #e6edf3; background: #0d1117; border-color: #6e7681; }
        button { color: #e6edf3; background: #21262d; border-color: #6e7681; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>登录受保护页面</h1>
      <p class="origin">${escapeHtml(options.origin)}</p>
      <p class="realm">服务器区域：${escapeHtml(options.realm)}</p>
      ${retryNotice}
      ${transportNotice}
      <form id="auth-form" autocomplete="off">
        <label for="username">用户名</label>
        <input id="username" type="text" autocomplete="off" maxlength="512" required>
        <label for="password">密码</label>
        <input id="password" type="password" autocomplete="new-password" maxlength="4096">
        <div class="actions">
          <button id="cancel" type="button">取消</button>
          <button id="submit" class="primary" type="submit">登录</button>
        </div>
        <div id="status" aria-live="polite"></div>
      </form>
    </main>
  </body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}
