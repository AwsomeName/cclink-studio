import { afterEach, describe, expect, it, vi } from 'vitest'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { PlaywrightBridge } from './playwright-bridge'

function fakePage(url: string, title: string): Page {
  return {
    isClosed: () => false,
    url: () => url,
    title: async () => title,
    evaluate: async () => '登录页面',
    addInitScript: async () => undefined,
    on: () => undefined,
    removeListener: () => undefined,
  } as unknown as Page
}

describe('PlaywrightBridge diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps console and network diagnostics scoped to the requested page', async () => {
    const bridge = new PlaywrightBridge()
    const zhihuPage = fakePage('https://www.zhihu.com/signin', '知乎登录')
    const baiduPage = fakePage('https://www.baidu.com', '百度')
    const internals = bridge as unknown as {
      pages: Map<string, Page>
      consoleLogs: Array<{
        page: Page
        type: 'error'
        text: string
        timestamp: number
      }>
      networkLog: Array<{
        page: Page
        requestId: string
        method: string
        url: string
        status: number
        timestamp: number
      }>
    }

    internals.pages.set('zhihu-tab', zhihuPage)
    internals.pages.set('baidu-tab', baiduPage)
    internals.consoleLogs.push(
      { page: zhihuPage, type: 'error', text: 'zhihu failed', timestamp: 1 },
      { page: baiduPage, type: 'error', text: 'baidu failed', timestamp: 2 },
    )
    internals.networkLog.push(
      {
        page: zhihuPage,
        requestId: 'zhihu',
        method: 'GET',
        url: 'https://www.zhihu.com/api/login',
        status: 403,
        timestamp: 3,
      },
      {
        page: zhihuPage,
        requestId: 'zhihu-cdn',
        method: 'GET',
        url: 'https://static.zhihu.com/app.js?token=secret',
        status: 502,
        timestamp: 3,
      },
      {
        page: baiduPage,
        requestId: 'baidu',
        method: 'GET',
        url: 'https://www.baidu.com/api',
        status: 500,
        timestamp: 4,
      },
    )

    const diagnostics = await bridge.getPageDiagnostics('zhihu-tab')

    expect(diagnostics?.consoleErrors.map((entry) => entry.text)).toEqual(['zhihu failed'])
    expect(diagnostics?.networkIssues.map((entry) => entry.url)).toEqual([
      'https://www.zhihu.com/api/login',
      'https://static.zhihu.com/app.js',
    ])
  })

  it('keeps one binding when an unclaimed page is later claimed by a real tab id', async () => {
    const bridge = new PlaywrightBridge()
    const page = fakePage('https://example.com', 'Example')

    bridge.registerPage(page, 'temporary-page')
    bridge.registerPage(page, 'project-browser-tab')

    expect(await bridge.listPages()).toEqual([
      {
        tabId: 'project-browser-tab',
        url: 'https://example.com',
        title: 'Example',
      },
    ])
  })

  it('returns only BrowserManager-claimed IDs as stable popup IDs', async () => {
    const bridge = new PlaywrightBridge()
    const page = fakePage('https://example.com/popup', 'Popup')
    const internals = bridge as unknown as {
      claimedViewTabIds: Set<string>
    }

    bridge.registerPage(page, 'temporary-popup-id')
    expect(await bridge.waitForClaimedPageId(page, 0)).toBeNull()

    bridge.registerPage(page, 'browser-popup-stable')
    internals.claimedViewTabIds.add('browser-popup-stable')
    expect(await bridge.waitForClaimedPageId(page, 0)).toBe('browser-popup-stable')
  })

  it('claims a visible Page from a later BrowserContext and uses its Context when active', async () => {
    const bridge = new PlaywrightBridge()
    const emptyContext = { pages: () => [], on: vi.fn() }
    const targetContext = { pages: vi.fn(), on: vi.fn() }
    const page = {
      ...fakePage('https://ziyuan.baidu.com/', '百度搜索资源平台'),
      _guid: 'baidu-target',
      context: () => targetContext,
      bringToFront: vi.fn(),
    } as unknown as Page
    targetContext.pages.mockReturnValue([page])
    const electronSession = { on: vi.fn(), removeListener: vi.fn() }
    const webContents = {
      id: 84,
      session: electronSession,
      _targetId: 'baidu-target',
      isDestroyed: () => false,
    }
    const internals = bridge as unknown as {
      browser: { contexts: () => unknown[]; isConnected: () => boolean }
      context: unknown
    }
    internals.browser = {
      contexts: () => [emptyContext, targetContext],
      isConnected: () => true,
    }
    internals.context = emptyContext

    await expect(
      bridge.claimPageForView('baidu-tab', webContents as any, 'https://ziyuan.baidu.com/'),
    ).resolves.toBe(page)
    await bridge.switchToPage('baidu-tab')

    expect(bridge.getContext()).toBe(targetContext)
    expect(emptyContext.on).toHaveBeenCalledWith('page', expect.any(Function))
    expect(targetContext.on).toHaveBeenCalledWith('page', expect.any(Function))
  })

  it('claims the only unbound Page when another View already owns the same URL', async () => {
    const bridge = new PlaywrightBridge()
    const context = { pages: vi.fn(), on: vi.fn() }
    const existingPage = {
      ...fakePage('https://example.com/same', 'Existing'),
      _guid: 'existing-target',
      context: () => context,
    } as unknown as Page
    const newPage = {
      ...fakePage('https://example.com/same', 'New'),
      _guid: 'new-target',
      context: () => context,
    } as unknown as Page
    context.pages.mockReturnValue([existingPage, newPage])
    const electronSession = { on: vi.fn(), removeListener: vi.fn() }
    const existingWebContents = {
      id: 84,
      session: electronSession,
      _targetId: 'existing-target',
      isDestroyed: () => false,
    }
    const newWebContents = {
      id: 85,
      session: electronSession,
      isDestroyed: () => false,
    }
    const internals = bridge as unknown as {
      browser: { contexts: () => unknown[]; isConnected: () => boolean }
      context: unknown
    }
    internals.browser = { contexts: () => [context], isConnected: () => true }
    internals.context = context

    await expect(
      bridge.claimPageForView(
        'existing-tab',
        existingWebContents as any,
        'https://example.com/same',
      ),
    ).resolves.toBe(existingPage)
    await expect(
      bridge.claimPageForView('new-tab', newWebContents as any, 'https://example.com/same'),
    ).resolves.toBe(newPage)
  })

  it('uses the Electron Session as the authoritative download lifecycle for a claimed tab', async () => {
    const downloadStore = {
      startDownloadNow: vi.fn().mockReturnValue({
        record: { id: 'electron-download' },
        targetPath: '/tmp/agent-downloads/file.txt',
      }),
      completeDownload: vi.fn(),
      failDownload: vi.fn(),
    }
    const taskRuntime = {
      getActiveTaskForTab: vi.fn().mockReturnValue({ id: 'task-a' }),
      addDownload: vi.fn(),
    }
    const electronSession = {
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const webContents = { id: 42, session: electronSession, isDestroyed: () => false }
    const page = fakePage('https://example.com', 'Example')
    const bridge = new PlaywrightBridge(downloadStore as any, taskRuntime as any)
    ;(bridge as any).context = { pages: () => [page], on: vi.fn(), removeListener: vi.fn() }
    ;(bridge as any).browser = {
      contexts: () => [(bridge as any).context],
      isConnected: () => true,
      close: vi.fn().mockResolvedValue(undefined),
    }
    bridge.registerPage(page, 'detached-tab')

    await bridge.claimPageForView('detached-tab', webContents as any, 'https://example.com')

    const handler = electronSession.on.mock.calls.find(([event]) => event === 'will-download')?.[1]
    expect(handler).toBeTypeOf('function')
    const item = {
      getFilename: () => 'file.txt',
      getURL: () => 'https://example.com/file.txt',
      setSavePath: vi.fn(),
      once: vi.fn(),
    }
    handler({}, item, webContents)

    expect(downloadStore.startDownloadNow).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'agent',
        taskRunId: 'task-a',
        tabId: 'detached-tab',
        sourceUrl: 'https://example.com/file.txt',
        suggestedFilename: 'file.txt',
      }),
    )
    expect(item.setSavePath).toHaveBeenCalledWith('/tmp/agent-downloads/file.txt')
    const done = item.once.mock.calls.find(([event]) => event === 'done')?.[1]
    done({}, 'completed')
    expect(downloadStore.completeDownload).toHaveBeenCalledWith(
      expect.any(String),
      '/tmp/agent-downloads/file.txt',
    )
    expect(taskRuntime.addDownload).toHaveBeenCalledWith('task-a', expect.any(String))

    await bridge.disconnect()
    expect(electronSession.removeListener).toHaveBeenCalledWith('will-download', handler)
  })

  it('uses one bounded native CDP connection for concurrent recovery requests', async () => {
    const browser = fakeBrowser([])
    const connect = vi
      .spyOn(chromium, 'connectOverCDP')
      .mockResolvedValue(browser as unknown as Browser)
    const bridge = new PlaywrightBridge()

    await Promise.all([bridge.connect(9333), bridge.ensureConnected('parallel_tool')])

    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith('http://127.0.0.1:9333', {
      headers: { Connection: 'keep-alive' },
      timeout: 5_000,
    })
    expect(bridge.getConnectionGeneration()).toBe(1)
    await bridge.disconnect()
  })

  it('reconnects from the disconnected event and clears stale route state', async () => {
    const firstBrowser = fakeBrowser([])
    const secondBrowser = fakeBrowser([])
    vi.spyOn(chromium, 'connectOverCDP')
      .mockResolvedValueOnce(firstBrowser)
      .mockResolvedValueOnce(secondBrowser)
    const bridge = new PlaywrightBridge()
    await bridge.connect(9334)
    bridge.setRouteHandler('**/api/**', { action: 'block' })

    firstBrowser.emitDisconnected()

    await vi.waitFor(() => expect(bridge.isConnected()).toBe(true))
    expect(bridge.getConnectionGeneration()).toBe(2)
    expect(bridge.getRoutePatterns()).toEqual([])
    await bridge.disconnect()
  })

  it('forces one reconnect when a live View continuously sees zero contexts', async () => {
    vi.useFakeTimers()
    const emptyBrowser = fakeBrowser([])
    const page = eventPage('https://example.com/', 'Example', 'target-a')
    const recoveredContext = fakeContext([page])
    const recoveredBrowser = fakeBrowser([recoveredContext])
    vi.spyOn(chromium, 'connectOverCDP')
      .mockResolvedValueOnce(emptyBrowser as unknown as Browser)
      .mockResolvedValueOnce(recoveredBrowser as unknown as Browser)
    const bridge = new PlaywrightBridge()
    await bridge.connect(9444)
    const webContents = {
      id: 77,
      _targetId: 'target-a',
      session: { on: vi.fn(), removeListener: vi.fn() },
      isDestroyed: () => false,
    }

    const claim = bridge.claimPageForView('live-tab', webContents as never, 'https://example.com/')
    await vi.advanceTimersByTimeAsync(1_100)

    await expect(claim).resolves.toBe(page)
    expect(bridge.getConnectionGeneration()).toBe(2)
    expect(bridge.getConnectionDiagnostics()).toMatchObject({
      forcedByEmptyContexts: true,
      contextCount: 1,
      pageCount: 1,
    })
    await bridge.disconnect()
  })

  it('ignores a late close callback from an older generation', () => {
    const bridge = new PlaywrightBridge()
    const oldPage = eventPage('https://old.example/', 'Old')
    const newPage = eventPage('https://new.example/', 'New')
    bridge.registerPage(oldPage, 'stable-tab', 1, 42)
    ;(bridge as never as { connectionGeneration: number }).connectionGeneration = 2
    bridge.registerPage(newPage, 'stable-tab', 2, 42)

    oldPage.emit('close')

    expect(bridge.getPageById('stable-tab')).toBe(newPage)
  })

  it('does not unregister a newer binding when an older claim cleanup arrives late', () => {
    const bridge = new PlaywrightBridge()
    const oldPage = eventPage('https://old.example/', 'Old')
    const newPage = eventPage('https://new.example/', 'New')
    bridge.registerPage(oldPage, 'stable-tab', 1, 42)
    const oldBinding = bridge.getPageBindingIdentity('stable-tab')!
    bridge.registerPage(newPage, 'stable-tab', 2, 42)

    expect(bridge.unregisterPageIfMatches('stable-tab', oldBinding)).toBe(false)
    expect(bridge.getPageById('stable-tab')).toBe(newPage)
  })

  it('requires Page, generation and WebContents identity for conditional unregister', () => {
    const bridge = new PlaywrightBridge()
    const page = eventPage('https://example.com/', 'Current')
    bridge.registerPage(page, 'stable-tab', 3, 42)
    const binding = bridge.getPageBindingIdentity('stable-tab')!

    expect(bridge.unregisterPageIfMatches('stable-tab', { ...binding, generation: 2 })).toBe(false)
    expect(bridge.unregisterPageIfMatches('stable-tab', { ...binding, webContentsId: 99 })).toBe(
      false,
    )
    expect(bridge.unregisterPageIfMatches('stable-tab', binding)).toBe(true)
    expect(bridge.getPageById('stable-tab')).toBeNull()
  })
})

