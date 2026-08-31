import { describe, it, expect, vi } from 'vitest'
import { executePlaywrightAction, PLAYWRIGHT_ACTION_TYPES } from './playwright-actions'

describe('PLAYWRIGHT_ACTION_TYPES', () => {
  it('应该有 46 种操作类型', () => {
    expect(PLAYWRIGHT_ACTION_TYPES).toHaveLength(46)
  })

  it('包含所有关键操作', () => {
    const expected = [
      // 基础操作
      'navigate',
      'click',
      'fill',
      'screenshot',
      'extract',
      'select',
      'check',
      'uncheck',
      'press',
      'waitForSelector',
      'evaluate',
      'goBack',
      'goForward',
      'reload',
      'title',
      'inputValue',
      // 高级交互
      'hover',
      'scroll',
      'uploadFile',
      'waitForNavigation',
      'pressKey',
      'dragDrop',
      // 对话框处理
      'handleDialog',
      'setAutoDialog',
      // Cookie 管理
      'getCookies',
      'setCookie',
      'clearCookies',
      // 网络拦截
      'interceptRequest',
      'mockResponse',
      'getNetworkLogs',
      'clearIntercepts',
      // 多 Tab 管理
      'newTab',
      'closeTab',
      'listTabs',
      'switchTab',
      'getTabInfo',
      // 文件下载
      'waitForDownload',
      'downloadInfo',
      'saveDownload',
      // iframe / Frame
      'listFrames',
      'frameExecute',
      'frameContent',
      // 控制台日志
      'getConsoleLogs',
      // 弹窗处理
      'waitForPopup',
      // 坐标鼠标操作
      'mouseClick',
      'mouseMove',
    ]
    for (const action of expected) {
      expect(PLAYWRIGHT_ACTION_TYPES).toContain(action)
    }
  })

  it('所有条目都是字符串', () => {
    for (const action of PLAYWRIGHT_ACTION_TYPES) {
      expect(typeof action).toBe('string')
    }
  })

  it('没有重复', () => {
    expect(new Set(PLAYWRIGHT_ACTION_TYPES).size).toBe(PLAYWRIGHT_ACTION_TYPES.length)
  })
})

describe('Cookie action boundary', () => {
  it('returns only aggregate metadata for legacy getCookies calls', async () => {
    const canary = 'cookie-canary-secret-value'
    const context = {
      cookies: vi.fn().mockResolvedValue([
        {
          name: 'sid',
          value: canary,
          domain: 'example.test',
          path: '/',
          expires: 1_900_000_000,
          httpOnly: true,
        },
      ]),
    }
    const result = await executePlaywrightAction(null, { type: 'getCookies' }, {
      getContext: () => context,
    } as any)

    expect(result).toEqual({ cookieCount: 1, persistentCookieCount: 1 })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(canary)
    expect(serialized).not.toContain('sid')
    expect(serialized).not.toContain('httpOnly')
  })

  it('clears Cookie identities with exact name, domain, and path matching', async () => {
    const cookies = [
      { name: 'sid', domain: 'example.test', path: '/', value: 'one' },
      { name: 'sid_backup', domain: 'example.test', path: '/', value: 'two' },
      { name: 'sid.test', domain: 'example.test', path: '/', value: 'three' },
      { name: 'sid+test', domain: 'example.test', path: '/', value: 'four' },
      { name: 'sid', domain: 'example.test', path: '/admin', value: 'five' },
      { name: 'sid', domain: 'adjacent.example.test', path: '/', value: 'six' },
    ]
    const clearCookies = vi.fn(async (filter?: Record<string, string>) => {
      if (!filter) {
        cookies.splice(0)
        return
      }
      for (let index = cookies.length - 1; index >= 0; index -= 1) {
        const cookie = cookies[index]
        if (
          (!filter.name || cookie.name === filter.name) &&
          (!filter.domain || cookie.domain === filter.domain) &&
          (!filter.path || cookie.path === filter.path)
        ) {
          cookies.splice(index, 1)
        }
      }
    })
    const context = { cookies: vi.fn(async () => [...cookies]), clearCookies }
    const result = await executePlaywrightAction(
      null,
      {
        type: 'clearCookies',
        names: ['sid'],
        domain: 'example.test',
        path: '/',
      },
      { getContext: () => context } as any,
    )

    expect(result).toEqual({ cleared: 1 })
    expect(clearCookies).toHaveBeenCalledWith({
      name: 'sid',
      domain: 'example.test',
      path: '/',
    })
    expect(cookies.map((cookie) => `${cookie.name}|${cookie.domain}|${cookie.path}`)).toEqual([
      'sid_backup|example.test|/',
      'sid.test|example.test|/',
      'sid+test|example.test|/',
      'sid|example.test|/admin',
      'sid|adjacent.example.test|/',
    ])
  })
})
