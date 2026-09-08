import { describe, it, expect, vi } from 'vitest'
import { executePlaywrightAction, PLAYWRIGHT_ACTION_TYPES } from './playwright-actions'

it('executes iframe fill on the exact dispatched Page, never the globally active Page', async () => {
  const fill = vi.fn().mockResolvedValue(undefined)
  const locator = vi.fn(() => ({ fill }))
  const frameLocator = vi.fn(() => ({ locator }))
  const getActivePage = vi.fn(() => {
    throw new Error('wrong global page')
  })
  await executePlaywrightAction(
    { frameLocator } as never,
    {
      type: 'frameExecute',
      frameSelector: 'iframe.cke_wysiwyg_frame',
      frameAction: 'fill',
      selector: 'body.cke_editable[contenteditable="true"]',
      value: '正文',
    },
    { getActivePage } as never,
  )
  expect(frameLocator).toHaveBeenCalledWith('iframe.cke_wysiwyg_frame')
  expect(fill).toHaveBeenCalledWith('正文')
  expect(getActivePage).not.toHaveBeenCalled()
})

describe('iframe reads on the exact task Page', () => {
  it('reads the signed iframe selector even when the iframe has no independent URL', async () => {
    const textContent = vi.fn().mockResolvedValue('原稿完整正文')
    const locator = vi.fn(() => ({ textContent }))
    const frameLocator = vi.fn(() => ({ locator }))
    await expect(
      executePlaywrightAction({ frameLocator } as never, {
        type: 'frameContent',
        frameSelector: 'iframe.cke_wysiwyg_frame',
        selector: 'body.cke_editable[contenteditable="true"]',
      }),
    ).resolves.toEqual({ text: '原稿完整正文' })
    expect(frameLocator).toHaveBeenCalledWith('iframe.cke_wysiwyg_frame')
    expect(locator).toHaveBeenCalledWith('body.cke_editable[contenteditable="true"]')
  })
  it('reads CKEditor rather than the same-URL top document or a globally active page', async () => {
    const url = 'https://mp.csdn.net/mp_blog/creation/editor/164508531'
    const top = { url: () => url, name: () => '', content: vi.fn() }
    const editor = {
      url: () => url,
      name: () => 'editor',
      content: vi.fn().mockResolvedValue('<body>原稿正文</body>'),
    }
    const ai = {
      url: () => 'https://app-blog.csdn.net/csdn/aiChatNew',
      name: () => 'ai',
      content: vi.fn(),
    }
    const page = { frames: () => [top, editor, ai], mainFrame: () => top }
    const bridge = {
      getActivePage: vi.fn(() => {
        throw new Error('wrong global page')
      }),
    }
    await expect(
      executePlaywrightAction(
        page as never,
        { type: 'frameContent', frameUrl: url },
        bridge as never,
      ),
    ).resolves.toEqual({ html: '<body>原稿正文</body>' })
    const listed = await executePlaywrightAction(
      page as never,
      { type: 'listFrames' },
      bridge as never,
    )
    expect(listed).toHaveLength(2)
    expect(top.content).not.toHaveBeenCalled()
    expect(ai.content).not.toHaveBeenCalled()
    expect(bridge.getActivePage).not.toHaveBeenCalled()
  })

  it('rejects ambiguous iframe URLs instead of reading the first match', async () => {
    const top = { url: () => 'https://mp.csdn.net/editor' }
    const child = { url: () => 'https://mp.csdn.net/editor', name: () => '', content: vi.fn() }
    const page = { frames: () => [top, child, { ...child }], mainFrame: () => top }
    await expect(
      executePlaywrightAction(page as never, { type: 'frameContent', frameUrl: 'mp.csdn.net' }),
    ).rejects.toThrow('多个 iframe')
    expect(child.content).not.toHaveBeenCalled()
  })
})

describe('current CSDN CKEditor fill', () => {
  const action = {
    type: 'frameExecute',
    frameSelector: 'iframe.cke_wysiwyg_frame',
    frameAction: 'fill',
    selector: 'body.cke_editable[contenteditable="true"]',
    value: '完整正文',
  }

  function setup() {
    const body = {
      fill: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    }
    const elementHandle = vi.fn().mockResolvedValue(body)
    const page = {
      url: () => 'https://mp.csdn.net/mp_blog/creation/editor/164508531',
      frameLocator: vi.fn(() => ({ locator: vi.fn(() => ({ elementHandle })) })),
    }
    return { body, page, elementHandle }
  }

  it('notifies the same pinned body with a non-editing key, rechecking the dispatch fence', async () => {
    const { body, page, elementHandle } = setup()
    const guard = vi.fn()
    await executePlaywrightAction(page as never, action, undefined, guard)
    expect(elementHandle).toHaveBeenCalledOnce()
    expect(body.fill).toHaveBeenCalledWith('完整正文')
    expect(body.press).toHaveBeenCalledWith('ArrowRight')
    expect(guard).toHaveBeenCalledTimes(2)
    expect(guard.mock.invocationCallOrder[0]).toBeLessThan(body.fill.mock.invocationCallOrder[0])
    expect(guard.mock.invocationCallOrder[1]).toBeLessThan(body.press.mock.invocationCallOrder[0])
    expect(body.dispose).toHaveBeenCalledOnce()
  })

  it('uses trusted formatted content without typing into the body replaced by CKEditor.setData', async () => {
    const { body, page } = setup()
    const evaluate = vi.fn().mockResolvedValue(undefined)
    const guard = vi.fn()
    const html = '<p>原文</p><p><img src="https://i-blog.csdnimg.cn/one.png"></p>'
    await executePlaywrightAction({ ...page, evaluate } as never, action, undefined, guard, html)
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(evaluate.mock.calls[0][1]).toBe(html)
    expect(body.fill).not.toHaveBeenCalled()
    expect(body.press).not.toHaveBeenCalled()
    expect(guard.mock.invocationCallOrder[1]).toBeLessThan(evaluate.mock.invocationCallOrder[1])
  })

  it('does not trigger a save change event after cancellation during formatted writing', async () => {
    const { body, page } = setup()
    const evaluate = vi.fn().mockResolvedValue(undefined)
    const guard = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('cancelled')
      })
    await expect(
      executePlaywrightAction(
        { ...page, evaluate } as never,
        action,
        undefined,
        guard,
        '<p>原文</p>',
      ),
    ).rejects.toThrow('cancelled')
    expect(evaluate).toHaveBeenCalledOnce()
    expect(body.press).not.toHaveBeenCalled()
  })

  it.each([1, 2])('does not dispatch after cancellation/navigation at guard %s', async (stopAt) => {
    const { body, page } = setup()
    let calls = 0
    const guard = () => {
      if (++calls === stopAt) throw new Error('cancelled or stale page')
    }
    await expect(executePlaywrightAction(page as never, action, undefined, guard)).rejects.toThrow(
      'cancelled or stale page',
    )
    expect(body.fill).toHaveBeenCalledTimes(stopAt === 1 ? 0 : 1)
    expect(body.press).not.toHaveBeenCalled()
    expect(body.dispose).toHaveBeenCalledOnce()
  })

  it('does not resolve a replacement iframe when the original body is detached', async () => {
    const { body, page, elementHandle } = setup()
    body.press.mockRejectedValue(new Error('Element is not attached to the DOM'))
    await expect(
      executePlaywrightAction(page as never, action, undefined, () => {}),
    ).rejects.toThrow('not attached')
    expect(elementHandle).toHaveBeenCalledOnce()
    expect(body.dispose).toHaveBeenCalledOnce()
  })
})

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
