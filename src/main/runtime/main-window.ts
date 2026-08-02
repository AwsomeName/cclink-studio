import { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { APP_DISPLAY_NAME } from './app-metadata'
import { isAllowedMainRendererUrl } from '../ipc/trusted-renderer-guard'

interface CreateMainWindowOptions {
  isDev: boolean
  preloadPath: string
  rendererUrl?: string
  rendererHtmlPath: string
  appZoomLevel?: number
}

/** 创建 CCLink Studio 主窗口并加载 renderer，不负责业务 runtime 装配。 */
export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
  const rendererEntryUrl = resolveMainRendererEntryUrl(options)
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    title: APP_DISPLAY_NAME,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: options.preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  installMainRendererCsp(window, rendererEntryUrl, options.isDev)
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedMainRendererUrl(targetUrl, rendererEntryUrl)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.setZoomLevel(options.appZoomLevel ?? 0)

  if (options.isDev && options.rendererUrl) {
    void window.loadURL(options.rendererUrl)
  } else {
    void window.loadFile(options.rendererHtmlPath)
  }

  window.on('ready-to-show', () => {
    if (!window.isDestroyed()) window.show()
  })

  return window
}

export function resolveMainRendererEntryUrl(options: CreateMainWindowOptions): string {
  if (options.isDev && options.rendererUrl) return options.rendererUrl
  return pathToFileURL(options.rendererHtmlPath).href
}

export function buildMainRendererCsp(rendererEntryUrl: string, isDev: boolean): string {
  const entry = new URL(rendererEntryUrl)
  const developmentSources = isDev
    ? ` ${entry.origin} ${entry.protocol === 'https:' ? 'wss:' : 'ws:'}//${entry.host}`
    : ''
  const scriptSources = isDev ? "'self' 'unsafe-inline'" : "'self'"
  return [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${developmentSources}`,
    "worker-src 'self' blob:",
    "frame-src 'self' data: blob:",
    'object-src data:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

function installMainRendererCsp(
  window: BrowserWindow,
  rendererEntryUrl: string,
  isDev: boolean,
): void {
  const csp = buildMainRendererCsp(rendererEntryUrl, isDev)
  const entry = new URL(rendererEntryUrl)
  const urls = entry.protocol === 'file:' ? ['file:///*'] : [`${entry.origin}/*`]
  const webRequest = window.webContents.session.webRequest
  webRequest.onHeadersReceived({ urls }, (details, callback) => {
    if (
      details.resourceType !== 'mainFrame' ||
      !isAllowedMainRendererUrl(details.url, rendererEntryUrl)
    ) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    const responseHeaders = { ...details.responseHeaders }
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase() === 'content-security-policy') delete responseHeaders[key]
    }
    responseHeaders['Content-Security-Policy'] = [csp]
    callback({ responseHeaders })
  })
  window.on('closed', () => webRequest.onHeadersReceived(null))
}
