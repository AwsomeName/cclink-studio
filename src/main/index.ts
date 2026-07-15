import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { cleanupIpcHandlers } from './ipc/ipc-cleanup'
import { configureAppCommandLine, ensureSingleInstance, registerProcessErrorHandlers } from './runtime/app-lifecycle'
import { createRuntimeState } from './runtime/app-runtime'
import { createWindowRuntime } from './runtime/window-runtime'
import { bootstrapRuntime } from './runtime/bootstrap-runtime'
import { shutdownRuntime } from './runtime/shutdown-runtime'
import { configureFixedUserDataPath } from './runtime/user-data-path'

configureFixedUserDataPath(app)
ensureSingleInstance(app)
configureAppCommandLine(app)
registerProcessErrorHandlers()

const runtime = createRuntimeState(!app.isPackaged)
const windowOptions = {
  preloadPath: join(__dirname, '../preload/index.js'),
  rendererUrl: process.env['ELECTRON_RENDERER_URL'],
  rendererHtmlPath: join(__dirname, '../renderer/index.html'),
}

app.whenReady().then(async () => {
  await bootstrapRuntime(runtime, windowOptions)

  app.on('activate', () => {
    // macOS: 点击 Dock 图标时触发。CCLink Studio 当前 window-all-closed 会退出，通常不会走到这里。
    if (BrowserWindow.getAllWindows().length === 0) {
      cleanupIpcHandlers()
      createWindowRuntime(runtime, windowOptions)
    }
  })

  app.on('second-instance', () => {
    if (runtime.mainWindow) {
      if (runtime.mainWindow.isMinimized()) runtime.mainWindow.restore()
      runtime.mainWindow.focus()
    }
  })
})

let shutdownStarted = false

/**
 * 清理所有资源并退出。
 * will-quit 会阻止默认退出以等待异步清理，避免 Playwright/MCP/scrcpy/adb 留下孤儿进程。
 */
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
