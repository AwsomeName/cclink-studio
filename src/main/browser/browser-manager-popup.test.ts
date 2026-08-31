import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  type Listener = (...args: any[]) => void

  const makeSession = () => ({
    cookies: {
      on: vi.fn(),
      flushStore: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue([]),
    },
    webRequest: { onBeforeSendHeaders: vi.fn() },
  })

  const defaultSession = makeSession()
  const sessions = new Map<string, ReturnType<typeof makeSession>>()

  const makeWebContents = (browserSession = defaultSession) => {
    const listeners = new Map<string, Listener[]>()
    const onceListeners = new Map<string, Listener[]>()
    const webContents = {
      session: browserSession,
      executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(800),
      currentUrl: '',
      currentTitle: '',
      currentZoom: 1,
      userAgent: 'Mozilla/5.0 Chrome/150.0 Electron/43.1.1',
      windowOpenHandler: null as null | ((details: any) => any),
      on: vi.fn((event: string, listener: Listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener])
        return webContents
      }),
      once: vi.fn((event: string, listener: Listener) => {
        onceListeners.set(event, [...(onceListeners.get(event) ?? []), listener])
        return webContents
      }),
      emit(event: string, ...args: any[]) {
        for (const listener of listeners.get(event) ?? []) listener(...args)
        const pending = onceListeners.get(event) ?? []
        onceListeners.delete(event)
        for (const listener of pending) listener(...args)
      },
      setWindowOpenHandler: vi.fn((handler: (details: any) => any) => {
        webContents.windowOpenHandler = handler
      }),
      getUserAgent: vi.fn(() => webContents.userAgent),
      setUserAgent: vi.fn((value: string) => {
        webContents.userAgent = value
      }),
      getURL: vi.fn(() => webContents.currentUrl),
      getTitle: vi.fn(() => webContents.currentTitle),
      isDestroyed: vi.fn(() => false),
      getZoomFactor: vi.fn(() => webContents.currentZoom),
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      goBack: vi.fn(),
      goForward: vi.fn(),
      reload: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      cut: vi.fn(),
      copy: vi.fn(),
      paste: vi.fn(),
      delete: vi.fn(),
      selectAll: vi.fn(),
      focus: vi.fn(),
      setZoomFactor: vi.fn((factor: number) => {
        webContents.currentZoom = factor
      }),
      setVisualZoomLevelLimits: vi.fn().mockResolvedValue(undefined),
      debugger: {
        attached: false,
        visualScale: 1,
        isAttached: vi.fn(() => webContents.debugger.attached),
        attach: vi.fn(() => {
          webContents.debugger.attached = true
        }),
        detach: vi.fn(() => {
          webContents.debugger.attached = false
        }),
        sendCommand: vi.fn(async (method: string, params?: { pageScaleFactor?: number }) => {
          if (method === 'Runtime.evaluate') {
            return { result: { value: webContents.debugger.visualScale } }
          }
          if (method === 'Emulation.setPageScaleFactor') {
            webContents.debugger.visualScale = params?.pageScaleFactor ?? 1
            return {}
          }
          throw new Error(`unexpected debugger command: ${method}`)
        }),
      },
      executeJavaScript: vi.fn().mockResolvedValue(800),
      findInPage: vi.fn(() => 41),
      stopFindInPage: vi.fn(),
      sendInputEvent: vi.fn(),
      loadURL: vi.fn(async (url: string) => {
        webContents.currentUrl = url
      }),
      close: vi.fn(() => webContents.emit('destroyed')),
    }
    return webContents
  }

  const createdViews: Array<{
    webContents: ReturnType<typeof makeWebContents>
    setBounds: ReturnType<typeof vi.fn>
    setVisible: ReturnType<typeof vi.fn>
  }> = []
  const builtMenuTemplates: any[][] = []

  class WebContentsView {
    webContents: ReturnType<typeof makeWebContents>
    setBounds = vi.fn()
    setVisible = vi.fn()

    constructor(options: {
      webContents?: ReturnType<typeof makeWebContents>
      webPreferences?: any
    }) {
      this.webContents =
        options?.webContents ?? makeWebContents(options?.webPreferences?.session ?? defaultSession)
      createdViews.push(this)
    }
  }

  const makeBrowserWindow = () => ({
    webContents: {
      send: vi.fn(),
      getZoomFactor: vi.fn(() => 1),
      isDestroyed: vi.fn(() => false),
    },
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    getContentBounds: vi.fn(() => ({ width: 1200, height: 800 })),
  })
  const mainWindow = makeBrowserWindow()
  const mainWebContents = mainWindow.webContents

  return {
    createdViews,
    builtMenuTemplates,
    defaultSession,
    mainWebContents,
    mainWindow,
    makeBrowserWindow,
    makeWebContents,
    WebContentsView,
    session: {
      fromPartition: vi.fn((partition: string) => {
        const existing = sessions.get(partition)
        if (existing) return existing
        const created = makeSession()
        sessions.set(partition, created)
        return created
      }),
    },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: electronMocks.WebContentsView,
  session: electronMocks.session,
  clipboard: { writeText: vi.fn() },
  Menu: {
    buildFromTemplate: vi.fn((template: any[]) => {
      electronMocks.builtMenuTemplates.push(template)
      return { popup: vi.fn() }
    }),
  },
}))