function fakeContext(pages: Page[]): BrowserContext {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    pages: () => pages,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const current = listeners.get(event) ?? new Set()
      current.add(listener)
      listeners.set(event, current)
      return undefined as never
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener)
      return undefined as never
    },
  } as unknown as BrowserContext
}

function fakeBrowser(contexts: BrowserContext[]): Browser & { emitDisconnected(): void } {
  let connected = true
  const disconnected = new Set<() => void>()
  const browser = {
    contexts: () => contexts,
    isConnected: () => connected,
    on: (event: string, listener: () => void) => {
      if (event === 'disconnected') disconnected.add(listener)
    },
    removeListener: (event: string, listener: () => void) => {
      if (event === 'disconnected') disconnected.delete(listener)
    },
    emitDisconnected: () => {
      connected = false
      for (const listener of disconnected) listener()
    },
    close: async () => browser.emitDisconnected(),
  }
  return browser as unknown as Browser & { emitDisconnected(): void }
}

function eventPage(
  url: string,
  title: string,
  targetId?: string,
): Page & { emit(event: string): void } {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  return {
    _target: targetId ? { _targetId: targetId } : undefined,
    isClosed: () => false,
    url: () => url,
    title: async () => title,
    context: () => fakeContext([]),
    bringToFront: async () => undefined,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const current = listeners.get(event) ?? new Set()
      current.add(listener)
      listeners.set(event, current)
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener)
    },
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) listener()
    },
  } as unknown as Page & { emit(event: string): void }
}
