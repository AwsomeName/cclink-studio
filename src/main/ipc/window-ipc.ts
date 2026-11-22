/**
 * window-ipc — 窗口控制 IPC 处理器
 *
 * 提供窗口相关的 IPC channel：
 * - window:toggleFullscreen — 切换全屏
 * - window:setFullscreen    — 设置全屏并返回之前的状态
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
    if (
      input.type === 'keyDown' &&
      !input.isAutoRepeat &&
      (input.key === 'Escape' || input.code === 'Escape') &&
      input.meta &&
      !input.alt &&
      !input.control &&
      !input.shift &&
      mainWindow.isFullScreen()
    ) {
      // Notify the workbench even when the native key equivalent bypasses DOM keydown.
      mainWindow.webContents.send(windowIpcEvents.fullscreenExit)
    }
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

  const foreground = (): boolean =>
    !mainWindow.isDestroyed() &&
    mainWindow.isFocused() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized()
  const notify = (): void => {
    if (!mainWindow.isDestroyed())
      mainWindow.webContents.send(windowIpcEvents.foregroundChanged, foreground())
  }
  mainWindow.on('focus', notify)
  mainWindow.on('blur', notify)
  mainWindow.on('minimize', notify)
  mainWindow.on('restore', notify)
  mainWindow.on('show', notify)
  mainWindow.on('hide', notify)
  registerTrustedIpcContract(windowIpc.isForeground, trustedRendererGuard, foreground)

  // macOS updates isFullScreen() asynchronously. If the user reverses direction
  // during the animation, apply the latest request when the transition completes.
  let requestedFullscreen: boolean | null = null
  const setFullscreen = (fullscreen: boolean) => {
    if (mainWindow.isDestroyed()) return { success: false }
    const transitioning = requestedFullscreen !== null
    const previous = requestedFullscreen ?? mainWindow.isFullScreen()
    if (previous !== fullscreen) {
      requestedFullscreen = fullscreen
      if (!transitioning) mainWindow.setFullScreen(fullscreen)
    }
    return { success: true, fullscreen, previous }
  }
  const finishFullscreenTransition = (actual: boolean): void => {
    if (requestedFullscreen === null) return
    if (requestedFullscreen === actual) requestedFullscreen = null
    else mainWindow.setFullScreen(requestedFullscreen)
  }
  mainWindow.on('enter-full-screen', () => finishFullscreenTransition(true))
  mainWindow.on('leave-full-screen', () => {
    finishFullscreenTransition(false)
    if (requestedFullscreen !== true) mainWindow.webContents.send(windowIpcEvents.fullscreenExit)
  })

  registerTrustedIpcContract(windowIpc.toggleFullscreen, trustedRendererGuard, () => {
    if (mainWindow.isDestroyed()) return { success: false }
    return setFullscreen(!(requestedFullscreen ?? mainWindow.isFullScreen()))
  })

  registerTrustedIpcContract(windowIpc.setFullscreen, trustedRendererGuard, (_event, fullscreen) =>
    setFullscreen(fullscreen),
  )

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

  registerTrustedIpcContract(windowIpc.requestClose, trustedRendererGuard, () => {
    if (mainWindow.isDestroyed()) return { success: false }
    mainWindow.close()
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
