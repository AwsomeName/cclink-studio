import { BrowserManager } from '../browser/browser-manager'
import { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import { BrowserDownloadStore } from '../browser/browser-download-store'
import { BrowserAuthProcessService } from '../browser/browser-auth-process-service'
import { registerBrowserIpc } from '../ipc/browser-ipc'
import { BrowserInstanceStore } from '../persistence/browser-instance-store'
import { registerDialogIpc } from '../ipc/dialog-ipc'
import { registerWindowIpc } from '../ipc/window-ipc'
import { registerAndroidIpc } from '../ipc/android-ipc'
import { AdbBridge } from '../android/adb-bridge'
import { ActiveDeviceManager } from '../android/active-device-manager'
import { PhysicalDeviceManager } from '../android/physical-device-manager'
import { ScrcpyBridge } from '../android/scrcpy-bridge'
import { createMainWindow } from './main-window'
import { resolveMainRendererEntryUrl } from './main-window'
import {
  createTrustedRendererGuard,
  disposeTrustedIpcRegistrations,
} from '../ipc/trusted-renderer-guard'
import type { CclinkStudioRuntimeState } from './app-runtime'
import { runShutdownStep } from './shutdown'

interface CreateWindowRuntimeOptions {
  preloadPath: string
  rendererUrl?: string
  rendererHtmlPath: string
}

export interface WindowCapabilityBootstrappers {
  browser: (runtime: CclinkStudioRuntimeState) => void
  android: (runtime: CclinkStudioRuntimeState) => void
}

export function createWindowRuntime(
  runtime: CclinkStudioRuntimeState,
  options: CreateWindowRuntimeOptions,
): void {
  runtime.mainWindow = createMainWindow({
    isDev: runtime.isDev,
    preloadPath: options.preloadPath,
    rendererUrl: options.rendererUrl,
    rendererHtmlPath: options.rendererHtmlPath,
    appZoomLevel: runtime.settingsService?.getAll().appZoomLevel ?? 0,
  })
  runtime.trustedRendererGuard = createTrustedRendererGuard(
    runtime.mainWindow,
    resolveMainRendererEntryUrl({
      isDev: runtime.isDev,
      preloadPath: options.preloadPath,
      rendererUrl: options.rendererUrl,
      rendererHtmlPath: options.rendererHtmlPath,
    }),
  )

  runtime.mainWindow.on('closed', () => {
    runtime.mainWindow = null
  })

  registerDialogIpc(runtime.mainWindow, runtime.trustedRendererGuard)
  registerWindowIpc(runtime.mainWindow, runtime.trustedRendererGuard)
  bootstrapWindowCapabilities(runtime)
}

/** 设置主 renderer 缩放，并让已挂载的原生 Browser View 立即进入同一坐标系。 */
export function applyWindowZoomLevel(runtime: CclinkStudioRuntimeState, zoomLevel: number): void {
  const mainWindow = runtime.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.setZoomLevel(zoomLevel)
    runtime.browserManager?.refreshBoundsForWindowZoom()
  } catch (error) {
    console.warn('[CCLink Studio] 应用界面缩放失败，保留当前缩放:', error)
  }
}

export async function destroyWindowRuntime(runtime: CclinkStudioRuntimeState): Promise<void> {
  await runShutdownStep('BrowserAuthProcessService', () =>
    runtime.browserAuthProcessService?.destroy(),
  )
  await runShutdownStep('BrowserManager', () => runtime.browserManager?.destroy())
  await runShutdownStep('ScrcpyBridge', () => runtime.scrcpyBridge?.disconnect())
  await runShutdownStep('ActiveDeviceManager', () => runtime.activeDeviceManager?.destroy())
  await runShutdownStep('PhysicalDeviceManager', () => runtime.physicalDeviceManager?.disconnect())
  await runShutdownStep('IPC registrations', () =>
    disposeTrustedIpcRegistrations(runtime.trustedRendererGuard),
  )
  await runShutdownStep('MainWindow', () => {
    if (runtime.mainWindow && !runtime.mainWindow.isDestroyed()) runtime.mainWindow.destroy()
  })

  runtime.mainWindow = null
  runtime.trustedRendererGuard = null
  runtime.browserManager = null
  runtime.browserTaskRuntime = null
  runtime.browserDownloadStore = null
  runtime.browserAuthProcessService = null
  runtime.browserInstanceStore = null
  runtime.adbBridge = null
  runtime.scrcpyBridge = null
  runtime.activeDeviceManager = null
  runtime.physicalDeviceManager = null
}

export function bootstrapWindowCapabilities(
  runtime: CclinkStudioRuntimeState,
  overrides: Partial<WindowCapabilityBootstrappers> = {},
): void {
  if (!runtime.mainWindow || !runtime.settingsService || !runtime.trustedRendererGuard) {
    throw new Error('窗口能力依赖的主窗口、设置或可信 renderer 尚未初始化')
  }

  const bootstrappers: WindowCapabilityBootstrappers = {
    browser: bootstrapBrowserWindowCapability,
    android: bootstrapAndroidWindowCapability,
    ...overrides,
  }
  startWindowCapability(runtime, 'browser', bootstrappers.browser, '浏览器自动化尚未连接')
  startWindowCapability(runtime, 'android', bootstrappers.android, '未连接用户真机')
}

