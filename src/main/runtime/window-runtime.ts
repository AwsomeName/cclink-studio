import { BrowserManager } from '../browser/browser-manager'
import { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import { BrowserDownloadStore } from '../browser/browser-download-store'
import { registerBrowserIpc } from '../ipc/browser-ipc'
import { BrowserInstanceStore } from '../persistence/browser-instance-store'
import { registerDialogIpc } from '../ipc/dialog-ipc'
import { registerWindowIpc } from '../ipc/window-ipc'
import { registerAndroidIpc } from '../ipc/android-ipc'
import { AdbBridge } from '../android/adb-bridge'
import { ActiveDeviceManager } from '../android/active-device-manager'
import { PhysicalDeviceManager } from '../android/physical-device-manager'
import { ScrcpyBridge } from '../android/scrcpy-bridge'
import { CclinkStore } from '../cclink/cclink-store'
import { CclinkFileService } from '../cclink/cclink-file-service'
import { CclinkProtocolRouter } from '../cclink/cclink-protocol-router'
import { CclinkRealtimeService } from '../cclink/cclink-realtime-service'
import { CclinkRequestRouter } from '../cclink/cclink-request-router'
import { CclinkIdentityStore } from '../cclink/cclink-identity-store'
import { CclinkIdentityService } from '../cclink/cclink-identity-service'
import { registerCclinkIpc } from '../ipc/cclink-ipc'
import { createMainWindow } from './main-window'
import { refreshAccessToken } from './auth-refresh'
import type { DeepInkRuntimeState } from './app-runtime'

interface CreateWindowRuntimeOptions {
  preloadPath: string
  rendererUrl?: string
  rendererHtmlPath: string
}

export function createWindowRuntime(runtime: DeepInkRuntimeState, options: CreateWindowRuntimeOptions): void {
  runtime.mainWindow = createMainWindow({
    isDev: runtime.isDev,
    preloadPath: options.preloadPath,
    rendererUrl: options.rendererUrl,
    rendererHtmlPath: options.rendererHtmlPath,
  })

  runtime.mainWindow.on('closed', () => {
    runtime.mainWindow = null
  })

  const settings = runtime.settingsService!.getAll()
  runtime.browserManager = new BrowserManager(runtime.mainWindow, {
    zoomMode: settings.defaultZoomMode,
    viewMode: settings.defaultDeviceMode,
  })
  runtime.browserManager.createView('browser', 'https://www.baidu.com')
  runtime.browserManager.setActive('browser')

  runtime.browserInstanceStore = new BrowserInstanceStore()
  void runtime.browserInstanceStore.load()
  runtime.browserManager.attachInstanceStore(runtime.browserInstanceStore)
  runtime.browserTaskRuntime = new BrowserTaskRuntime(runtime.mainWindow)
  runtime.browserDownloadStore = new BrowserDownloadStore(
    runtime.mainWindow,
    () => runtime.settingsService?.getAll().lastWorkspacePath ?? null,
  )
  void runtime.browserDownloadStore.load()
  runtime.browserManager.onViewDestroyed((tabId) => runtime.browserTaskRuntime?.cancelTasksForTab(tabId, 'tab_closed'))
  registerBrowserIpc(runtime.browserManager, runtime.browserInstanceStore, runtime.browserTaskRuntime, runtime.browserDownloadStore)

  runtime.cclinkStore = new CclinkStore()
  void runtime.cclinkStore.load()
  runtime.cclinkRequestRouter = new CclinkRequestRouter()
  runtime.cclinkProtocolRouter = new CclinkProtocolRouter(runtime.cclinkStore)
  runtime.cclinkFileService = new CclinkFileService(runtime.cclinkStore, runtime.cclinkRequestRouter)
  runtime.cclinkIdentityStore = new CclinkIdentityStore()
  void runtime.cclinkIdentityStore.load()
  runtime.cclinkIdentityService = new CclinkIdentityService(runtime.cclinkIdentityStore, () => runtime.tokenManager, {
    refreshAccessToken: () => refreshAccessToken(runtime),
  })
  runtime.cclinkRealtimeService = new CclinkRealtimeService(
    runtime.cclinkIdentityService,
    runtime.cclinkRequestRouter,
    runtime.cclinkProtocolRouter,
  )
  registerCclinkIpc(
    runtime.cclinkStore,
    runtime.cclinkIdentityService,
    runtime.cclinkFileService,
    runtime.cclinkRealtimeService,
  )

  registerDialogIpc(runtime.mainWindow)
  registerWindowIpc(runtime.mainWindow)

  runtime.adbBridge = new AdbBridge()
  runtime.scrcpyBridge = new ScrcpyBridge(runtime.mainWindow)
  runtime.activeDeviceManager = new ActiveDeviceManager()
  runtime.physicalDeviceManager = new PhysicalDeviceManager(runtime.adbBridge, runtime.activeDeviceManager)
  registerAndroidIpc(
    runtime.adbBridge,
    runtime.mainWindow,
    runtime.scrcpyBridge,
    runtime.activeDeviceManager,
    runtime.physicalDeviceManager,
  )
  console.log('[DeepInk] Android 模块已注册（模拟器路径已封存，仅真机连接可用）')
}
