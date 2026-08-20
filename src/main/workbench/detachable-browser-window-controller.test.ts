import { describe, expect, it, vi } from 'vitest'
import { DetachableBrowserWindowController } from './detachable-browser-window-controller'
import { WorkbenchWindowService } from './workbench-window-service'

type Listener = (...args: any[]) => void

function fakeWindow() {
  const listeners = new Map<string, Listener[]>()
  const webContentsListeners = new Map<string, Listener[]>()
  const webContents = {
    send: vi.fn(),
    isDestroyed: vi.fn(() => false),
    on: vi.fn((event: string, listener: Listener) => {
      webContentsListeners.set(event, [...(webContentsListeners.get(event) ?? []), listener])
    }),
    emit(event: string, ...args: any[]) {
      for (const listener of webContentsListeners.get(event) ?? []) listener(...args)
    },
  }
  const window = {
    webContents,
    show: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    }),
    emit(event: string, ...args: any[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
  }
  return window
}

function createHarness(
  options: {
    ready?: boolean
    createWindowFails?: boolean
    attachFails?: boolean
    loseBothHostsOnAttach?: boolean
  } = {},
) {
  const mainWindow = fakeWindow()
  const auxiliaryWindow = fakeWindow()
  const windowService = new WorkbenchWindowService()
  windowService.registerWindow({
    windowId: 'main',
    role: 'main',
    workspaceKey: '/workspace/a',
    state: 'ready',
  })
  const ownerByTab = new Map([['browser-1', 'main']])
  const mainWorkspaceListeners = new Set<(workspaceKey: string | null) => void>()
  const browserManager = {
    getViewOwnerWindowId: vi.fn((tabId: string) => ownerByTab.get(tabId) ?? null),
    getHostWorkspaceKey: vi.fn(() => '/workspace/a'),
    onMainWorkspaceChanged: vi.fn((callback: (workspaceKey: string | null) => void) => {
      mainWorkspaceListeners.add(callback)
      callback('/workspace/a')
      return () => mainWorkspaceListeners.delete(callback)
    }),
    registerHost: vi.fn(),
    unregisterHost: vi.fn(),
    transferViewToHost: vi.fn((tabId: string, source: string, target: string) => {
      if (ownerByTab.get(tabId) !== source) throw new Error('wrong source')
      if (options.attachFails && source === 'main' && target.startsWith('aux-')) {
        throw new Error('target attach failed')
      }
      if (options.loseBothHostsOnAttach && source === 'main' && target.startsWith('aux-')) {
        windowService.closeWindow('main', true)
        windowService.closeWindow(target, true)
        throw new Error('attach failed after source loss')
      }
      ownerByTab.set(tabId, target)
    }),
    updateBoundsForWindow: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
  }
  const tabModel = {
    getProjection: vi.fn().mockResolvedValue({
      workspaceKey: '/workspace/a',
      ownerKey: null,
      revision: 1,
      tabs: [{ id: 'browser-1', type: 'browser', title: 'Example', icon: '🌐' }],
      activeTabId: 'browser-1',
    }),
    getBrowserProjection: vi.fn().mockResolvedValue({
      workspaceKey: '/workspace/a',
      ownerKey: null,
      revision: 1,
      tabs: {
        'browser-1': {
          url: 'https://example.com',
          urlInput: 'https://example.com',
          viewMode: 'desktop',
          zoomMode: 'fit',
          zoomFactor: 1,
          history: ['https://example.com'],
          historyIndex: 0,
          ready: false,
        },
      },
    }),
  }
  const trustedRenderers = {
    register: vi.fn(() => vi.fn()),
    ipcRegistrations: { handle: vi.fn() },
  }
  const recoveryHosts = { recover: vi.fn(), restore: vi.fn(), destroy: vi.fn() }
  const controllerRef: { current?: DetachableBrowserWindowController } = {}
  const createAuxiliaryWindow = vi.fn((windowId: string) => {
    if (options.createWindowFails) throw new Error('native window creation failed')
    return {
      window: auxiliaryWindow,
      rendererEntryUrl: 'file:///renderer/index.html#auxiliary',
      load: vi.fn(async () => {
        if (!options.ready) return
        queueMicrotask(() => {
          ;(controllerRef.current as any).auxiliaryReady(
            { windowId, role: 'auxiliary', webContents: auxiliaryWindow.webContents },
            { windowId, generation: 1 },
          )
        })
      }),
    }
  })
  const controller = new DetachableBrowserWindowController({
    mainWindow: mainWindow as never,
    browserManager: browserManager as never,
    tabModel: tabModel as never,
    windowService,
    trustedRenderers: trustedRenderers as never,
    recoveryHosts: recoveryHosts as never,
    createAuxiliaryWindow: createAuxiliaryWindow as never,
    readyTimeoutMs: 20,
  })
  controllerRef.current = controller
  return {
    controller,
    mainWindow,
    auxiliaryWindow,
    windowService,
    browserManager,
    ownerByTab,
    recoveryHosts,
    mainWorkspaceListeners,
  }
}