function bootstrapBrowserWindowCapability(runtime: CclinkStudioRuntimeState): void {
  const mainWindow = runtime.mainWindow
  const trustedRendererGuard = runtime.trustedRendererGuard
  if (!mainWindow || !trustedRendererGuard) throw new Error('Browser 窗口依赖尚未初始化')
  const settings = runtime.settingsService!.getAll()
  runtime.browserManager = new BrowserManager(mainWindow, {
    zoomMode: settings.defaultZoomMode,
    viewMode: settings.defaultDeviceMode,
  })
  runtime.browserInstanceStore = new BrowserInstanceStore()
  void runtime.browserInstanceStore
    .load()
    .then(() => runtime.browserInstanceStore?.clear())
    .catch((error) => console.error('[CCLink Studio] Browser 实例状态加载失败:', error))
  runtime.browserManager.attachInstanceStore(runtime.browserInstanceStore)
  runtime.browserAuthProcessService = new BrowserAuthProcessService(
    mainWindow,
    runtime.browserManager,
  )
  runtime.browserManager.attachBrowserAuthRequestHandler((request) =>
    runtime.browserAuthProcessService?.open(request),
  )
  runtime.browserTaskRuntime = new BrowserTaskRuntime(mainWindow)
  runtime.browserDownloadStore = new BrowserDownloadStore(
    mainWindow,
    () => runtime.settingsService?.getAll().lastWorkspacePath ?? null,
  )
  void runtime.browserDownloadStore
    .load()
    .catch((error) => console.error('[CCLink Studio] Browser 下载状态加载失败:', error))
  runtime.browserManager.onViewDestroyed((tabId) =>
    runtime.browserTaskRuntime?.cancelTasksForTab(tabId, 'tab_closed'),
  )
  registerBrowserIpc(
    runtime.browserManager,
    trustedRendererGuard,
    runtime.browserInstanceStore,
    runtime.browserTaskRuntime,
    runtime.browserDownloadStore,
    () => runtime.playwrightBridge,
  )
}

function bootstrapAndroidWindowCapability(runtime: CclinkStudioRuntimeState): void {
  const mainWindow = runtime.mainWindow
  const trustedRendererGuard = runtime.trustedRendererGuard
  if (!mainWindow || !trustedRendererGuard) throw new Error('Android 窗口依赖尚未初始化')
  runtime.adbBridge = new AdbBridge()
  runtime.scrcpyBridge = new ScrcpyBridge(mainWindow)
  runtime.activeDeviceManager = new ActiveDeviceManager()
  runtime.physicalDeviceManager = new PhysicalDeviceManager(
    runtime.adbBridge,
    runtime.activeDeviceManager,
  )
  registerAndroidIpc(
    runtime.adbBridge,
    mainWindow,
    runtime.scrcpyBridge,
    runtime.activeDeviceManager,
    runtime.physicalDeviceManager,
    trustedRendererGuard,
  )
  console.log('[CCLink Studio] Android 模块已注册（真机连接）')
}

function startWindowCapability(
  runtime: CclinkStudioRuntimeState,
  capability: 'browser' | 'android',
  bootstrap: (runtime: CclinkStudioRuntimeState) => void,
  unavailableReason: string,
): void {
  try {
    bootstrap(runtime)
    runtime.capabilities.unavailable(capability, unavailableReason)
  } catch (error) {
    resetWindowCapability(runtime, capability)
    runtime.capabilities.failed(capability, error)
    console.error(`[CCLink Studio] ${capability} 窗口能力初始化失败:`, error)
  }
}

function resetWindowCapability(
  runtime: CclinkStudioRuntimeState,
  capability: 'browser' | 'android',
): void {
  if (capability === 'browser') {
    try {
      runtime.browserAuthProcessService?.destroy()
    } catch {
      // 失败路径释放仅做 best effort。
    }
    try {
      runtime.browserManager?.destroy()
    } catch {
      // 失败路径释放仅做 best effort。
    }
    runtime.browserManager = null
    runtime.browserTaskRuntime = null
    runtime.browserDownloadStore = null
    runtime.browserAuthProcessService = null
    runtime.browserInstanceStore = null
    return
  }

  void runtime.scrcpyBridge?.disconnect().catch(() => undefined)
  try {
    runtime.activeDeviceManager?.destroy()
  } catch {
    // 失败路径释放仅做 best effort。
  }
  void runtime.physicalDeviceManager?.disconnect().catch(() => undefined)
  runtime.adbBridge = null
  runtime.scrcpyBridge = null
  runtime.activeDeviceManager = null
  runtime.physicalDeviceManager = null
}
