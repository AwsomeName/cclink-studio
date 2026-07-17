import { describe, it, expect, vi } from 'vitest'
import { toolNameToActionType, BrowserToolModule } from './index'
import { PLAYWRIGHT_ACTION_TYPES } from '../../../playwright/playwright-actions'

// ─── toolNameToActionType ────────────────────────────

describe('toolNameToActionType', () => {
  it('简单工具名：去掉 browser_ 前缀', () => {
    expect(toolNameToActionType('browser_navigate')).toBe('navigate')
  })

  it('多段 snake_case 转为 camelCase', () => {
    expect(toolNameToActionType('browser_wait_for_selector')).toBe('waitForSelector')
  })

  it('单段工具名：直接去掉前缀', () => {
    expect(toolNameToActionType('browser_screenshot')).toBe('screenshot')
  })

  it('已经是 camelCase（goBack）保持不变', () => {
    expect(toolNameToActionType('browser_goBack')).toBe('goBack')
  })

  it('没有 browser_ 前缀时不报错', () => {
    expect(toolNameToActionType('navigate')).toBe('navigate')
  })

  it('空字符串返回空字符串', () => {
    expect(toolNameToActionType('')).toBe('')
  })
})

// ─── BrowserToolModule 工具定义校验 ──────────────────

// BrowserToolModule 的 tools 属性暴露了 BROWSER_TOOL_DEFINITIONS
// 需要传入 mock PlaywrightBridge（只读操作不需要真正连接）
const mockBridge = { getPage: () => null } as any
const module = new BrowserToolModule(mockBridge)
const TOOLS = module.tools

