import { BrowserWindow, screen, session, type Session } from 'electron'
import { pathToFileURL } from 'node:url'
import type { WorkbenchWindowDropPoint } from '../../shared/ipc/workbench-window'
import { isAllowedMainRendererUrl } from '../ipc/trusted-renderer-guard'
import { buildMainRendererCsp } from '../runtime/main-window'
import { APP_DISPLAY_NAME } from '../runtime/app-metadata'
import {
  defaultAuxiliaryWindowSize,
  resolveAuxiliaryWindowBounds,
} from './auxiliary-window-placement'

export interface AuxiliaryBrowserWindowOptions {
  isDev: boolean
  preloadPath: string
  rendererUrl?: string
  rendererHtmlPath: string
  dropPoint?: WorkbenchWindowDropPoint
}

export interface AuxiliaryBrowserWindowHandle {
  window: BrowserWindow
  rendererEntryUrl: string
  load: () => Promise<void>
}

const configuredSessions = new WeakSet<Session>()

/** Creates a hidden, renderer-minimal auxiliary shell. Loading is deferred until trust is registered. */
export function createAuxiliaryBrowserWindow(
  options: AuxiliaryBrowserWindowOptions,
): AuxiliaryBrowserWindowHandle {
  const rendererEntryUrl = resolveAuxiliaryRendererEntryUrl(options)
  const auxiliarySession = session.fromPartition('cclink-auxiliary-ui')
  installAuxiliaryRendererCsp(auxiliarySession, rendererEntryUrl, options.isDev)
  const initialBounds = options.dropPoint
    ? resolveAuxiliaryWindowBounds(
        options.dropPoint,
        screen.getDisplayNearestPoint(options.dropPoint).workArea,
      )
    : defaultAuxiliaryWindowSize
  const window = new BrowserWindow({
    ...initialBounds,
    minWidth: Math.min(560, initialBounds.width),
    minHeight: Math.min(360, initialBounds.height),
    show: false,
    title: `${APP_DISPLAY_NAME} — 浏览器`,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: options.preloadPath,
      session: auxiliarySession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedMainRendererUrl(targetUrl, rendererEntryUrl)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return {
    window,
    rendererEntryUrl,
    load: async () => {
      if (options.isDev && options.rendererUrl) {
        await window.loadURL(rendererEntryUrl)
      } else {
        await window.loadFile(options.rendererHtmlPath, { hash: 'auxiliary' })
      }
    },
  }
}

function resolveAuxiliaryRendererEntryUrl(options: AuxiliaryBrowserWindowOptions): string {
  if (options.isDev && options.rendererUrl) {
    const url = new URL(options.rendererUrl)
    url.hash = 'auxiliary'
    return url.href
  }
  const url = new URL(pathToFileURL(options.rendererHtmlPath).href)
  url.hash = 'auxiliary'
  return url.href
}

function installAuxiliaryRendererCsp(
  auxiliarySession: Session,
  rendererEntryUrl: string,
  isDev: boolean,
): void {
  if (configuredSessions.has(auxiliarySession)) return
  configuredSessions.add(auxiliarySession)
  const csp = buildMainRendererCsp(rendererEntryUrl, isDev)
  const entry = new URL(rendererEntryUrl)
  const urls = entry.protocol === 'file:' ? ['file:///*'] : [`${entry.origin}/*`]
  auxiliarySession.webRequest.onHeadersReceived({ urls }, (details, callback) => {
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
}
