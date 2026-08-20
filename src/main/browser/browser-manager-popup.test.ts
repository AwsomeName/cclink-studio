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
      executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(undefined),
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
      focus: vi.fn(),
      setZoomFactor: vi.fn((factor: number) => {
        webContents.currentZoom = factor
      }),
      setVisualZoomLevelLimits: vi.fn().mockResolvedValue(undefined),
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
  }> = []

  class WebContentsView {
    webContents: ReturnType<typeof makeWebContents>
    setBounds = vi.fn()

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
    getContentBounds: vi.fn(() => ({ width: 1200, height: 800 })),
  })
  const mainWindow = makeBrowserWindow()
  const mainWebContents = mainWindow.webContents

  return {
    createdViews,
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
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
}))

import { browserIpcEvents } from '../../shared/ipc/browser'
import { BrowserManager } from './browser-manager'

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

  it('remeasures fit width at 100% so widening a pane can escape a previous 30% zoom', async () => {
    vi.useFakeTimers()
    try {
      const { manager, source } = await createSource()
      manager.updateBounds({ x: 0, y: 72, width: 300, height: 600 })
      source.executeJavaScript.mockImplementation(async () =>
        source.currentZoom === 1 ? 1_000 : 3_000,
      )

      manager.reconcileViews({
        workspaceKey: '/workspace/a',
        views: [{ tabId: 'source-tab', profileId: 'wechat' }],
        activeTabId: 'source-tab',
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(manager.getState('source-tab')?.zoomFactor).toBe(0.3)
      source.setZoomFactor.mockClear()

      manager.updateBounds({ x: 0, y: 72, width: 900, height: 600 })
      await vi.advanceTimersByTimeAsync(120)

      expect(manager.getState('source-tab')?.zoomFactor).toBe(0.9)
      expect(source.setZoomFactor.mock.calls).toEqual([[0.9]])
      expect(source.executeJavaScript).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('remeasures at unit zoom when a previously fitting pane becomes narrower', async () => {
    vi.useFakeTimers()
    try {
      const { manager, source } = await createSource()
      manager.updateBounds({ x: 0, y: 72, width: 900, height: 600 })
      source.executeJavaScript.mockResolvedValueOnce(800).mockResolvedValueOnce(1_000)

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
      expect(source.executeJavaScript).toHaveBeenCalledTimes(2)
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
    source.executeJavaScript.mockReturnValueOnce(measurement)

    manager.reconcileViews({
      workspaceKey: '/workspace/a',
      views: [{ tabId: 'source-tab', profileId: 'wechat' }],
      activeTabId: 'source-tab',
    })
    manager.setZoom('source-tab', 1.2)
    expect(manager.getState('source-tab')?.zoomFactor).toBe(1.2)

    resolveMeasurement(1_200)
    await measurement
    await Promise.resolve()

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

  it('enables native trackpad pinch zoom for each browser WebContents', async () => {
    const { source } = await createSource()

    expect(source.setVisualZoomLevelLimits).toHaveBeenCalledWith(0.3, 3)
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
    expect(manager.getViewOwnerWindowId(popupEvent?.[1].tabId)).toBe('main')
  })
})