describe('BrowserToolModule 工具定义', () => {
  it('应该有 46 个工具定义', () => {
    expect(TOOLS).toHaveLength(46)
  })

  it('所有工具名以 browser_ 开头', () => {
    for (const def of TOOLS) {
      expect(def.name).toMatch(/^browser_/)
    }
  })

  it('工具名没有重复', () => {
    const names = TOOLS.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('每个工具都有必需字段', () => {
    for (const def of TOOLS) {
      expect(def).toHaveProperty('name')
      expect(def).toHaveProperty('description')
      expect(def).toHaveProperty('inputSchema')
      expect(def).toHaveProperty('annotations')
      expect(def.inputSchema).toHaveProperty('type', 'object')
      expect(def.inputSchema).toHaveProperty('properties')
    }
  })

  it('annotations 的 readOnlyHint 和 destructiveHint 都是布尔值', () => {
    for (const def of TOOLS) {
      expect(typeof def.annotations.readOnlyHint).toBe('boolean')
      expect(typeof def.annotations.destructiveHint).toBe('boolean')
    }
  })

  it('每个工具名都能映射到有效的 action type', () => {
    for (const def of TOOLS) {
      const actionType = toolNameToActionType(def.name)
      expect(PLAYWRIGHT_ACTION_TYPES).toContain(actionType)
    }
  })
})

describe('BrowserToolModule 可视浏览器同步', () => {
  it('forces one-time confirmation for a V2EX final publish control', async () => {
    const page = {
      url: () => 'https://www.v2ex.com/new/create',
      evaluate: vi.fn().mockResolvedValue({ sensitive: true, label: '创建主题' }),
      click: vi.fn().mockResolvedValue(undefined),
    }
    const bridge = {
      getPage: () => page,
      getActiveTabId: () => 'v2ex-tab',
      switchToPage: vi.fn().mockResolvedValue(undefined),
    }
    const browserManager = {
      waitForActiveView: vi.fn().mockResolvedValue('v2ex-tab'),
      getActiveViewId: () => 'v2ex-tab',
      setActive: vi.fn(),
      getCurrentURL: () => 'https://www.v2ex.com/new/create',
    }
    const module = new BrowserToolModule(bridge as any, null, browserManager as any)

    await expect(
      module.getExecutionPolicy('browser_click', { selector: '#submit' }),
    ).resolves.toEqual({
      requireConfirmation: true,
      riskLevel: 'destructive',
      reason: 'V2EX 最终发布动作（创建主题）',
      allowAlways: false,
    })
    await expect(module.execute('browser_click', { selector: '#submit' })).rejects.toThrow(
      '必须先取得本次用户确认',
    )
    await expect(
      module.getExecutionPolicy('browser_evaluate', {
        expression: 'fetch("/t/1", {method:"POST"})',
      }),
    ).resolves.toEqual({
      requireConfirmation: true,
      riskLevel: 'destructive',
      reason: 'V2EX 发布页面脚本执行（可能绕过可见提交控件）',
      allowAlways: false,
    })
    await expect(
      module.execute('browser_evaluate', { expression: 'document.title' }),
    ).rejects.toThrow('必须先取得本次用户确认')
    await expect(
      module.execute('browser_click', { selector: '#submit' }, { confirmationGranted: true }),
    ).resolves.toEqual({ clicked: '#submit' })
    expect(page.click).toHaveBeenCalledTimes(1)
  })

  it('navigate uses the visible BrowserManager view instead of a hidden Playwright page', async () => {
    const bridge = {
      getPage: () => null,
      getActiveTabId: () => 'hidden-tab',
      switchToPage: vi.fn().mockRejectedValue(new Error('not claimed')),
    }
    const browserManager = {
      getActiveViewId: () => 'visible-tab',
      setActive: vi.fn(),
      navigate: vi.fn().mockResolvedValue(undefined),
      getCurrentURL: () => 'https://www.zhihu.com/signin',
      getTitle: () => '知乎 - 有问题，就会有答案',
    }
    const module = new BrowserToolModule(bridge as any, null, browserManager as any)

    const result = await module.execute('browser_navigate', {
      url: 'https://www.zhihu.com/signin',
    })

    expect(browserManager.setActive).toHaveBeenCalledWith('visible-tab')
    expect(browserManager.navigate).toHaveBeenCalledWith(
      'visible-tab',
      'https://www.zhihu.com/signin',
    )
    expect(result).toEqual({
      tabId: 'visible-tab',
      url: 'https://www.zhihu.com/signin',
      title: '知乎 - 有问题，就会有答案',
    })
  })

  it('list tabs reads visible BrowserManager views before Playwright claim completes', async () => {
    const bridge = {
      getPage: () => null,
      getActiveTabId: () => null,
      switchToPage: vi.fn().mockRejectedValue(new Error('not claimed')),
    }
    const browserManager = {
      waitForActiveView: vi.fn().mockResolvedValue('visible-tab'),
      getActiveViewId: () => 'visible-tab',
      setActive: vi.fn(),
      listViews: () => [{ tabId: 'visible-tab', url: 'https://www.baidu.com/', title: '百度一下' }],
    }
    const module = new BrowserToolModule(bridge as any, null, browserManager as any)

    await expect(module.execute('browser_list_tabs', {})).resolves.toEqual({
      tabs: [{ tabId: 'visible-tab', url: 'https://www.baidu.com/', title: '百度一下' }],
      activeTabId: 'visible-tab',
    })
  })

  it('interaction actions claim the visible page and retry automatically', async () => {
    const page = {
      url: () => 'https://www.zhihu.com/signin',
      click: vi.fn().mockResolvedValue(undefined),
    }
    let claimed = false
    const bridge = {
      getPage: () => (claimed ? page : null),
      getActiveTabId: () => null,
      switchToPage: vi
        .fn()
        .mockRejectedValueOnce(new Error('not claimed'))
        .mockResolvedValue(undefined),
    }
    const browserManager = {
      waitForActiveView: vi.fn().mockResolvedValue('visible-tab'),
      getActiveViewId: () => 'visible-tab',
      setActive: vi.fn(),
      ensurePlaywrightPage: vi.fn().mockImplementation(async () => {
        claimed = true
      }),
      getCurrentURL: () => 'https://www.zhihu.com/signin',
    }
    const module = new BrowserToolModule(bridge as any, null, browserManager as any)

    await module.execute('browser_click', { selector: '#login' })

    expect(browserManager.ensurePlaywrightPage).toHaveBeenCalledWith('visible-tab')
    expect(bridge.switchToPage).toHaveBeenCalledTimes(2)
    expect(page.click).toHaveBeenCalledWith('#login')
  })

  it('fails interaction actions when Playwright is pointed at a different page than the visible view', async () => {
    const page = {
      url: () => 'https://www.zhihu.com/signin',
      click: vi.fn(),
    }
    const bridge = {
      getPage: () => page,
      getActiveTabId: () => 'hidden-tab',
      switchToPage: vi.fn().mockResolvedValue(undefined),
    }
    const browserManager = {
      getActiveViewId: () => 'visible-tab',
      setActive: vi.fn(),
      getCurrentURL: () => 'https://www.baidu.com/',
    }
    const module = new BrowserToolModule(bridge as any, null, browserManager as any)

    await expect(module.execute('browser_click', { selector: '#login' })).rejects.toThrow(
      '浏览器自动化目标与可视页面不一致',
    )
    expect(page.click).not.toHaveBeenCalled()
  })

  it('never falls back to another project visible browser', async () => {
    const bridge = {
      getPage: () => ({ url: () => 'https://www.zhihu.com/signin' }),
      getActiveTabId: () => 'project-b-tab',
    }
    const browserManager = {
      waitForActiveViewForWorkspace: vi.fn().mockResolvedValue(null),
      getViewIdForWorkspace: vi.fn().mockReturnValue(null),
      getActiveViewId: vi.fn().mockReturnValue('project-b-tab'),
      setActive: vi.fn(),
      navigate: vi.fn(),
    }
    const module = new BrowserToolModule(bridge as any, null, browserManager as any)

    await expect(
      module.execute(
        'browser_navigate',
        { url: 'https://www.zhihu.com/signin' },
        { conversationId: 'project-a-conversation', workspaceKey: '/workspace/a' },
      ),
    ).rejects.toThrow('浏览器资源未绑定到任务所属项目')
    expect(browserManager.setActive).not.toHaveBeenCalled()
    expect(browserManager.navigate).not.toHaveBeenCalled()
  })

  it('uses a background project view without attaching it to the current project UI', async () => {
    const bridge = {
      getPage: () => null,
      getActiveTabId: () => 'project-b-tab',
      switchToPage: vi.fn().mockResolvedValue(undefined),
    }
    const browserManager = {
      waitForActiveViewForWorkspace: vi.fn().mockResolvedValue('project-a-tab'),
      getViewIdForWorkspace: vi.fn().mockReturnValue('project-a-tab'),
      isWorkspaceActive: vi.fn().mockReturnValue(false),
      setActive: vi.fn(),
      navigate: vi.fn().mockResolvedValue(undefined),
      getCurrentURL: vi.fn().mockReturnValue('https://a.example/next'),
      getTitle: vi.fn().mockReturnValue('Project A'),
    }
    const module = new BrowserToolModule(bridge as any, null, browserManager as any)

    await expect(
      module.execute(
        'browser_navigate',
        { url: 'https://a.example/next' },
        { conversationId: 'project-a-conversation', workspaceKey: '/workspace/a' },
      ),
    ).resolves.toMatchObject({ tabId: 'project-a-tab', url: 'https://a.example/next' })
    expect(browserManager.setActive).not.toHaveBeenCalled()
    expect(bridge.switchToPage).toHaveBeenCalledWith('project-a-tab')
    expect(browserManager.navigate).toHaveBeenCalledWith('project-a-tab', 'https://a.example/next')
  })

  it('rejects switching to a tab owned by another project', async () => {
    const bridge = {
      getPage: () => ({ url: () => 'https://a.example' }),
      getActiveTabId: () => 'project-a-tab',
      switchToPage: vi.fn().mockResolvedValue(undefined),
    }
    const browserManager = {
      waitForActiveViewForWorkspace: vi.fn().mockResolvedValue('project-a-tab'),
      getViewIdForWorkspace: vi.fn().mockReturnValue('project-a-tab'),
      getViewWorkspaceKey: vi.fn((tabId: string) =>
        tabId === 'project-a-tab' ? '/workspace/a' : '/workspace/b',
      ),
      isWorkspaceActive: vi.fn().mockReturnValue(false),
      setActive: vi.fn(),
      getCurrentURL: vi.fn().mockReturnValue('https://a.example'),
    }
    const module = new BrowserToolModule(bridge as any, null, browserManager as any)

    await expect(
      module.execute(
        'browser_switch_tab',
        { tabId: 'project-b-tab' },
        { conversationId: 'project-a-conversation', workspaceKey: '/workspace/a' },
      ),
    ).rejects.toThrow('目标浏览器 Tab 不属于任务项目')
    expect(bridge.switchToPage).not.toHaveBeenCalledWith('project-b-tab')
  })
})
