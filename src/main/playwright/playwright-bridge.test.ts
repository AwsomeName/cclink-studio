import { describe, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import { PlaywrightBridge } from './playwright-bridge'

function fakePage(url: string, title: string): Page {
  return {
    isClosed: () => false,
    url: () => url,
    title: async () => title,
    evaluate: async () => '登录页面',
    addInitScript: async () => undefined,
    on: () => undefined,
  } as unknown as Page
}

describe('PlaywrightBridge diagnostics', () => {
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
    const webContents = { id: 84, session: electronSession, _targetId: 'baidu-target' }
    const internals = bridge as unknown as {
      browser: { contexts: () => unknown[] }
      context: unknown
    }
    internals.browser = { contexts: () => [emptyContext, targetContext] }
    internals.context = emptyContext

    await expect(
      bridge.claimPageForView('baidu-tab', webContents as any, 'https://ziyuan.baidu.com/'),
    ).resolves.toBe(page)
    await bridge.switchToPage('baidu-tab')

    expect(bridge.getContext()).toBe(targetContext)
    expect(emptyContext.on).toHaveBeenCalledWith('page', expect.any(Function))
    expect(targetContext.on).toHaveBeenCalledWith('page', expect.any(Function))
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
    const webContents = { id: 42, session: electronSession }
    const page = fakePage('https://example.com', 'Example')
    const bridge = new PlaywrightBridge(downloadStore as any, taskRuntime as any)
    ;(bridge as any).context = { pages: () => [page] }
    bridge.registerPage(page, 'detached-tab')

    await bridge.claimPageForView('detached-tab', webContents as any)

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
})
