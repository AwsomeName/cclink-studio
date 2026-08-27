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

  it('keeps registered-account tasks from exposing session data or executing final actions', async () => {
    const accountTask = {
      id: 'task-a',
      tabId: 'account-tab',
      goal: '办理事务',
      status: 'running',
      startedAt: Date.now(),
      downloadIds: [],
      correlation: {
        workspaceKey: '/workspace/a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentSessionRef: null,
        profileId: 'profile-a',
        accountId: 'account-a',
        allowedOrigins: ['https://example.com'],
      },
    }
    const page = {
      url: () => 'https://example.com/form',
      evaluate: vi.fn().mockResolvedValue({ sensitive: true, label: '提交申请' }),
      click: vi.fn(),
    }
    const bridge = {
      getPage: () => page,
      getPageById: () => page,
      switchToPage: vi.fn().mockResolvedValue(undefined),
    }
    const browserTaskRuntime = {
      getActiveTaskForConversation: vi.fn().mockReturnValue(accountTask),
      assertCanRunAction: vi.fn().mockReturnValue(accountTask),
      pauseForTakeover: vi.fn(),
    }
    const browserManager = {
      getViewWorkspaceKey: () => '/workspace/a',
      getViewProfileId: () => 'profile-a',
      isWorkspaceActive: () => true,
      setActive: vi.fn(),
      getCurrentURL: () => 'https://example.com/form',
    }
    const module = new BrowserToolModule(
      bridge as any,
      browserTaskRuntime as any,
      browserManager as any,
    )
    const context = { conversationId: 'conversation-a', workspaceKey: '/workspace/a' }

    await expect(module.execute('browser_get_cookies', {}, context)).rejects.toThrow(
      '避免泄露登录态',
    )
    await expect(module.execute('browser_click', { selector: '#submit' }, context)).rejects.toThrow(
      '敏感最终动作',
    )
    expect(browserTaskRuntime.pauseForTakeover).toHaveBeenCalledWith(
      'task-a',
      '检测到敏感最终动作（提交申请）',
    )
    expect(page.click).not.toHaveBeenCalled()
  })

  it('requires a fresh read before writing after human handback', async () => {
    const accountTask = {
      id: 'task-a',
      tabId: 'account-tab',
      goal: '继续办理',
      status: 'running',
      reobservationRequired: true,
      startedAt: Date.now(),
      downloadIds: [],
      correlation: {
        workspaceKey: '/workspace/a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentSessionRef: null,
        profileId: 'profile-a',
        accountId: 'account-a',
        allowedOrigins: ['https://example.com'],
      },
    }
    const page = { url: () => 'https://example.com/form', fill: vi.fn() }
    const module = new BrowserToolModule(
      {
        getPage: () => page,
        getPageById: () => page,
        switchToPage: vi.fn().mockResolvedValue(undefined),
      } as any,
      {
        getActiveTaskForConversation: () => accountTask,
        assertCanRunAction: () => accountTask,
      } as any,
      {
        getViewWorkspaceKey: () => '/workspace/a',
        getViewProfileId: () => 'profile-a',
        isWorkspaceActive: () => true,
        setActive: vi.fn(),
        getCurrentURL: () => 'https://example.com/form',
      } as any,
    )

    await expect(
      module.execute(
        'browser_fill',
        { selector: '#name', value: '张三公司' },
        { conversationId: 'conversation-a', workspaceKey: '/workspace/a' },
      ),
    ).rejects.toThrow('必须先截图或读取当前页面')
    expect(page.fill).not.toHaveBeenCalled()
  })

  it('uses the shared re-observation allowlist and rejects actions without Page observation', async () => {
    const task = {
      id: 'task-a',
      tabId: 'browser-a',
      goal: 'recover',
      status: 'running',
      reobservationRequired: true,
      startedAt: 1,
      downloadIds: [],
      correlation: { conversationId: 'conversation-a', workspaceKey: '/workspace/a' },
    }
    const module = new BrowserToolModule(
      {
        getPage: () => null,
        getPageById: () => null,
        switchToPage: vi.fn().mockResolvedValue(undefined),
      } as any,
      {
        getActiveTaskForConversation: () => task,
        assertCanRunAction: () => task,
      } as any,
      {
        getViewWorkspaceKey: () => '/workspace/a',
        isWorkspaceActive: () => true,
        setActive: vi.fn(),
        getCurrentURL: () => 'https://example.com/',
      } as any,
    )

    await expect(
      module.execute(
        'browser_download_info',
        { downloadId: 'download-a' },
        { conversationId: 'conversation-a', workspaceKey: '/workspace/a' },
      ),
    ).rejects.toThrow('必须先截图或读取当前页面')
    await expect(
      module.execute(
        'browser_get_tab_info',
        {},
        { conversationId: 'conversation-a', workspaceKey: '/workspace/a' },
      ),
    ).rejects.toThrow('必须先截图或读取当前页面')
  })

  it('does not return full HTML or read secret fields from a registered account page', async () => {
    const accountTask = {
      id: 'task-a',
      tabId: 'account-tab',
      goal: 'read status',
      status: 'running',
      startedAt: Date.now(),
      downloadIds: [],
      correlation: {
        workspaceKey: '/workspace/a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentSessionRef: null,
        profileId: 'profile-a',
        accountId: 'account-a',
        allowedOrigins: ['https://example.com'],
      },
    }
    const page = {
      url: () => 'https://example.com/status',
      evaluate: vi.fn().mockResolvedValue(true),
      content: vi.fn(),
      inputValue: vi.fn(),
    }
    const module = new BrowserToolModule(
      {
        getPage: () => page,
        getPageById: () => page,
        switchToPage: vi.fn().mockResolvedValue(undefined),
      } as any,
      {
        getActiveTaskForConversation: () => accountTask,
        assertCanRunAction: () => accountTask,
      } as any,
      {
        getViewWorkspaceKey: () => '/workspace/a',
        getViewProfileId: () => 'profile-a',
        isWorkspaceActive: () => true,
        setActive: vi.fn(),
        getCurrentURL: () => 'https://example.com/status',
      } as any,
    )
    const context = { conversationId: 'conversation-a', workspaceKey: '/workspace/a' }

    await expect(module.execute('browser_extract', {}, context)).rejects.toThrow(
      '不能返回整页 HTML',
    )
    await expect(
      module.execute('browser_input_value', { selector: '#password' }, context),
    ).rejects.toThrow('不能读取密码')
    expect(page.content).not.toHaveBeenCalled()
    expect(page.inputValue).not.toHaveBeenCalled()
  })

  it('navigate uses the visible BrowserManager view instead of a hidden Playwright page', async () => {
    const page = { isClosed: () => false, url: () => 'https://www.zhihu.com/signin' }
    let claimed = false
    const bridge = {
      getPage: () => (claimed ? page : null),
      getPageById: () => (claimed ? page : null),
      getActiveTabId: () => 'hidden-tab',
      switchToPage: vi
        .fn()
        .mockRejectedValueOnce(new Error('not claimed'))
        .mockResolvedValue(undefined),
    }
    const browserManager = {
      getActiveViewId: () => 'visible-tab',
      setActive: vi.fn(),
      navigate: vi.fn().mockResolvedValue(undefined),
      ensurePlaywrightPage: vi.fn().mockImplementation(async () => {
        claimed = true
      }),
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
    expect(browserManager.waitForActiveView).not.toHaveBeenCalled()
  })

  it('list tabs does not create a browser when the workspace has none', async () => {
    const browserManager = {
      getViewIdForWorkspace: vi.fn().mockReturnValue(null),
      waitForActiveViewForWorkspace: vi.fn(),
      listViewsForWorkspace: vi.fn().mockReturnValue([]),
    }
    const module = new BrowserToolModule(mockBridge, null, browserManager as any)

    await expect(
      module.execute(
        'browser_list_tabs',
        {},
        { conversationId: 'conversation-a', workspaceKey: '/workspace/a' },
      ),
    ).resolves.toEqual({ tabs: [], activeTabId: null })
    expect(browserManager.waitForActiveViewForWorkspace).not.toHaveBeenCalled()
  })

  it('lets an Agent without an account use the ordinary browser session', async () => {
    const page = { isClosed: () => false, url: () => 'https://example.com/' }
    let claimed = false
    const bridge = {
      getPage: () => (claimed ? page : null),
      getPageById: () => (claimed ? page : null),
      getActiveTabId: () => null,
      switchToPage: vi
        .fn()
        .mockRejectedValueOnce(new Error('not claimed yet'))
        .mockResolvedValue(undefined),
    }
    const browserTaskRuntime = {
      getActiveTaskForConversation: vi.fn().mockReturnValue(null),
      startTask: vi.fn().mockReturnValue({ id: 'task-a' }),
      assertCanRunAction: vi.fn().mockReturnValue(null),
    }
    const browserManager = {
      getViewIdForWorkspace: vi.fn().mockReturnValue(null),
      waitForActiveViewForWorkspace: vi.fn().mockResolvedValue('browser-a'),
      isWorkspaceActive: vi.fn().mockReturnValue(true),
      setActive: vi.fn(),
      navigate: vi.fn().mockResolvedValue(undefined),
      getCurrentURL: vi.fn().mockReturnValue('https://example.com/'),
      getTitle: vi.fn().mockReturnValue('Example'),
      getViewProfileId: vi.fn().mockReturnValue(null),
      ensurePlaywrightPage: vi.fn().mockImplementation(async () => {
        claimed = true
      }),
    }
    const module = new BrowserToolModule(
      bridge as any,
      browserTaskRuntime as any,
      browserManager as any,
      null,
    )

    await expect(
      module.execute(
        'browser_navigate',
        { url: 'https://example.com/' },
        {
          conversationId: 'conversation-a',
          workspaceKey: '/workspace/a',
          agentRunId: 'run-a',
          agentGoal: '用浏览器打开 Example',
        },
      ),
    ).resolves.toEqual({
      tabId: 'browser-a',
      url: 'https://example.com/',
      title: 'Example',
    })
    expect(browserManager.waitForActiveViewForWorkspace).toHaveBeenCalledWith('/workspace/a')
    expect(browserTaskRuntime.startTask).toHaveBeenCalledWith({
      tabId: 'browser-a',
      goal: '用浏览器打开 Example',
      correlation: {
        workspaceKey: '/workspace/a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentSessionRef: null,
        profileId: null,
      },
    })
  })

  it('does not let a browser-scoped Agent bypass web_account_open on a registered profile', async () => {
    const browserTaskRuntime = {
      getActiveTaskForConversation: vi.fn().mockReturnValue(null),
      startTask: vi.fn(),
    }
    const browserManager = {
      getViewIdForWorkspace: () => 'registered-tab',
      getViewProfileId: () => 'registered-profile',
    }
    const module = new BrowserToolModule(
      mockBridge,
      browserTaskRuntime as any,
      browserManager as any,
      { isDraftProfile: () => false, resolveAccountIdByProfile: () => 'account-a' } as any,
    )

    await expect(
      module.execute(
        'browser_navigate',
        { url: 'https://example.com/' },
        { conversationId: 'conversation-a', workspaceKey: '/workspace/a' },
      ),
    ).rejects.toThrow('请先调用 web_account_open')
    expect(browserTaskRuntime.startTask).not.toHaveBeenCalled()
  })

  it('keeps unsaved login drafts and unverifiable isolated profiles fail-closed', async () => {
    const browserTaskRuntime = {
      getActiveTaskForConversation: vi.fn().mockReturnValue(null),
      startTask: vi.fn(),
    }
    const browserManager = {
      getViewIdForWorkspace: () => 'draft-tab',
      getViewProfileId: () => 'web-draft-a',
    }
    const context = { conversationId: 'conversation-a', workspaceKey: '/workspace/a' }
    const draftModule = new BrowserToolModule(
      mockBridge,
      browserTaskRuntime as any,
      browserManager as any,
      { isDraftProfile: () => true, resolveAccountIdByProfile: () => null } as any,
    )
    await expect(
      draftModule.execute('browser_navigate', { url: 'https://example.com/' }, context),
    ).rejects.toThrow('尚未保存的登录草稿')

    const unavailableModule = new BrowserToolModule(
      mockBridge,
      browserTaskRuntime as any,
      browserManager as any,
      null,
    )
    await expect(
      unavailableModule.execute('browser_navigate', { url: 'https://example.com/' }, context),
    ).rejects.toThrow('无法验证当前隔离登录环境')
    expect(browserTaskRuntime.startTask).not.toHaveBeenCalled()
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

  it('marks a dispatched write result unknown after a transport loss without replaying it', async () => {
    const task = {
      id: 'task-a',
      tabId: 'visible-tab',
      goal: 'click once',
      status: 'running',
      startedAt: 1,
      downloadIds: [],
    }
    const page = {
      url: () => 'https://example.com/',
      click: vi.fn().mockRejectedValue(new Error('Target closed after dispatch')),
    }
    const markActionResultUnknown = vi.fn()
    const bridge = {
      getPage: () => page,
      getPageById: () => page,
      getActiveTabId: () => 'visible-tab',
      getConnectionGeneration: () => 3,
      isConnectionLoss: () => true,
      switchToPage: vi.fn().mockResolvedValue(undefined),
    }
    const runtime = {
      assertCanRunAction: () => task,
      startActionLog: () => ({ id: 'log-a' }),
      failActionLog: vi.fn(),
      markActionResultUnknown,
    }
    const manager = {
      getActiveViewId: () => 'visible-tab',
      setActive: vi.fn(),
      getCurrentURL: () => 'https://example.com/',
    }
    const module = new BrowserToolModule(bridge as any, runtime as any, manager as any)

    await expect(module.execute('browser_click', { selector: '#submit' })).rejects.toMatchObject({
      code: 'action_result_unknown_after_disconnect',
    })
    expect(page.click).toHaveBeenCalledTimes(1)
    expect(markActionResultUnknown).toHaveBeenCalledWith(
      'task-a',
      expect.stringContaining('结果未知'),
    )
  })

  it.each([
    ['browser_navigate', 'navigate', { url: 'https://example.com/next' }],
    ['browser_go_back', 'goBack', {}],
    ['browser_go_forward', 'goForward', {}],
    ['browser_reload', 'reload', {}],
  ])(
    'checks automation binding after %s and never replays it',
    async (toolName, method, params) => {
      const bridge = {
        getPage: () => null,
        getPageById: () => null,
        getActiveTabId: () => 'visible-tab',
        switchToPage: vi.fn().mockResolvedValue(undefined),
      }
      const command = vi.fn().mockResolvedValue(undefined)
      const manager = {
        getActiveViewId: () => 'visible-tab',
        setActive: vi.fn(),
        [method]: command,
        ensurePlaywrightPage: vi.fn().mockRejectedValue(new Error('contexts=0')),
        getCurrentURL: () => 'https://example.com/next',
        getTitle: () => 'Example',
      }
      const module = new BrowserToolModule(bridge as any, null, manager as any)

      await expect(module.execute(toolName, params)).rejects.toMatchObject({
        code: 'browser_automation_unavailable',
        commandDispatched: true,
      })
      expect(command).toHaveBeenCalledTimes(1)
    },
  )

  it('keeps automation attached to a Browser View owned by an auxiliary window', async () => {
    const page = {
      url: () => 'https://detached.example/',
      click: vi.fn().mockResolvedValue(undefined),
    }
    const bridge = {
      getPage: () => page,
      getPageById: vi.fn().mockReturnValue(page),
      getActiveTabId: () => 'detached-tab',
      switchToPage: vi.fn().mockResolvedValue(undefined),
    }
    const browserManager = {
      getActiveViewId: () => null,
      getViewOwnerWindowId: vi.fn().mockReturnValue('aux-detached-tab'),
      setActiveForWindow: vi.fn(),
      setActive: vi.fn(),
      getCurrentURL: () => 'https://detached.example/',
    }
    const module = new BrowserToolModule(bridge as any, null, browserManager as any)

    await expect(module.execute('browser_click', { selector: '#download' })).resolves.toEqual({
      clicked: '#download',
    })

    expect(browserManager.getViewOwnerWindowId).toHaveBeenCalledWith('detached-tab')
    expect(browserManager.setActiveForWindow).toHaveBeenCalledWith(
      'aux-detached-tab',
      'detached-tab',
    )
    expect(browserManager.setActive).not.toHaveBeenCalled()
    expect(bridge.switchToPage).toHaveBeenCalledWith('detached-tab')
    expect(page.click).toHaveBeenCalledWith('#download')
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
    const page = { isClosed: () => false, url: () => 'https://a.example/next' }
    let claimed = false
    const bridge = {
      getPage: () => (claimed ? page : null),
      getPageById: () => (claimed ? page : null),
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
      ensurePlaywrightPage: vi.fn().mockImplementation(async () => {
        claimed = true
      }),
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

  it('keeps a running conversation on its task page while the UI activates another project', async () => {
    const projectAPage = {
      url: () => 'https://a.example/dashboard',
      title: vi.fn().mockResolvedValue('Project A'),
    }
    const projectBPage = {
      url: () => 'https://www.v2ex.com/invite/activate',
      title: vi.fn().mockResolvedValue('V2EX'),
    }
    const bridge = {
      getPage: () => projectBPage,
      getPageById: vi.fn((tabId: string) =>
        tabId === 'project-a-tab' ? projectAPage : projectBPage,
      ),
      getActiveTabId: () => 'project-b-tab',
      switchToPage: vi.fn().mockResolvedValue(undefined),
    }
    const browserTaskRuntime = {
      getActiveTaskForConversation: vi.fn().mockReturnValue({
        id: 'task-a',
        tabId: 'project-a-tab',
        goal: 'read A',
        status: 'running',
        startedAt: 1,
        downloadIds: [],
        correlation: {
          workspaceKey: '/workspace/a',
          conversationId: 'conversation-a',
        },
      }),
      assertCanRunAction: vi.fn().mockReturnValue(null),
    }
    const browserManager = {
      getViewWorkspaceKey: vi.fn((tabId: string) =>
        tabId === 'project-a-tab' ? '/workspace/a' : '/workspace/b',
      ),
      isWorkspaceActive: vi.fn().mockReturnValue(false),
      setActive: vi.fn(),
      getCurrentURL: vi.fn((tabId: string) =>
        tabId === 'project-a-tab'
          ? 'https://a.example/dashboard'
          : 'https://www.v2ex.com/invite/activate',
      ),
    }
    const module = new BrowserToolModule(
      bridge as any,
      browserTaskRuntime as any,
      browserManager as any,
    )

    await expect(
      module.execute(
        'browser_title',
        {},
        { conversationId: 'conversation-a', workspaceKey: '/workspace/a' },
      ),
    ).resolves.toEqual({ title: 'Project A' })
    expect(bridge.getPageById).toHaveBeenCalledWith('project-a-tab')
    expect(projectBPage.title).not.toHaveBeenCalled()
    expect(browserManager.setActive).not.toHaveBeenCalled()
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
