/**
 * window-ipc — 窗口控制 IPC 处理器
 *
 * 提供窗口相关的 IPC channel：
 * - window:toggleFullscreen — 切换全屏
 * - window:toggleDevtools   — 切换开发者工具
 * - window:reload           — 重新加载窗口
 * - window:focusRenderer    — 从内嵌视图把原生焦点切回工作台
 */

import { ipcMain, type BrowserWindow } from 'electron'

export function registerWindowIpc(mainWindow: BrowserWindow): void {
  /** 切换全屏 */
  ipcMain.handle('window:toggleFullscreen', () => {
    if (mainWindow.isDestroyed()) return { success: false }
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
    return { success: true, fullscreen: mainWindow.isFullScreen() }
  })

  /** 切换开发者工具 */
  ipcMain.handle('window:toggleDevtools', () => {
    if (mainWindow.isDestroyed()) return { success: false }
    mainWindow.webContents.toggleDevTools()
    return { success: true }
  })

  /** 重新加载窗口 */
  ipcMain.handle('window:reload', () => {
    if (mainWindow.isDestroyed()) return { success: false }
    mainWindow.reload()
    return { success: true }
  })

  ipcMain.handle('window:focusRenderer', (event) => {
    if (mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      return { success: false }
    }
    mainWindow.webContents.focus()
    return { success: true }
  })

  console.log('[WindowIPC] 窗口控制 IPC 已注册')
}
