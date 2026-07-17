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
import { createMainWindow } from './main-window'
import type { CclinkStudioRuntimeState } from './app-runtime'

interface CreateWindowRuntimeOptions {
  preloadPath: string
  rendererUrl?: string
  rendererHtmlPath: string
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
  })

  runtime.mainWindow.on('closed', () => {
    runtime.mainWindow = null
  })

  const settings = runtime.settingsService!.getAll()
  runtime.browserManager = new BrowserManager(runtime.mainWindow, {
    zoomMode: settings.defaultZoomMode,
    viewMode: settings.defaultDeviceMode,
  })

  runtime.browserInstanceStore = new BrowserInstanceStore()
  void runtime.browserInstanceStore.load().then(() => runtime.browserInstanceStore?.clear())
  runtime.browserManager.attachInstanceStore(runtime.browserInstanceStore)
  runtime.browserTaskRuntime = new BrowserTaskRuntime(runtime.mainWindow)
  runtime.browserDownloadStore = new BrowserDownloadStore(
    runtime.mainWindow,
    () => runtime.settingsService?.getAll().lastWorkspacePath ?? null,
  )
  void runtime.browserDownloadStore.load()
  runtime.browserManager.onViewDestroyed((tabId) =>
    runtime.browserTaskRuntime?.cancelTasksForTab(tabId, 'tab_closed'),
  )
  registerBrowserIpc(
    runtime.browserManager,
    runtime.browserInstanceStore,
    runtime.browserTaskRuntime,
    runtime.browserDownloadStore,
    () => runtime.playwrightBridge,
  )

  registerDialogIpc(runtime.mainWindow)
  registerWindowIpc(runtime.mainWindow)

  runtime.adbBridge = new AdbBridge()
  runtime.scrcpyBridge = new ScrcpyBridge(runtime.mainWindow)
  runtime.activeDeviceManager = new ActiveDeviceManager()
  runtime.physicalDeviceManager = new PhysicalDeviceManager(
    runtime.adbBridge,
    runtime.activeDeviceManager,
  )
  registerAndroidIpc(
    runtime.adbBridge,
    runtime.mainWindow,
    runtime.scrcpyBridge,
    runtime.activeDeviceManager,
    runtime.physicalDeviceManager,
  )
  console.log('[CCLink Studio] Android 模块已注册（真机连接）')
}
