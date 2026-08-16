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
      setZoomFactor: vi.fn(),
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

  const mainWebContents = {
    send: vi.fn(),
    getZoomFactor: vi.fn(() => 1),
  }
  const mainWindow = {
    webContents: mainWebContents,
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    getContentBounds: vi.fn(() => ({ width: 1200, height: 800 })),
  }

  return {
    createdViews,
    defaultSession,
    mainWebContents,
    mainWindow,
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

  it('installs plain-text URL handling in an isolated world after the page loads', async () => {
    const { source } = await createSource()

    source.emit('did-finish-load')
    await vi.waitFor(() => {
      expect(source.executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(expect.any(Number), [
        expect.objectContaining({ code: expect.stringContaining('urlAtPoint') }),
      ])
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
})