import { browserIpcEvents } from '../../shared/ipc/browser'
import { BrowserManager, FIT_WIDTH_MEASUREMENT_SCRIPT } from './browser-manager'

const popupDetails = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://mp.weixin.qq.com/cgi-bin/appmsg',
  frameName: '_blank',
  features: '',
  disposition: 'foreground-tab',
  referrer: { url: 'https://mp.weixin.qq.com/', policy: 'strict-origin-when-cross-origin' },
  ...overrides,
})

describe('BrowserManager popup adoption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.createdViews.length = 0
    electronMocks.builtMenuTemplates.length = 0
  })

  async function createSource(): Promise<{
    manager: BrowserManager
    source: ReturnType<typeof electronMocks.makeWebContents>
  }> {
    const manager = new BrowserManager(electronMocks.mainWindow as never)
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: null,
    })
    await manager.createView('source-tab', 'https://mp.weixin.qq.com/', {
      workspaceKey: '/workspace/a',
      profileId: 'wechat',
    })
    return { manager, source: electronMocks.createdViews[0].webContents }
  }

  it('selects the ordinary environment for an Agent even when an account Tab is active', async () => {
    const manager = new BrowserManager(electronMocks.mainWindow as never)
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [
        { tabId: 'ordinary-tab', profileId: null },
        { tabId: 'account-tab', profileId: 'account-profile' },
      ],
      activeTabId: null,
    })
    await manager.createView('ordinary-tab', 'https://example.com/default', {
      workspaceKey: '/workspace/a',
      profileId: null,
    })
    await manager.createView('account-tab', 'https://example.com/account', {
      workspaceKey: '/workspace/a',
      profileId: 'account-profile',
    })
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [
        { tabId: 'ordinary-tab', profileId: null },
        { tabId: 'account-tab', profileId: 'account-profile' },
      ],
      activeTabId: 'account-tab',
    })

    expect(manager.getActiveViewIdForWorkspace('/workspace/a')).toBe('account-tab')
    expect(manager.getViewIdForWorkspace('/workspace/a')).toBe('ordinary-tab')
  })

  it('does not treat an account environment as an ordinary Agent target', async () => {
    const manager = new BrowserManager(electronMocks.mainWindow as never)
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'account-tab', profileId: 'account-profile' }],
      activeTabId: null,
    })
    await manager.createView('account-tab', 'https://example.com/account', {
      workspaceKey: '/workspace/a',
      profileId: 'account-profile',
    })
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'account-tab', profileId: 'account-profile' }],
      activeTabId: 'account-tab',
    })

    expect(manager.getActiveViewIdForWorkspace('/workspace/a')).toBe('account-tab')
    expect(manager.getViewIdForWorkspace('/workspace/a')).toBeNull()
  })

  it('claims a background Playwright page without attaching it over a non-browser renderer tab', async () => {
    const { manager } = await createSource()
    const claimViewPage = vi
      .spyOn(manager as never, 'claimViewPage')
      .mockResolvedValue(undefined as never)
    ;(manager as unknown as { playwrightBridge: object }).playwrightBridge = {}
    electronMocks.mainWindow.contentView.addChildView.mockClear()

    await manager.ensurePlaywrightPage('source-tab')

    expect(claimViewPage).toHaveBeenCalledWith(
      'source-tab',
      expect.objectContaining({ workspaceKey: '/workspace/a' }),
    )
    expect(manager.getActiveViewId()).toBeNull()
    expect(electronMocks.mainWindow.contentView.addChildView).not.toHaveBeenCalled()
    expect(electronMocks.createdViews[0].setVisible).toHaveBeenLastCalledWith(false)
  })

  it('publishes the exact current Page identity only after a View claim succeeds', async () => {
    const { manager, source } = await createSource()
    const webContentsId = 91
    ;(source as unknown as { id: number }).id = webContentsId
    const page = { url: () => 'https://mp.weixin.qq.com/' }
    const bridge = {
      claimPageForView: vi.fn(async () => page),
      getPageBindingIdentity: vi.fn(() => ({
        page,
        generation: 9,
        connectionGeneration: 4,
        webContentsId,
      })),
    }
    ;(manager as unknown as { playwrightBridge: object }).playwrightBridge = bridge
    const observed = vi.fn()
    const dispose = manager.onPageRuntimeBound(observed)

    await manager.ensurePlaywrightPage('source-tab')

    expect(observed).toHaveBeenCalledOnce()
    expect(observed).toHaveBeenCalledWith({
      tabId: 'source-tab',
      browserViewRuntimeGeneration: expect.any(Number),
      webContentsId,
      playwrightConnectionGeneration: 4,
      playwrightPageBindingGeneration: 9,
    })
    dispose()
  })

  it('requires renderer activation before reusing an existing account View for publishing', async () => {
    const { manager } = await createSource()
    electronMocks.mainWebContents.send.mockClear()

    const pending = manager.waitForAccountView(
      '/workspace/a',
      'wechat',
      'account-a',
      'https://mp.weixin.qq.com/',
      1_000,
    )
    await vi.waitFor(() =>
      expect(electronMocks.mainWebContents.send).toHaveBeenCalledWith(
        browserIpcEvents.requestOpenTab,
        expect.objectContaining({
          workspaceKey: '/workspace/a',
          profileId: 'wechat',
          accountId: 'account-a',
        }),
      ),
    )
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })

    await expect(pending).resolves.toBe('source-tab')
  })

  it('rejects an unusable automatic 30% result and recovers after the pane widens', async () => {
    vi.useFakeTimers()
    try {
      const { manager, source } = await createSource()
      manager.updateBounds({ x: 0, y: 72, width: 300, height: 600 })
      source.executeJavaScriptInIsolatedWorld.mockImplementation(async () =>
        source.currentZoom === 1 ? 1_000 : 3_000,
      )

      manager.reconcileViews({
        workspaceKey: '/workspace/a',
        views: [{ tabId: 'source-tab', profileId: 'wechat' }],
        activeTabId: 'source-tab',
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(manager.getState('source-tab')?.zoomFactor).toBe(1)
      await expect(manager.getRuntimeDiagnostics('source-tab')).resolves.toMatchObject({
        fitWidth: {
          status: 'rejected',
          rejectionReason: 'auto-fit-too-small',
          rawFactor: 0.3,
          appliedFactor: 1,
        },
      })
      source.setZoomFactor.mockClear()

      manager.updateBounds({ x: 0, y: 72, width: 900, height: 600 })
      await vi.advanceTimersByTimeAsync(120)

      expect(manager.getState('source-tab')?.zoomFactor).toBe(0.9)
      expect(source.setZoomFactor.mock.calls).toEqual([[1], [0.9]])
      expect(source.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2)
      expect(source.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(expect.any(Number), [
        { code: FIT_WIDTH_MEASUREMENT_SCRIPT },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a transient first width and accepts only the stable tail samples', async () => {
    const { manager, source } = await createSource()
    manager.updateBounds({ x: 0, y: 72, width: 600, height: 600 })
    source.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce([
      { offsetMs: 0, viewportWidth: 600, rootWidth: 4_000, bodyWidth: 4_000 },
      { offsetMs: 250, viewportWidth: 600, rootWidth: 1_000, bodyWidth: 1_000 },
      { offsetMs: 750, viewportWidth: 600, rootWidth: 1_000, bodyWidth: 1_000 },
    ])

    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })

    await vi.waitFor(() => expect(manager.getState('source-tab')?.zoomFactor).toBe(0.6))
    await expect(manager.getRuntimeDiagnostics('source-tab')).resolves.toMatchObject({
      fitWidth: {
        status: 'accepted',
        contentWidth: 1_000,
        rawFactor: 0.6,
        appliedFactor: 0.6,
      },
    })
    manager.destroy()
  })

  it('keeps 100% and refuses to cache an unstable page width', async () => {
    vi.useFakeTimers()
    try {
      const { manager, source } = await createSource()
      manager.updateBounds({ x: 0, y: 72, width: 600, height: 600 })
      source.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce([
        { offsetMs: 0, viewportWidth: 600, rootWidth: 4_000, bodyWidth: 4_000 },
        { offsetMs: 250, viewportWidth: 600, rootWidth: 3_000, bodyWidth: 3_000 },
        { offsetMs: 750, viewportWidth: 600, rootWidth: 1_000, bodyWidth: 1_000 },
      ])

      manager.reconcileViews({
        workspaceKey: '/workspace/a',
        views: [{ tabId: 'source-tab', profileId: 'wechat' }],
        activeTabId: 'source-tab',
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(manager.getState('source-tab')?.zoomFactor).toBe(1)
      await expect(manager.getRuntimeDiagnostics('source-tab')).resolves.toMatchObject({
        fitWidth: {
          status: 'rejected',
          rejectionReason: 'unstable-content-width',
          appliedFactor: 1,
        },
      })
      manager.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('invalidates fit width and remeasures after a main-frame in-page navigation', async () => {
    const { manager, source } = await createSource()
    manager.updateBounds({ x: 0, y: 72, width: 900, height: 600 })
    source.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce(800).mockResolvedValueOnce(1_000)
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    await vi.waitFor(() => expect(manager.getState('source-tab')?.zoomFactor).toBe(1))

    source.emit('did-navigate-in-page', {}, 'https://mp.weixin.qq.com/#next', true)

    await vi.waitFor(() => expect(manager.getState('source-tab')?.zoomFactor).toBe(0.9))
    expect(source.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2)
    await expect(manager.getRuntimeDiagnostics('source-tab')).resolves.toMatchObject({
      fitWidth: {
        trigger: 'did-navigate-in-page',
        status: 'accepted',
        documentGeneration: 1,
      },
    })
    manager.destroy()
  })

  it('does not touch the native view again when stabilized bounds are unchanged', async () => {
    const { manager } = await createSource()
    manager.updateBounds({ x: 0, y: 72, width: 600, height: 600 })
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    const view = electronMocks.createdViews[0]
    view.setBounds.mockClear()

    manager.updateBounds({ x: 0, y: 72, width: 600, height: 600 })
    expect(view.setBounds).not.toHaveBeenCalled()

    manager.updateBounds({ x: 0, y: 72, width: 620, height: 600 })
    expect(view.setBounds).toHaveBeenCalledOnce()
    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 72, width: 620, height: 600 })
  })

  it('remeasures at unit zoom when a previously fitting pane becomes narrower', async () => {
    vi.useFakeTimers()
    try {
      const { manager, source } = await createSource()
      manager.updateBounds({ x: 0, y: 72, width: 900, height: 600 })
      source.executeJavaScriptInIsolatedWorld
        .mockResolvedValueOnce(800)
        .mockResolvedValueOnce(1_000)

      manager.reconcileViews({
        workspaceKey: '/workspace/a',
        views: [{ tabId: 'source-tab', profileId: 'wechat' }],
        activeTabId: 'source-tab',
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(manager.getState('source-tab')?.zoomFactor).toBe(1)

      manager.updateBounds({ x: 0, y: 72, width: 600, height: 600 })
      await vi.advanceTimersByTimeAsync(120)

      expect(manager.getState('source-tab')?.zoomFactor).toBe(0.6)
      expect(source.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not let an older fit-width measurement overwrite a newer manual zoom', async () => {
    let resolveMeasurement!: (width: number) => void
    const measurement = new Promise<number>((resolve) => {
      resolveMeasurement = resolve
    })
    const { manager, source } = await createSource()
    manager.updateBounds({ x: 0, y: 72, width: 600, height: 600 })
    source.executeJavaScriptInIsolatedWorld.mockReturnValueOnce(measurement)

    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    manager.setZoom('source-tab', 1.2)
    expect(manager.getState('source-tab')?.zoomFactor).toBe(1.2)

    resolveMeasurement(1_200)
    await measurement
    await vi.waitFor(() => expect(source.currentZoom).toBe(1.2))

    expect(manager.getState('source-tab')).toMatchObject({
      zoomMode: 'manual',
      zoomFactor: 1.2,
    })
    expect(source.currentZoom).toBe(1.2)
  })

  it('creates a WebContentsView runtime and requests a workbench tab instead of a BrowserWindow', async () => {
    const { manager, source } = await createSource()
    const response = source.windowOpenHandler?.(popupDetails())

    expect(response).toMatchObject({ action: 'allow' })
    const popupWebContents = electronMocks.makeWebContents(source.session)
    const returned = response.createWindow({ webContents: popupWebContents })

    expect(returned).toBe(popupWebContents)
    const popupEvent = electronMocks.mainWebContents.send.mock.calls.find(
      ([channel]) => channel === browserIpcEvents.popupCreated,
    )
    expect(popupEvent?.[1]).toMatchObject({
      sourceTabId: 'source-tab',
      url: 'https://mp.weixin.qq.com/cgi-bin/appmsg',
      workspaceKey: '/workspace/a',
      profileId: 'wechat',
      disposition: 'foreground-tab',
      activate: true,
    })
    expect(manager.listViewsForWorkspace('/workspace/a')).toHaveLength(2)

    const popupTabId = popupEvent?.[1].tabId as string
    manager.acceptPopup(popupTabId)
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [
        { tabId: 'source-tab', profileId: 'wechat' },
        { tabId: popupTabId, profileId: 'wechat' },
      ],
      activeTabId: popupTabId,
    })
    expect(manager.getActiveViewId()).toBe(popupTabId)
  })

  it('installs bounded page interaction fallbacks in isolated worlds after load', async () => {
    const { source } = await createSource()

    source.emit('did-finish-load')
    await vi.waitFor(() => {
      expect(source.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(expect.any(Number), [
        expect.objectContaining({ code: expect.stringContaining('urlAtPoint') }),
      ])
      expect(source.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(expect.any(Number), [
        expect.objectContaining({
          code: expect.stringContaining('__cclinkHorizontalPanInstalled'),
        }),
      ])
    })
  })

  it('allows bounded native pinch requests before routing them through BrowserManager', async () => {
    const { source } = await createSource()

    expect(source.setVisualZoomLevelLimits).toHaveBeenCalledWith(0.3, 3)
  })

  it('routes native zoom requests back through the manager-owned zoom state', async () => {
    const { manager, source } = await createSource()
    manager.updateBounds({ x: 0, y: 72, width: 600, height: 600 })
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    source.debugger.visualScale = 0.3

    source.emit('zoom-changed', {}, 'out')

    expect(manager.getState('source-tab')).toMatchObject({
      zoomMode: 'manual',
      zoomFactor: 0.9,
    })
    await vi.waitFor(() => {
      expect(source.currentZoom).toBe(0.9)
      expect(source.debugger.visualScale).toBe(1)
    })
  })

  it('resets independent Chromium visual zoom when fit width is applied', async () => {
    const { manager, source } = await createSource()
    manager.updateBounds({ x: 0, y: 72, width: 600, height: 600 })
    source.debugger.visualScale = 0.3
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })

    await vi.waitFor(() => expect(source.debugger.visualScale).toBe(1))
    await expect(manager.getRuntimeDiagnostics('source-tab')).resolves.toMatchObject({
      fitWidth: {
        visualScaleBeforeReset: 0.3,
        actualVisualScale: 1,
      },
    })
  })

  it('does not surface a superseded ERR_ABORTED navigation as a page failure', async () => {
    const { manager, source } = await createSource()
    source.loadURL.mockImplementationOnce(async () => {
      source.currentUrl = 'https://www.baidu.com/'
      throw Object.assign(new Error("ERR_ABORTED (-3) loading 'https://www.baidu.com/'"), {
        code: 'ERR_ABORTED',
        errno: -3,
      })
    })

    await expect(manager.navigate('source-tab', 'https://www.baidu.com/')).resolves.toBeUndefined()
  })

  it('still surfaces ERR_ABORTED when the WebContents never reached the requested URL', async () => {
    const { manager, source } = await createSource()
    source.currentUrl = 'about:blank'
    source.loadURL.mockRejectedValueOnce(
      Object.assign(new Error("ERR_ABORTED (-3) loading 'https://www.baidu.com/'"), {
        code: 'ERR_ABORTED',
        errno: -3,
      }),
    )

    await expect(manager.navigate('source-tab', 'https://www.baidu.com/')).rejects.toMatchObject({
      code: 'ERR_ABORTED',
    })
  })

  it('still surfaces a real navigation failure', async () => {
    const { manager, source } = await createSource()
    source.loadURL.mockRejectedValueOnce(
      Object.assign(new Error("ERR_NAME_NOT_RESOLVED loading 'https://invalid.example/'"), {
        code: 'ERR_NAME_NOT_RESOLVED',
        errno: -105,
      }),
    )

    await expect(manager.navigate('source-tab', 'https://invalid.example/')).rejects.toMatchObject({
      code: 'ERR_NAME_NOT_RESOLVED',
    })
  })

  it('removes the runtime and notifies renderer when popup calls window.close', async () => {
    const { manager, source } = await createSource()
    const response = source.windowOpenHandler?.(popupDetails())
    const popupWebContents = electronMocks.makeWebContents(source.session)
    response.createWindow({ webContents: popupWebContents })
    const popupEvent = electronMocks.mainWebContents.send.mock.calls.find(
      ([channel]) => channel === browserIpcEvents.popupCreated,
    )
    const popupTabId = popupEvent?.[1].tabId as string
    manager.acceptPopup(popupTabId)

    popupWebContents.emit('destroyed')

    expect(manager.listViewsForWorkspace('/workspace/a')).toEqual([
      expect.objectContaining({ tabId: 'source-tab' }),
    ])
    expect(electronMocks.mainWebContents.send).toHaveBeenCalledWith(
      browserIpcEvents.runtimeTabClosed,
      { tabId: popupTabId, workspaceKey: '/workspace/a' },
    )
  })

  it('denies file and unsupported protocol popups before creating a view', async () => {
    const { source } = await createSource()

    expect(source.windowOpenHandler?.(popupDetails({ url: 'file:///tmp/private.html' }))).toEqual({
      action: 'deny',
    })
    expect(source.windowOpenHandler?.(popupDetails({ url: 'javascript:alert(1)' }))).toEqual({
      action: 'deny',
    })
    expect(electronMocks.createdViews).toHaveLength(1)
  })

  it('forwards only the synced find chord and correlates native find results', async () => {
    const { manager, source } = await createSource()
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    expect(
      manager.syncFindShortcut({
        configVersion: 7,
        bindings: [{ code: 'KeyF', modifiers: ['primary'] }],
      }),
    ).toEqual({ appliedConfigVersion: 7 })

    const preventDefault = vi.fn()
    source.emit(
      'before-input-event',
      { preventDefault },
      {
        type: 'keyDown',
        key: 'f',
        code: 'KeyF',
        isAutoRepeat: false,
        isComposing: false,
        shift: false,
        control: process.platform !== 'darwin',
        alt: false,
        meta: process.platform === 'darwin',
        location: 0,
        modifiers: [],
      },
    )
    expect(preventDefault).toHaveBeenCalledOnce()
    const shortcutEvent = electronMocks.mainWebContents.send.mock.calls.find(
      ([channel]) => channel === browserIpcEvents.findShortcutTriggered,
    )
    expect(shortcutEvent?.[1]).toMatchObject({
      commandId: 'workbench.find',
      configVersion: 7,
      tabId: 'source-tab',
      workspaceKey: '/workspace/a',
    })

    const identity = manager.getRuntimeIdentity('source-tab')!
    manager.findInPage({
      ...identity,
      requestToken: 'request-1',
      query: 'needle',
      forward: true,
      findNext: false,
    })
    source.emit(
      'found-in-page',
      {},
      {
        requestId: 41,
        matches: 3,
        activeMatchOrdinal: 1,
        finalUpdate: true,
      },
    )
    expect(electronMocks.mainWebContents.send).toHaveBeenCalledWith(
      browserIpcEvents.findResult,
      expect.objectContaining({ requestToken: 'request-1', matches: 3 }),
    )
  })

  it('rejects find requests from an earlier runtime generation', async () => {
    const { manager } = await createSource()
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    const staleIdentity = manager.getRuntimeIdentity('source-tab')!
    manager.destroyView('source-tab')
    await manager.createView('source-tab', 'https://example.com', {
      workspaceKey: '/workspace/a',
      profileId: 'wechat',
    })
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })

    expect(() =>
      manager.findInPage({
        ...staleIdentity,
        requestToken: 'stale-request',
        query: 'needle',
        forward: true,
        findNext: false,
      }),
    ).toThrow('目标已失效')
  })

  it('returns a count-only fallback when Electron omits found-in-page', async () => {
    vi.useFakeTimers()
    try {
      const { manager, source } = await createSource()
      manager.reconcileViews({
        workspaceKey: '/workspace/a',
        views: [{ tabId: 'source-tab', profileId: 'wechat' }],
        activeTabId: 'source-tab',
      })
      source.executeJavaScript.mockResolvedValueOnce(3)

      const identity = manager.getRuntimeIdentity('source-tab')!
      manager.findInPage({
        ...identity,
        requestToken: 'fallback-request',
        query: 'needle',
        forward: true,
        findNext: false,
      })
      await vi.advanceTimersByTimeAsync(300)

      expect(source.findInPage).toHaveBeenCalledWith('needle', {
        forward: true,
        findNext: false,
      })
      expect(electronMocks.mainWebContents.send).toHaveBeenCalledWith(
        browserIpcEvents.findResult,
        expect.objectContaining({
          requestToken: 'fallback-request',
          matches: 3,
          activeMatchOrdinal: 1,
          finalUpdate: true,
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects smoke-only native shortcut injection outside isolated test data', async () => {
    const previousTestUserData = process.env.CCLINK_STUDIO_TEST_USER_DATA_PATH
    delete process.env.CCLINK_STUDIO_TEST_USER_DATA_PATH
    try {
      const { manager } = await createSource()
      expect(() => manager.dispatchFindShortcutForSmoke('source-tab')).toThrow('隔离测试环境')
    } finally {
      if (previousTestUserData === undefined) {
        delete process.env.CCLINK_STUDIO_TEST_USER_DATA_PATH
      } else {
        process.env.CCLINK_STUDIO_TEST_USER_DATA_PATH = previousTestUserData
      }
    }
  })

  it('preserves background POST body, content type and referrer without stealing focus', async () => {
    const { source } = await createSource()
    const postData = [{ type: 'rawData', bytes: Buffer.from('title=hello') }]
    const referrer = {
      url: 'https://example.com/source',
      policy: 'strict-origin-when-cross-origin',
    }
    const response = source.windowOpenHandler?.(
      popupDetails({
        url: 'https://example.com/submit',
        disposition: 'background-tab',
        referrer,
        postBody: {
          contentType: 'multipart/form-data',
          boundary: 'popup-boundary',
          data: postData,
        },
      }),
    )

    const returned = response.createWindow({ webPreferences: {} })
    const popupView = electronMocks.createdViews.at(-1)!

    expect(returned).toBe(popupView.webContents)
    expect(popupView.webContents.loadURL).toHaveBeenCalledWith('https://example.com/submit', {
      httpReferrer: referrer,
      postData,
      extraHeaders: 'Content-Type: multipart/form-data; boundary=popup-boundary\n',
    })
    expect(electronMocks.mainWebContents.send).toHaveBeenCalledWith(
      browserIpcEvents.popupCreated,
      expect.objectContaining({ disposition: 'background-tab', activate: false }),
    )
  })

  it('closes an unadopted popup after the bounded handshake timeout', async () => {
    vi.useFakeTimers()
    try {
      const { manager, source } = await createSource()
      const response = source.windowOpenHandler?.(popupDetails())
      const popupWebContents = electronMocks.makeWebContents(source.session)
      response.createWindow({ webContents: popupWebContents })
      const popupEvent = electronMocks.mainWebContents.send.mock.calls.find(
        ([channel]) => channel === browserIpcEvents.popupCreated,
      )
      const popupTabId = popupEvent?.[1].tabId as string

      vi.advanceTimersByTime(10_000)

      expect(popupWebContents.close).toHaveBeenCalledOnce()
      expect(manager.listViewsForWorkspace('/workspace/a')).toEqual([
        expect.objectContaining({ tabId: 'source-tab' }),
      ])
      expect(electronMocks.mainWebContents.send).toHaveBeenCalledWith(
        browserIpcEvents.runtimeTabClosed,
        { tabId: popupTabId, workspaceKey: '/workspace/a' },
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a claimed popup alive beyond ten seconds while workspace adoption is running', async () => {
    vi.useFakeTimers()
    try {
      const { manager, source } = await createSource()
      const response = source.windowOpenHandler?.(popupDetails())
      const popupWebContents = electronMocks.makeWebContents(source.session)
      response.createWindow({ webContents: popupWebContents })
      const popupEvent = electronMocks.mainWebContents.send.mock.calls.find(
        ([channel]) => channel === browserIpcEvents.popupCreated,
      )
      const popupTabId = popupEvent?.[1].tabId as string

      manager.beginPopupAdoption(popupTabId)
      vi.advanceTimersByTime(60_000)

      expect(popupWebContents.close).not.toHaveBeenCalled()
      await expect(manager.getRuntimeDiagnostics(popupTabId)).resolves.toMatchObject({
        popup: { adoptionState: 'adopting' },
      })

      manager.acceptPopup(popupTabId)
      vi.advanceTimersByTime(5 * 60_000)
      expect(popupWebContents.close).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still closes a claimed popup when renderer never completes adoption', async () => {
    vi.useFakeTimers()
    try {
      const { manager, source } = await createSource()
      const response = source.windowOpenHandler?.(popupDetails())
      const popupWebContents = electronMocks.makeWebContents(source.session)
      response.createWindow({ webContents: popupWebContents })
      const popupEvent = electronMocks.mainWebContents.send.mock.calls.find(
        ([channel]) => channel === browserIpcEvents.popupCreated,
      )
      const popupTabId = popupEvent?.[1].tabId as string

      manager.beginPopupAdoption(popupTabId)
      vi.advanceTimersByTime(4 * 60_000)
      manager.beginPopupAdoption(popupTabId)
      vi.advanceTimersByTime(60_000)

      expect(popupWebContents.close).toHaveBeenCalledOnce()
      expect(manager.listViewsForWorkspace('/workspace/a')).toEqual([
        expect.objectContaining({ tabId: 'source-tab' }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves the same runtime between native hosts and routes events only to its owner', async () => {
    const { manager, source } = await createSource()
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    const view = electronMocks.createdViews[0]
    const identityBefore = manager.getRuntimeIdentity('source-tab')
    const auxiliaryWindow = electronMocks.makeBrowserWindow()
    manager.registerHost('aux-1', auxiliaryWindow as never, '/workspace/a')
    manager.updateBoundsForWindow('aux-1', { x: 0, y: 72, width: 900, height: 600 })

    manager.transferViewToHost('source-tab', 'main', 'aux-1')

    expect(manager.getViewOwnerWindowId('source-tab')).toBe('aux-1')
    expect(manager.getRuntimeIdentity('source-tab')).toEqual(identityBefore)
    expect(auxiliaryWindow.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setVisible).toHaveBeenLastCalledWith(true)
    expect(source.close).not.toHaveBeenCalled()
    const loadCountAfterMove = source.loadURL.mock.calls.length

    electronMocks.mainWebContents.send.mockClear()
    source.emit('page-title-updated', {}, 'Moved page')
    expect(auxiliaryWindow.webContents.send).toHaveBeenCalledWith(
      browserIpcEvents.pageMetaChanged,
      expect.objectContaining({ tabId: 'source-tab', title: 'Moved page' }),
    )
    expect(electronMocks.mainWebContents.send).not.toHaveBeenCalled()

    manager.reconcileViews({ workspaceKey: '/workspace/a', views: [], activeTabId: null })
    expect(manager.getViewOwnerWindowId('source-tab')).toBe('aux-1')
    expect(source.close).not.toHaveBeenCalled()

    manager.transferViewToHost('source-tab', 'aux-1', 'main')
    expect(manager.getViewOwnerWindowId('source-tab')).toBe('main')
    expect(manager.getRuntimeIdentity('source-tab')).toEqual(identityBefore)
    expect(source.loadURL).toHaveBeenCalledTimes(loadCountAfterMove)
  })

  it('routes a detached window native-menu new Tab request to the main Tab owner', async () => {
    const { manager, source } = await createSource()
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    const auxiliaryWindow = electronMocks.makeBrowserWindow()
    manager.registerHost('aux-context-menu', auxiliaryWindow as never, '/workspace/a')
    manager.transferViewToHost('source-tab', 'main', 'aux-context-menu')
    electronMocks.mainWebContents.send.mockClear()
    auxiliaryWindow.webContents.send.mockClear()

    source.emit(
      'context-menu',
      {},
      {
        selectionText: '',
        linkURL: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=detached',
        srcURL: '',
        isEditable: false,
        mediaType: 'none',
        editFlags: {},
      },
    )
    const openLink = electronMocks.builtMenuTemplates
      .at(-1)
      ?.find((item) => item.id === 'open-link')
    expect(openLink).toBeDefined()

    openLink.click({}, auxiliaryWindow, {})

    expect(electronMocks.mainWebContents.send).toHaveBeenCalledWith(
      browserIpcEvents.requestOpenTab,
      {
        initialUrl: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=detached',
        workspaceKey: '/workspace/a',
        profileId: 'wechat',
        sourceTabId: 'source-tab',
        forceNew: true,
      },
    )
    expect(auxiliaryWindow.webContents.send).not.toHaveBeenCalledWith(
      browserIpcEvents.requestOpenTab,
      expect.anything(),
    )
    expect(electronMocks.mainWindow.show).toHaveBeenCalledOnce()
    expect(electronMocks.mainWindow.focus).toHaveBeenCalledOnce()
  })

  it('rolls a failed target attach back to the source host', async () => {
    const { manager, source } = await createSource()
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    const view = electronMocks.createdViews[0]
    const auxiliaryWindow = electronMocks.makeBrowserWindow()
    auxiliaryWindow.contentView.addChildView.mockImplementationOnce(() => {
      throw new Error('target attach failed')
    })
    manager.registerHost('aux-failing', auxiliaryWindow as never, '/workspace/a')

    expect(() => manager.transferViewToHost('source-tab', 'main', 'aux-failing')).toThrow(
      'target attach failed',
    )
    expect(manager.getViewOwnerWindowId('source-tab')).toBe('main')
    expect(electronMocks.mainWindow.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(source.close).not.toHaveBeenCalled()
  })

  it('adopts a popup from a single-tab auxiliary host into the main host projection', async () => {
    const { manager, source } = await createSource()
    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    const auxiliaryWindow = electronMocks.makeBrowserWindow()
    manager.registerHost('aux-popup', auxiliaryWindow as never, '/workspace/a')
    manager.transferViewToHost('source-tab', 'main', 'aux-popup')
    electronMocks.mainWebContents.send.mockClear()
    auxiliaryWindow.webContents.send.mockClear()

    const response = source.windowOpenHandler?.(popupDetails())
    response.createWindow({ webContents: electronMocks.makeWebContents(source.session) })
    const popupEvent = electronMocks.mainWebContents.send.mock.calls.find(
      ([channel]) => channel === browserIpcEvents.popupCreated,
    )

    expect(popupEvent?.[1]).toMatchObject({ workspaceKey: '/workspace/a' })
    expect(auxiliaryWindow.webContents.send).not.toHaveBeenCalledWith(
      browserIpcEvents.popupCreated,
      expect.anything(),
    )
    const popupTabId = popupEvent?.[1].tabId as string
    expect(manager.getViewOwnerWindowId(popupTabId)).toBe('main')

    manager.acceptPopup(popupTabId)

    expect(electronMocks.mainWindow.show).toHaveBeenCalledOnce()
    expect(electronMocks.mainWindow.focus).toHaveBeenCalledOnce()
    expect(auxiliaryWindow.show).not.toHaveBeenCalled()
  })

  it('routes a top-level Basic Auth challenge and marks a successful navigation authenticated', async () => {
    const { manager, source } = await createSource()
    let complete: ((username?: string, password?: string) => void) | undefined
    let request:
      | Parameters<Parameters<BrowserManager['attachBrowserHttpAuthRequestHandler']>[0]>[0]
      | undefined
    manager.attachBrowserHttpAuthRequestHandler((nextRequest, callback) => {
      request = nextRequest
      complete = callback
      manager.recordHttpAuthOutcome(nextRequest, 'prompted', 1)
    })
    const preventDefault = vi.fn()
    const electronCallback = vi.fn()

    source.emit('did-start-navigation', {}, 'http://frp.example:7500/dashboard', false, true)
    source.emit(
      'login',
      { preventDefault },
      { url: 'http://frp.example:7500/dashboard' },
      { scheme: 'basic', isProxy: false, realm: 'Restricted' },
      electronCallback,
    )

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(request).toMatchObject({
      tabId: 'source-tab',
      origin: 'http://frp.example:7500',
      realm: 'Restricted',
      transport: 'insecure-http',
    })
    manager.recordHttpAuthOutcome(request!, 'submitted', 1)
    complete?.('admin', 'secret')
    expect(electronCallback).toHaveBeenCalledWith('admin', 'secret')

    source.emit('did-navigate', {}, 'http://frp.example:7500/dashboard')
    await expect(manager.getRuntimeDiagnostics('source-tab')).resolves.toMatchObject({
      httpAuth: {
        origin: 'http://frp.example:7500',
        realm: 'Restricted',
        outcome: 'authenticated',
      },
    })
    manager.destroy()
  })

  it('does not intercept proxy, unsupported, or cross-origin authentication challenges', async () => {
    const { manager, source } = await createSource()
    const handler = vi.fn()
    manager.attachBrowserHttpAuthRequestHandler(handler)
    source.emit('did-start-navigation', {}, 'https://frp.example/', false, true)

    for (const [url, scheme, isProxy] of [
      ['https://frp.example/', 'basic', true],
      ['https://frp.example/', 'digest', false],
      ['https://attacker.example/', 'basic', false],
    ] as const) {
      const preventDefault = vi.fn()
      source.emit(
        'login',
        { preventDefault },
        { url },
        { scheme, isProxy, realm: 'Restricted' },
        vi.fn(),
      )
      expect(preventDefault).not.toHaveBeenCalled()
    }

    expect(handler).not.toHaveBeenCalled()
    manager.destroy()
  })

  it('cancels a Basic Auth callback when the target Browser runtime is gone', async () => {
    const { manager, source } = await createSource()
    let complete: ((username?: string, password?: string) => void) | undefined
    manager.attachBrowserHttpAuthRequestHandler((_request, callback) => {
      complete = callback
    })
    const electronCallback = vi.fn()
    source.emit('did-start-navigation', {}, 'https://frp.example/', false, true)
    source.emit(
      'login',
      { preventDefault: vi.fn() },
      { url: 'https://frp.example/' },
      { scheme: 'basic', isProxy: false, realm: 'Restricted' },
      electronCallback,
    )

    manager.destroyView('source-tab')
    complete?.('admin', 'must-not-be-forwarded')

    expect(electronCallback).toHaveBeenCalledOnce()
    expect(electronCallback).toHaveBeenCalledWith()
    manager.destroy()
  })
})