describe('DetachableBrowserWindowController', () => {
  it('keeps the main WindowService workspace projection synchronized in the main process', () => {
    const harness = createHarness()
    for (const listener of harness.mainWorkspaceListeners) listener('/workspace/b')
    expect(harness.windowService.getWindow('main')?.workspaceKey).toBe('/workspace/b')
    harness.controller.destroy()
    expect(harness.mainWorkspaceListeners.size).toBe(0)
  })

  it('moves Browser runtime after auxiliary ready and returns it without destroying the tab', async () => {
    const harness = createHarness({ ready: true })
    const moved = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(moved.success).toBe(true)
    if (!moved.success) return
    const auxiliaryId = moved.projection.window.windowId
    expect(harness.ownerByTab.get('browser-1')).toBe(auxiliaryId)
    expect(harness.auxiliaryWindow.show).toHaveBeenCalledOnce()
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: auxiliaryId,
      generation: 2,
    })

    const returned = await harness.controller.returnTabToMain({
      tabId: 'browser-1',
      sourceWindowId: auxiliaryId,
      expectedGeneration: 2,
    })

    expect(returned.success).toBe(true)
    expect(harness.ownerByTab.get('browser-1')).toBe('main')
    expect(harness.auxiliaryWindow.destroy).toHaveBeenCalledOnce()
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: 'main',
      generation: 3,
    })
  })

  it('rolls a ready timeout back to main and publishes the new generation for retry', async () => {
    const harness = createHarness()
    const result = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(result).toMatchObject({ success: false, error: { code: 'target-not-ready' } })
    expect(harness.ownerByTab.get('browser-1')).toBe('main')
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: 'main',
      generation: 2,
      state: 'attached',
    })
    expect(harness.mainWindow.webContents.send).toHaveBeenCalledWith(
      'workbenchWindow:placementChanged',
      expect.objectContaining({ tabId: 'browser-1', generation: 2, windowId: 'main' }),
    )
  })

  it('reports native window creation failure without moving the runtime', async () => {
    const harness = createHarness({ createWindowFails: true })
    const result = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(result).toMatchObject({ success: false, error: { code: 'window-create-failed' } })
    expect(harness.ownerByTab.get('browser-1')).toBe('main')
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({ windowId: 'main' })
  })

  it('rolls a target attach failure back while the source remains available', async () => {
    const harness = createHarness({ ready: true, attachFails: true })
    const result = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(result).toMatchObject({ success: false, error: { code: 'attach-failed' } })
    expect(harness.ownerByTab.get('browser-1')).toBe('main')
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: 'main',
      state: 'attached',
    })
    expect(harness.auxiliaryWindow.destroy).toHaveBeenCalledOnce()
  })

  it('compensates the native owner when move commit fails after attach', async () => {
    const harness = createHarness({ ready: true })
    vi.spyOn(harness.windowService, 'commitTransfer').mockImplementationOnce(() => {
      throw new Error('commit persistence failed')
    })
    const result = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(result).toMatchObject({ success: false, error: { code: 'attach-failed' } })
    expect(harness.ownerByTab.get('browser-1')).toBe('main')
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: 'main',
      state: 'attached',
    })
    expect(harness.browserManager.transferViewToHost).toHaveBeenCalledTimes(2)
  })

  it('compensates back to the auxiliary owner when return commit fails', async () => {
    const harness = createHarness({ ready: true })
    const moved = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })
    expect(moved.success).toBe(true)
    if (!moved.success) return
    vi.spyOn(harness.windowService, 'commitTransfer').mockImplementationOnce(() => {
      throw new Error('return commit failed')
    })

    const result = await harness.controller.returnTabToMain({
      tabId: 'browser-1',
      sourceWindowId: moved.projection.window.windowId,
      expectedGeneration: 2,
    })

    expect(result).toMatchObject({ success: false, error: { code: 'attach-failed' } })
    expect(harness.ownerByTab.get('browser-1')).toBe(moved.projection.window.windowId)
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: moved.projection.window.windowId,
      state: 'attached',
    })
    expect(harness.auxiliaryWindow.destroy).not.toHaveBeenCalled()
  })

  it('returns a detached runtime after the auxiliary renderer crashes', async () => {
    const harness = createHarness({ ready: true })
    const moved = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })
    expect(moved.success).toBe(true)
    if (!moved.success) return

    harness.auxiliaryWindow.webContents.emit('render-process-gone')
    await vi.waitFor(() => expect(harness.ownerByTab.get('browser-1')).toBe('main'))
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: 'main',
      state: 'attached',
    })
  })

  it('records a Recovery Host placement when attach fails after both user hosts are lost', async () => {
    const harness = createHarness({ ready: true, loseBothHostsOnAttach: true })
    harness.recoveryHosts.recover.mockImplementationOnce((tabId: string) => {
      harness.ownerByTab.set(tabId, `recovery:${tabId}`)
      return `recovery:${tabId}`
    })

    const result = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(result.success).toBe(false)
    expect(harness.recoveryHosts.recover).toHaveBeenCalledWith('browser-1', 'main', '/workspace/a')
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: 'recovery:browser-1',
      generation: 2,
      state: 'recovering',
    })
  })
})
