import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMainDiagnosticLogSnapshot,
  resetMainDiagnosticLogForTest,
} from '../diagnostics/main-diagnostic-log'
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
    removeListener: vi.fn((event: string, listener: Listener) => {
      webContentsListeners.set(
        event,
        (webContentsListeners.get(event) ?? []).filter((candidate) => candidate !== listener),
      )
    }),
    emit(event: string, ...args: any[]) {
      for (const listener of webContentsListeners.get(event) ?? []) listener(...args)
    },
  }
  const window = {
    webContents,
    getBounds: vi.fn(() => ({ x: 100, y: 80, width: 1200, height: 800 })),
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
    windowRegistrationFails?: boolean
    registerHostFails?: boolean
    trustRegistrationFails?: boolean
    attachFails?: boolean
    loseBothHostsOnAttach?: boolean
    cursorPoint?: { x: number; y: number }
    tabDescriptorMissing?: boolean
    browserProjectionMissing?: boolean
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
  if (options.windowRegistrationFails) {
    const registerWindow = windowService.registerWindow.bind(windowService)
    vi.spyOn(windowService, 'registerWindow').mockImplementation((input) => {
      const registered = registerWindow(input)
      if (input.role === 'auxiliary') throw new Error('window ledger registration failed')
      return registered
    })
  }
  const ownerByTab = new Map([['browser-1', 'main']])
  const registeredHosts = new Set<string>()
  const mainWorkspaceListeners = new Set<(workspaceKey: string | null) => void>()
  const browserManager = {
    getViewOwnerWindowId: vi.fn((tabId: string) => ownerByTab.get(tabId) ?? null),
    getActiveViewIdForWindow: vi.fn(
      (windowId: string) => [...ownerByTab].find(([, owner]) => owner === windowId)?.[0] ?? null,
    ),
    getHostWorkspaceKey: vi.fn(() => '/workspace/a'),
    onMainWorkspaceChanged: vi.fn((callback: (workspaceKey: string | null) => void) => {
      mainWorkspaceListeners.add(callback)
      callback('/workspace/a')
      return () => mainWorkspaceListeners.delete(callback)
    }),
    registerHost: vi.fn((windowId: string) => {
      registeredHosts.add(windowId)
      if (options.registerHostFails) throw new Error('host registration failed')
    }),
    unregisterHost: vi.fn((windowId: string) => {
      registeredHosts.delete(windowId)
      return []
    }),
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
    getRuntimeIdentity: vi.fn((tabId: string) =>
      ownerByTab.has(tabId) ? { tabId, workspaceKey: '/workspace/a', runtimeGeneration: 1 } : null,
    ),
  }
  const tabModel = {
    getProjection: vi.fn().mockResolvedValue({
      workspaceKey: '/workspace/a',
      ownerKey: null,
      revision: 1,
      tabs: options.tabDescriptorMissing
        ? []
        : [{ id: 'browser-1', type: 'browser', title: 'Example', icon: '🌐' }],
      activeTabId: options.tabDescriptorMissing ? null : 'browser-1',
    }),
    getBrowserProjection: vi.fn().mockResolvedValue({
      workspaceKey: '/workspace/a',
      ownerKey: null,
      revision: 1,
      tabs: options.browserProjectionMissing
        ? {}
        : {
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
    assertRole: vi.fn(() => ({
      windowId: 'main',
      role: 'main',
      webContents: mainWindow.webContents,
    })),
    register: vi.fn(() => {
      if (options.trustRegistrationFails) throw new Error('trust registration failed')
      return vi.fn()
    }),
    ipcRegistrations: { handle: vi.fn() },
  }
  const recoveryHosts = { recover: vi.fn(), restore: vi.fn(), destroy: vi.fn() }
  recoveryHosts.recover.mockImplementation((tabId: string) => {
    ownerByTab.set(tabId, `recovery:${tabId}`)
    return `recovery:${tabId}`
  })
  recoveryHosts.restore.mockImplementation((tabId: string, targetWindowId: string) => {
    ownerByTab.set(tabId, targetWindowId)
  })
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
    getCursorScreenPoint: () => options.cursorPoint ?? { x: 1400, y: 300 },
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
    registeredHosts,
    createAuxiliaryWindow,
    mainWorkspaceListeners,
    trustedRenderers,
  }
}

describe('DetachableBrowserWindowController', () => {
  beforeEach(() => resetMainDiagnosticLogForTest())

  it('keeps the main WindowService workspace projection synchronized in the main process', () => {
    const harness = createHarness()
    for (const listener of harness.mainWorkspaceListeners) listener('/workspace/b')
    expect(harness.windowService.getWindow('main')?.workspaceKey).toBe('/workspace/b')
    harness.controller.destroy()
    expect(harness.mainWorkspaceListeners.size).toBe(0)
  })

  it('does not touch main WebContents listeners after the native window is destroyed', () => {
    const harness = createHarness()
    harness.mainWindow.webContents.isDestroyed.mockReturnValue(true)

    expect(() => harness.controller.destroy()).not.toThrow()
    expect(harness.mainWindow.webContents.removeListener).not.toHaveBeenCalled()
  })

  it('arbitrates pointer release in main against native BrowserWindow bounds', async () => {
    const outside = createHarness({ cursorPoint: { x: -600, y: 300 } })
    outside.controller.registerIpc()
    const outsideBegin = outside.trustedRenderers.ipcRegistrations.handle.mock.calls.find(
      ([channel]) => channel === 'workbenchWindow:beginTabDetachDrag',
    )?.[1]
    const outsideFinish = outside.trustedRenderers.ipcRegistrations.handle.mock.calls.find(
      ([channel]) => channel === 'workbenchWindow:finishTabDetachDrag',
    )?.[1]
    await outsideBegin?.({}, { tabId: 'browser-1' })
    expect(await outsideFinish?.({}, { tabId: 'browser-1' })).toEqual({ x: -600, y: 300 })
    expect(outside.mainWindow.getBounds).toHaveBeenCalled()

    const inside = createHarness({ cursorPoint: { x: 500, y: 300 } })
    inside.controller.registerIpc()
    const insideBegin = inside.trustedRenderers.ipcRegistrations.handle.mock.calls.find(
      ([channel]) => channel === 'workbenchWindow:beginTabDetachDrag',
    )?.[1]
    const insideFinish = inside.trustedRenderers.ipcRegistrations.handle.mock.calls.find(
      ([channel]) => channel === 'workbenchWindow:finishTabDetachDrag',
    )?.[1]
    await insideBegin?.({}, { tabId: 'browser-1' })
    expect(await insideFinish?.({}, { tabId: 'browser-1' })).toBeNull()
  })

  it('uses the native main-process mouse-up event when renderer pointer-up is absent', async () => {
    const harness = createHarness({ cursorPoint: { x: 1400, y: 300 } })
    harness.controller.registerIpc()
    const begin = harness.trustedRenderers.ipcRegistrations.handle.mock.calls.find(
      ([channel]) => channel === 'workbenchWindow:beginTabDetachDrag',
    )?.[1]
    await begin?.({}, { tabId: 'browser-1' })

    harness.mainWindow.webContents.emit(
      'before-mouse-event',
      {},
      {
        type: 'mouseUp',
        button: 'left',
        x: 0,
        y: 0,
      },
    )

    expect(harness.mainWindow.webContents.send).toHaveBeenCalledWith(
      'workbenchWindow:tabDetachReleased',
      { tabId: 'browser-1', dropPoint: { x: 1400, y: 300 } },
    )
  })

  it('moves Browser runtime after auxiliary ready and returns it without destroying the tab', async () => {
    const harness = createHarness({ ready: true })
    const moved = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
      dropPoint: { x: 2100, y: 300 },
    })

    expect(moved.success).toBe(true)
    if (!moved.success) return
    const auxiliaryId = moved.projection.window.windowId
    expect(harness.ownerByTab.get('browser-1')).toBe(auxiliaryId)
    expect(harness.createAuxiliaryWindow).toHaveBeenCalledWith(auxiliaryId, {
      x: 2100,
      y: 300,
    })
    expect(harness.auxiliaryWindow.show).toHaveBeenCalledOnce()
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: auxiliaryId,
      generation: 2,
    })
    expect(moved.projection.placements).toEqual([
      expect.objectContaining({ tabId: 'browser-1', windowId: auxiliaryId, active: true }),
    ])

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
    expect(harness.windowService.getTransfer(moved.transferId)).toBeNull()
    if (returned.success) expect(harness.windowService.getTransfer(returned.transferId)).toBeNull()
    expect(harness.windowService.getWindow(auxiliaryId)).toBeNull()
    const transferLogs = getMainDiagnosticLogSnapshot().entries.filter((entry) =>
      entry.message.includes('[WorkbenchTransfer]'),
    )
    expect(transferLogs).toHaveLength(2)
    expect(transferLogs[0]?.message).toContain('"identityMatched":true')
    expect(transferLogs[0]?.message).toContain('"finalOwnerWindowId":"' + auxiliaryId + '"')
    expect(transferLogs[0]?.message).toContain('"phaseDurationsMs"')
  })

  it('moves a transient Browser runtime that is intentionally absent from persisted TabModel', async () => {
    const harness = createHarness({
      ready: true,
      tabDescriptorMissing: true,
      browserProjectionMissing: true,
    })
    const moved = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
      transientTabSeed: {
        title: '网站账号草稿',
        icon: '🌐',
        initialUrl: 'about:blank',
        browserProfile: 'draft-profile',
      },
    })

    expect(moved.success).toBe(true)
    if (!moved.success) return
    expect(moved.projection.tabs).toEqual([
      expect.objectContaining({
        tabId: 'browser-1',
        title: '网站账号草稿',
        initialUrl: 'about:blank',
        browserProfile: 'draft-profile',
      }),
    ])
    expect(
      getMainDiagnosticLogSnapshot().entries.some((entry) =>
        entry.message.includes('transient-browser-projection'),
      ),
    ).toBe(true)
  })

  it('does not accept a transient seed without a main-owned Browser runtime', async () => {
    const harness = createHarness({ tabDescriptorMissing: true })
    harness.ownerByTab.delete('browser-1')

    const moved = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
      transientTabSeed: { title: '伪造 Browser', icon: '🌐' },
    })

    expect(moved).toMatchObject({ success: false, error: { code: 'invalid-source' } })
    expect(harness.createAuxiliaryWindow).not.toHaveBeenCalled()
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

  it('releases a partially written WindowService entry when registration throws', async () => {
    const harness = createHarness({ windowRegistrationFails: true })
    const result = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(result).toMatchObject({ success: false, error: { code: 'window-create-failed' } })
    const auxiliaryId = harness.createAuxiliaryWindow.mock.calls[0]?.[0]
    expect(auxiliaryId).toMatch(/^aux-/)
    expect(harness.windowService.getWindow(auxiliaryId!)).toBeNull()
    expect(harness.auxiliaryWindow.destroy).toHaveBeenCalledOnce()
  })

  it('releases a partially registered auxiliary when Browser host registration fails', async () => {
    const harness = createHarness({ registerHostFails: true })
    const result = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(result).toMatchObject({ success: false, error: { code: 'window-create-failed' } })
    expect(harness.registeredHosts.size).toBe(0)
    expect(harness.browserManager.unregisterHost).toHaveBeenCalledOnce()
    expect(harness.auxiliaryWindow.destroy).toHaveBeenCalledOnce()
    expect(
      harness.windowService
        .getPlacementSnapshot()
        .every((placement) => !placement.windowId.startsWith('aux-')),
    ).toBe(true)
  })

  it('releases the native window, host, and ledger when trust registration fails', async () => {
    const harness = createHarness({ trustRegistrationFails: true })
    const result = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(result).toMatchObject({ success: false, error: { code: 'window-create-failed' } })
    expect(harness.registeredHosts.size).toBe(0)
    expect(harness.browserManager.unregisterHost).toHaveBeenCalledOnce()
    expect(harness.auxiliaryWindow.destroy).toHaveBeenCalledOnce()
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
    expect(
      getMainDiagnosticLogSnapshot().entries.some(
        (entry) =>
          entry.message.includes('[WorkbenchTransfer]') &&
          entry.message.includes('"rollbackResult":"succeeded"') &&
          entry.message.includes('"ownerMatchedPlacement":true'),
      ),
    ).toBe(true)
  })

  it('does not fail a committed move when terminal diagnostic collection fails', async () => {
    const harness = createHarness({ ready: true })
    harness.browserManager.getRuntimeIdentity
      .mockImplementationOnce((tabId: string) => ({
        tabId,
        workspaceKey: '/workspace/a',
        runtimeGeneration: 1,
      }))
      .mockImplementationOnce((tabId: string) => ({
        tabId,
        workspaceKey: '/workspace/a',
        runtimeGeneration: 1,
      }))
      .mockImplementationOnce(() => {
        throw new Error('diagnostic identity unavailable')
      })

    const result = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })

    expect(result.success).toBe(true)
    expect(
      getMainDiagnosticLogSnapshot().entries.some((entry) =>
        entry.message.includes('diagnostic-collection-failed'),
      ),
    ).toBe(true)
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

  it('uses a new transaction when move fails after the original commit', async () => {
    const harness = createHarness({ ready: true })
    const commitTransfer = harness.windowService.commitTransfer.bind(harness.windowService)
    vi.spyOn(harness.windowService, 'commitTransfer').mockImplementationOnce((transferId) => {
      commitTransfer(transferId)
      throw new Error('fault injected after commit')
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
      generation: 3,
      state: 'attached',
    })
    expect(harness.browserManager.transferViewToHost).toHaveBeenCalledTimes(2)
    if (!result.success && result.error.transferId) {
      expect(harness.windowService.getTransfer(result.error.transferId)).toBeNull()
    }
    expect(harness.auxiliaryWindow.destroy).toHaveBeenCalledOnce()
  })

  it('compensates with a new transaction when auxiliary show fails after commit', async () => {
    const harness = createHarness({ ready: true })
    harness.auxiliaryWindow.show.mockImplementationOnce(() => {
      throw new Error('native show failed')
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
      generation: 3,
      state: 'attached',
    })
    expect(harness.browserManager.transferViewToHost).toHaveBeenCalledTimes(2)
    expect(harness.auxiliaryWindow.destroy).toHaveBeenCalledOnce()
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

  it('compensates return when placement publication fails after commit', async () => {
    const harness = createHarness({ ready: true })
    const moved = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })
    expect(moved.success).toBe(true)
    if (!moved.success) return
    harness.mainWindow.webContents.send.mockImplementationOnce(() => {
      throw new Error('main renderer unavailable')
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
      generation: 4,
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

  it('uses Recovery Host when a committed auxiliary window closes unexpectedly', async () => {
    const harness = createHarness({ ready: true })
    const moved = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })
    expect(moved.success).toBe(true)

    harness.auxiliaryWindow.emit('closed')
    await vi.waitFor(() => expect(harness.ownerByTab.get('browser-1')).toBe('main'))
    expect(harness.recoveryHosts.recover).toHaveBeenCalledWith(
      'browser-1',
      expect.stringMatching(/^aux-/),
      '/workspace/a',
    )
    expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
      windowId: 'main',
      state: 'attached',
      generation: 4,
    })
  })

  it('keeps native and logical ownership in Recovery Host when restore commit fails', async () => {
    const harness = createHarness({ ready: true })
    const moved = await harness.controller.moveTabToNewWindow({
      tabId: 'browser-1',
      workspaceKey: '/workspace/a',
      sourceWindowId: 'main',
      expectedGeneration: 0,
    })
    expect(moved.success).toBe(true)
    vi.spyOn(harness.windowService, 'restoreRecovery').mockImplementationOnce(() => {
      throw new Error('restore placement failed')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    harness.auxiliaryWindow.emit('closed')

    await vi.waitFor(() =>
      expect(harness.windowService.getPlacement('browser-1')).toMatchObject({
        windowId: 'recovery:browser-1',
        state: 'recovering',
      }),
    )
    expect(harness.ownerByTab.get('browser-1')).toBe('recovery:browser-1')
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
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
