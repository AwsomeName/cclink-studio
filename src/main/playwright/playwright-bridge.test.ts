import { describe, expect, it } from 'vitest'
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
})
