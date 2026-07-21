import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { cleanupIpcHandlers } from './ipc/ipc-cleanup'
import {
  configureAppCommandLine,
  ensureSingleInstance,
  registerProcessErrorHandlers,
} from './runtime/app-lifecycle'
import { createRuntimeState } from './runtime/app-runtime'
import { createWindowRuntime } from './runtime/window-runtime'
import { bootstrapRuntime } from './runtime/bootstrap-runtime'
import { shutdownRuntime } from './runtime/shutdown-runtime'
import { configureFixedUserDataPath } from './runtime/user-data-path'
import { parseBrowserAuthChildOptions } from './browser/browser-auth-contract'
import { configureBrowserAuthChildApp, runBrowserAuthChild } from './browser/browser-auth-child'
import { parseCleanBrowserChildOptions } from './browser/clean-browser-contract'
import { configureCleanBrowserChildApp, runCleanBrowserChild } from './browser/clean-browser-child'
import { parseTerminalBrowserOpenUrl } from './terminal/terminal-browser-launcher'

const browserAuthChildOptions = parseBrowserAuthChildOptions(process.argv)
const cleanBrowserChildOptions = parseCleanBrowserChildOptions(process.argv)

if (browserAuthChildOptions) {
  startBrowserAuthChild()
} else if (cleanBrowserChildOptions) {
  startCleanBrowserChild()
} else {
  startMainApplication()
}

function startBrowserAuthChild(): void {
  configureBrowserAuthChildApp(app, browserAuthChildOptions!)
  registerProcessErrorHandlers()

  void app.whenReady().then(async () => {
    await runBrowserAuthChild(browserAuthChildOptions!)
  })
  app.on('window-all-closed', () => app.quit())
}

function startCleanBrowserChild(): void {
  configureCleanBrowserChildApp(app, cleanBrowserChildOptions!)
  registerProcessErrorHandlers()

  void app.whenReady().then(async () => {
    await runCleanBrowserChild(cleanBrowserChildOptions!)
  })
  app.on('window-all-closed', () => app.quit())
}

function startMainApplication(): void {
  configureFixedUserDataPath(
    app,
    app.isPackaged ? undefined : process.env['CCLINK_STUDIO_TEST_USER_DATA_PATH'],
  )
  if (!ensureSingleInstance(app)) return
  configureAppCommandLine(app)
  registerProcessErrorHandlers()

  const runtime = createRuntimeState(!app.isPackaged)
  const windowOptions = {
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererUrl: process.env['ELECTRON_RENDERER_URL'],
    rendererHtmlPath: join(__dirname, '../renderer/index.html'),
  }

  void app.whenReady().then(async () => {
    await bootstrapRuntime(runtime, windowOptions)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        cleanupIpcHandlers()
        createWindowRuntime(runtime, windowOptions)
      }
    })

    app.on('second-instance', (_event, commandLine) => {
      const terminalUrl = parseTerminalBrowserOpenUrl(commandLine)
      if (terminalUrl) {
        runtime.browserAuthProcessService?.openExternalUrl(terminalUrl)
        return
      }
      if (runtime.mainWindow) {
        if (runtime.mainWindow.isMinimized()) runtime.mainWindow.restore()
        runtime.mainWindow.focus()
      }
    })
  })

  let shutdownStarted = false

  async function gracefulShutdown(): Promise<void> {
    if (shutdownStarted) return
    shutdownStarted = true

    console.log('[CCLink Studio] 开始优雅退出...')
    await shutdownRuntime(runtime)
    console.log('[CCLink Studio] 优雅退出完成')
  }

  app.on('will-quit', async (event) => {
    event.preventDefault()
    try {
      await gracefulShutdown()
    } catch (error) {
      console.error('[CCLink Studio] 优雅退出失败:', error)
    }
    app.exit(0)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
