import { describe, expect, it, vi } from 'vitest'
import { createRuntimeState } from './app-runtime'
import {
  applyWindowZoomLevel,
  bootstrapWindowCapabilities,
  handleMainWindowClosed,
} from './window-runtime'

describe('bootstrapWindowCapabilities', () => {
  it('continues Android startup after Browser initialization fails', () => {
    const runtime = createReadyRuntime()
    const destroyBrowser = vi.fn(() => {
      throw new Error('cleanup failed')
    })
    const startAndroid = vi.fn()

    bootstrapWindowCapabilities(runtime, {
      browser: (state) => {
        state.browserManager = { destroy: destroyBrowser } as never
        throw new Error('browser view bootstrap failed')
      },
      android: (state) => {
        startAndroid()
        state.adbBridge = {} as never
      },
    })

    expect(destroyBrowser).toHaveBeenCalledOnce()
    expect(runtime.browserManager).toBeNull()
    expect(runtime.capabilities.get('browser')).toMatchObject({
      state: 'failed',
      reason: 'browser view bootstrap failed',
    })
    expect(startAndroid).toHaveBeenCalledOnce()
    expect(runtime.capabilities.get('android')).toMatchObject({
      state: 'unavailable',
      reason: '未连接用户真机',
    })
  })

  it('continues Browser startup after Android initialization fails', () => {
    const runtime = createReadyRuntime()
    const startBrowser = vi.fn()
    const destroyDevice = vi.fn()

    bootstrapWindowCapabilities(runtime, {
      browser: (state) => {
        startBrowser()
        state.browserManager = {} as never
      },
      android: (state) => {
        state.activeDeviceManager = { destroy: destroyDevice } as never
        throw new Error('adb bridge bootstrap failed')
      },
    })

    expect(startBrowser).toHaveBeenCalledOnce()
    expect(runtime.capabilities.get('browser')).toMatchObject({
      state: 'unavailable',
      reason: '浏览器自动化尚未连接',
    })
    expect(destroyDevice).toHaveBeenCalledOnce()
    expect(runtime.activeDeviceManager).toBeNull()
    expect(runtime.capabilities.get('android')).toMatchObject({
      state: 'failed',
      reason: 'adb bridge bootstrap failed',
    })
  })
})

describe('applyWindowZoomLevel', () => {
  it('updates the main renderer and immediately refreshes native browser bounds', () => {
    const runtime = createRuntimeState(true)
    const setZoomLevel = vi.fn()
    const refreshBoundsForWindowZoom = vi.fn()
    runtime.mainWindow = {
      isDestroyed: () => false,
      webContents: { setZoomLevel },
    } as never
    runtime.browserManager = { refreshBoundsForWindowZoom } as never

    applyWindowZoomLevel(runtime, -1)

    expect(setZoomLevel).toHaveBeenCalledWith(-1)
    expect(refreshBoundsForWindowZoom).toHaveBeenCalledOnce()
  })
})

describe('handleMainWindowClosed', () => {
  it('requests app shutdown even while auxiliary windows still exist', () => {
    const runtime = createRuntimeState(true)
    const closeWindow = vi.fn()
    const destroyDetachableWindows = vi.fn()
    const requestQuit = vi.fn()
    runtime.mainWindow = {} as never
    runtime.workbenchWindowService = {
      getWindow: () => ({ state: 'ready' }),
      closeWindow,
    } as never
    runtime.detachableBrowserWindows = { destroy: destroyDetachableWindows } as never

    handleMainWindowClosed(runtime, requestQuit)

    expect(closeWindow).toHaveBeenCalledWith('main')
    expect(destroyDetachableWindows).toHaveBeenCalledOnce()
    expect(runtime.detachableBrowserWindows).toBeNull()
    expect(runtime.mainWindow).toBeNull()
    expect(requestQuit).toHaveBeenCalledOnce()
  })
})

function createReadyRuntime() {
  const runtime = createRuntimeState(true)
  runtime.mainWindow = {} as never
  runtime.settingsService = {} as never
  runtime.trustedRendererGuard = {} as never
  return runtime
}
