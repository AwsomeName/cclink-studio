/**
 * window-ipc — 窗口控制 IPC 处理器
 *
 * 提供窗口相关的 IPC channel：
 * - window:toggleFullscreen — 切换全屏
 * - window:toggleDevtools   — 切换开发者工具
 * - window:reload           — 重新加载窗口
 * - window:focusRenderer    — 从内嵌视图把原生焦点切回工作台
 */

import type { BrowserWindow } from 'electron'
import { windowIpc } from '../../shared/ipc/window'
import { windowIpcEvents } from '../../shared/ipc/window'
import { keyChordFromKeyboardEvent, type KeyChord } from '../../shared/keybindings'
import type { TrustedRendererGuard } from './trusted-renderer-guard'
import { registerTrustedIpcContract } from './trusted-renderer-guard'

export function registerWindowIpc(
  mainWindow: BrowserWindow,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  let shortcutCaptureSession: { id: string; expiresAt: number } | null = null
  let shortcutCaptureTimer: NodeJS.Timeout | null = null
  const clearShortcutCapture = (): void => {
    shortcutCaptureSession = null
    if (shortcutCaptureTimer) clearTimeout(shortcutCaptureTimer)
    shortcutCaptureTimer = null
  }

  const interceptNativeCaptureShortcut = (event: Electron.Event, input: Electron.Input): void => {
    const session = shortcutCaptureSession
    if (!session || Date.now() >= session.expiresAt || input.type !== 'keyDown') {
      if (session && Date.now() >= session.expiresAt) clearShortcutCapture()
      return
    }
    const primary = process.platform === 'darwin' ? input.meta : input.control
    if (!primary || (input.code !== 'KeyQ' && input.code !== 'KeyW')) return
    const chord = keyChordFromKeyboardEvent(
      {
        code: input.code,
        metaKey: input.meta,
        ctrlKey: input.control,
        altKey: input.alt,
        shiftKey: input.shift,
      },
      process.platform === 'darwin',
    ) as KeyChord | null
    if (!chord) return
    event.preventDefault()
    mainWindow.webContents.send(windowIpcEvents.shortcutCaptureInput, {
      sessionId: session.id,
      chord,
    })
  }
  mainWindow.webContents.on('before-input-event', interceptNativeCaptureShortcut)
  mainWindow.on('blur', clearShortcutCapture)
  mainWindow.on('closed', clearShortcutCapture)

  /** 切换全屏 */
  registerTrustedIpcContract(windowIpc.toggleFullscreen, trustedRendererGuard, () => {
    if (mainWindow.isDestroyed()) return { success: false }
    mainWindow.setFullScreen(!mainWindow.isFullScreen())
    return { success: true, fullscreen: mainWindow.isFullScreen() }
  })

  /** 切换开发者工具 */
  registerTrustedIpcContract(windowIpc.toggleDevtools, trustedRendererGuard, () => {
    if (mainWindow.isDestroyed()) return { success: false }
    mainWindow.webContents.toggleDevTools()
    return { success: true }
  })

  /** 重新加载窗口 */
  registerTrustedIpcContract(windowIpc.reload, trustedRendererGuard, () => {
    if (mainWindow.isDestroyed()) return { success: false }
    mainWindow.reload()
    return { success: true }
  })

  registerTrustedIpcContract(windowIpc.focusRenderer, trustedRendererGuard, () => {
    if (mainWindow.isDestroyed()) return { success: false }
    mainWindow.webContents.focus()
    return { success: true }
  })

  registerTrustedIpcContract(
    windowIpc.setShortcutCaptureGuard,
    trustedRendererGuard,
    (_event, input) => {
      if (mainWindow.isDestroyed()) return { success: false }
      if (!input.active) {
        if (shortcutCaptureSession?.id === input.sessionId) clearShortcutCapture()
        return { success: true }
      }
      clearShortcutCapture()
      shortcutCaptureSession = { id: input.sessionId, expiresAt: Date.now() + input.timeoutMs }
      shortcutCaptureTimer = setTimeout(clearShortcutCapture, input.timeoutMs)
      return { success: true }
    },
  )

  console.log('[WindowIPC] 窗口控制 IPC 已注册')
}
