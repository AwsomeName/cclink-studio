import { BrowserWindow } from 'electron'

interface CreateMainWindowOptions {
  isDev: boolean
  preloadPath: string
  rendererUrl?: string
  rendererHtmlPath: string
}

/** 创建 CCLink Studio 主窗口并加载 renderer，不负责业务 runtime 装配。 */
export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    title: 'CCLink Studio',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: options.preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

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
