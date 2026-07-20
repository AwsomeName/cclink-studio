import { BrowserWindow, type App, session } from 'electron'
import { mkdirSync } from 'node:fs'
import type {
  CleanBrowserChildOptions,
  CleanBrowserNavigateMessage,
} from './clean-browser-contract'
import { isSupportedCleanBrowserUrl } from './clean-browser-contract'

let activeCleanBrowserWindow: BrowserWindow | null = null

export function configureCleanBrowserChildApp(app: App, options: CleanBrowserChildOptions): void {
  mkdirSync(options.userDataPath, { recursive: true })
  app.setName('CCLink Login')
  app.setPath('userData', options.userDataPath)
}

export async function runCleanBrowserChild(options: CleanBrowserChildOptions): Promise<void> {
  if (!isSupportedCleanBrowserUrl(options.url)) throw new Error('不支持的登录 URL')

  const cleanSession = session.fromPartition('persist:cclink-clean-browser')
  const window = new BrowserWindow({
    title: 'CCLink 登录',
    width: 1100,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      session: cleanSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  activeCleanBrowserWindow = window
  let storageFlushed = false

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSupportedCleanBrowserUrl(url)) void window.loadURL(url).catch(() => undefined)
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (storageFlushed) return
    event.preventDefault()
    storageFlushed = true
    void Promise.all([cleanSession.cookies.flushStore(), cleanSession.flushStorageData()]).finally(
      () => {
        if (!window.isDestroyed()) window.destroy()
      },
    )
  })
  window.on('closed', () => {
    if (activeCleanBrowserWindow === window) activeCleanBrowserWindow = null
  })
  process.on('message', (message: CleanBrowserNavigateMessage) => {
    if (message?.type !== 'clean-browser-navigate' || !isSupportedCleanBrowserUrl(message.url)) {
      return
    }
    if (!window.isVisible()) window.show()
    window.focus()
    void window.loadURL(message.url).catch((error) => {
      console.error('[CleanBrowser] 页面加载失败:', error)
    })
  })

  await window.loadURL(options.url).catch((error) => {
    console.error('[CleanBrowser] 登录页面加载失败:', error)
    if (!window.isVisible()) window.show()
  })
}
