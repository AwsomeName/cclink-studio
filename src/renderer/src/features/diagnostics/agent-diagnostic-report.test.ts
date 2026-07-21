import { describe, expect, it } from 'vitest'
import {
  buildAgentDiagnosticMarkdown,
  redactDiagnosticValue,
  redactText,
  selectDiagnosticBrowserTask,
} from './agent-diagnostic-report'
import type { AgentMessage, AgentScope } from '../../types'
import type { BrowserTaskRun } from '@shared/ipc/browser'

const messages: AgentMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    rawText: '我想登录知乎，手机号 13812345678，验证码: 123456',
    timestamp: new Date('2026-07-15T10:54:02+08:00').getTime(),
    content: [{ type: 'text', text: '我想登录知乎，手机号 13812345678，验证码: 123456' }],
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    rawText: '',
    timestamp: new Date('2026-07-15T10:54:04+08:00').getTime(),
    content: [
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'browser_fill',
        input: { selector: '#password', value: 'password=super-secret' },
      },
      {
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'Timeout waiting for selector',
        is_error: true,
      },
    ],
  },
]

function minimalReportInput(scope: AgentScope): Parameters<typeof buildAgentDiagnosticMarkdown>[0] {
  return {
    generatedAt: new Date('2026-07-15T10:55:00+08:00').getTime(),
    appVersion: '0.1.1',
    platform: 'darwin',
    workspaceRef: null,
    conversation: null,
    messages: [],
    backendState: 'connected',
    permissionMode: 'auto',
    scope,
    browser: {
      tabId: null,
      url: null,
      title: null,
      profile: null,
      viewState: null,
    },
    browserTask: null,
    browserActionLogs: [],
    browserDownloads: [],
    pendingConfirmationCount: 0,
  }
}

describe('agent diagnostic report', () => {
  it('redacts sensitive values recursively', () => {
    expect(redactDiagnosticValue('cookie', 'sid=123')).toBe('[redacted]')
    expect(
      redactDiagnosticValue('input', {
        token: 'abc',
        phone: '13812345678',
        nested: { password: 'secret' },
      }),
    ).toEqual({
      token: '[redacted]',
      phone: '138****5678',
      nested: { password: '[redacted]' },
    })
  })

  it('redacts common sensitive text patterns', () => {
    const redacted = redactText('phone=13812345678 email=agent@example.com token=abcdef')
    expect(redacted).toContain('138****5678')
    expect(redacted).toContain('ag***@example.com')
    expect(redacted).toContain('token=[redacted:6 chars]')
    expect(redacted).not.toContain('abcdef')
  })

  it('builds a readable markdown report without leaking secrets', () => {
    const markdown = buildAgentDiagnosticMarkdown({
      generatedAt: new Date('2026-07-15T10:55:00+08:00').getTime(),
      appVersion: '0.1.1',
      platform: 'darwin',
      workspaceRef: null,
      conversation: {
        id: 'conv-1',
        title: '知乎操作会话',
        surface: 'assistant-panel',
        runtime: { location: 'local', transport: 'local', backend: 'cclink-studio-agent' },
        messages,
        input: '',
        loading: false,
        backendState: 'streaming',
        runStatus: 'running',
        activeRunId: 'run-1',
        sessionId: 'raw-agent-session-secret',
        streamingMessageId: null,
        lastCost: null,
        contextUsage: null,
        contextCompaction: {
          status: 'idle',
          trigger: null,
          preTokens: null,
          postTokens: null,
          error: null,
          updatedAt: null,
        },
        scope: { kind: 'browser', instanceId: 'tab-1' },
        mountedResources: [],
        mountedSkills: [],
        createdAt: 1,
        updatedAt: 2,
        archivedAt: null,
      },
      agentRuntime: {
        connected: true,
        busy: true,
        ready: true,
        runId: 'run-1',
        sessionId: 'raw-agent-session-secret',
        sessionRef: 'session-diagnostic-ref-1',
      },
      capabilities: [
        {
          name: 'browser',
          label: 'Browser',
          state: 'failed',
          available: false,
          reason: 'CDP token=abcdef',
          updatedAt: new Date('2026-07-15T10:54:20+08:00').getTime(),
        },
        {
          name: 'android',
          label: 'Android',
          state: 'unavailable',
          available: false,
          reason: '未连接用户真机',
          updatedAt: 0,
        },
      ],
      messages,
      backendState: 'streaming',
      permissionMode: 'categorized',
      scope: { kind: 'browser', instanceId: 'tab-1' },
      browser: {
        tabId: 'tab-1',
        url: 'https://www.zhihu.com/signin?token=abc',
        title: '知乎 - 登录',
        profile: 'zhihu',
        viewState: { viewMode: 'desktop', zoomMode: 'fit', zoomFactor: 1 },
      },
      browserRuntime: {
        requestedTabId: 'tab-1',
        visibleTabId: 'tab-1',
        visibleUrl: 'https://www.zhihu.com/signin?token=abc',
        visibleTitle: '知乎 - 登录',
        profileId: 'zhihu',
        viewState: { viewMode: 'desktop', zoomMode: 'fit', zoomFactor: 1 },
        playwrightTabId: 'hidden-tab',
        playwrightUrl: 'https://www.baidu.com',
        playwrightTitle: '百度一下',
        bindingStatus: 'tab_mismatch',
        engineVersions: {
          electron: '43.1.1',
          chromium: '150.0.7871.114',
          node: '24.18.0',
        },
        recentUrls: [
          'https://www.zhihu.com/signin',
          'https://www.zhihu.com/',
          'https://www.zhihu.com/signin?next=%2F',
        ],
        lastClaim: {
          status: 'failed',
          timestamp: new Date('2026-07-15T10:54:30+08:00').getTime(),
          expectedUrl: 'https://www.zhihu.com/signin',
          errorMessage: 'target mismatch',
        },
        session: {
          partition: 'persist:cclink-studio-profile-zhihu',
          persistent: true,
          cookieStoreFlushed: true,
          cookieCount: 2,
          persistentCookieCount: 2,
          expiredCookieCount: 0,
          likelyAuthCookies: [],
          cookieNames: ['captcha_session_v2', '_zap'],
          recentCookieChanges: [
            {
              name: 'z_c0',
              domain: '.zhihu.com',
              path: '/',
              secure: true,
              httpOnly: true,
              session: false,
              expiresAt: new Date('2026-08-15T10:54:20+08:00').getTime(),
              likelyAuth: true,
              timestamp: new Date('2026-07-15T10:54:20+08:00').getTime(),
              removed: true,
              cause: 'explicit',
            },
          ],
        },
        page: null,
      },
      pageDiagnostics: {
        tabId: 'tab-1',
        url: 'https://www.zhihu.com/signin?access_token=abcdef',
        title: '知乎 - 登录',
        consoleErrors: [
          {
            type: 'error',
            text: 'login failed for 13812345678',
            timestamp: new Date('2026-07-15T10:54:11+08:00').getTime(),
          },
        ],
        networkIssues: [
          {
            method: 'GET',
            url: 'https://www.zhihu.com/api/login?token=abcdef',
            status: 403,
            resourceType: 'xhr',
            timestamp: new Date('2026-07-15T10:54:12+08:00').getTime(),
          },
        ],
        suspectedChallenges: ['auth_required', 'captcha_or_bot_check'],
        pageTextSample: '请输入验证码，联系 agent@example.com',
      },
      browserTask: {
        id: 'task-1',
        tabId: 'tab-1',
        goal: '登录知乎',
        correlation: {
          workspaceKey: null,
          conversationId: 'conv-1',
          agentRunId: 'run-1',
          agentSessionRef: 'session-diagnostic-ref-1',
          profileId: 'zhihu',
        },
        status: 'failed',
        startedAt: 1,
        endedAt: 2,
        failureReason: 'selector_missing',
        errorMessage: 'password=super-secret',
        downloadIds: ['download-1'],
      },
      browserActionLogs: [
        {
          id: 'log-1',
          taskRunId: 'task-1',
          tabId: 'tab-1',
          action: 'fill',
          paramsSummary: '{"value":"password=super-secret"}',
          status: 'failed',
          startedAt: new Date('2026-07-15T10:54:05+08:00').getTime(),
          endedAt: new Date('2026-07-15T10:54:10+08:00').getTime(),
          failureReason: 'selector_missing',
          errorMessage: 'token=abcdef',
        },
      ],
      browserDownloads: [],
      pendingConfirmationCount: 0,
    })

    expect(markdown).toContain('# CCLink Studio 诊断日志')
    expect(markdown).toContain('## 关联链')
    expect(markdown).toContain('- 状态：matched')
    expect(markdown).toContain(
      'Agent session：UI/Main=一致 · ref=session-diagnostic-ref-1 · task=session-diagnostic-ref-1',
    )
    expect(markdown).toContain('[taskRunId=task-1] fill')
    expect(markdown).toContain('browser_action_fail')
    expect(markdown).toContain('https://www.zhihu.com/signin?token=[redacted]')
    expect(markdown).toContain('疑似挑战：auth_required, captcha_or_bot_check')
    expect(markdown).toContain('绑定状态：tab_mismatch')
    expect(markdown).toContain('浏览器内核：Electron 43.1.1 / Chromium 150.0.7871.114')
    expect(markdown).toContain('可视 URL：https://www.zhihu.com/signin?token=[redacted]')
    expect(markdown).toContain('自动化 URL：https://www.baidu.com/')
    expect(markdown).toContain('Partition：persist:cclink-studio-profile-zhihu')
    expect(markdown).toContain('z_c0 · removed · cause=explicit')
    expect(markdown).toContain('认证态已被清除或撤销')
    expect(markdown).toContain('最近 Claim：failed')
    expect(markdown).toContain('主进程 busy：true')
    expect(markdown).toContain('后端 Session：已存在')
    expect(markdown).toContain('## 能力状态')
    expect(markdown).toContain('Browser (browser)：failed · 原因：CDP token=[redacted:6 chars]')
    expect(markdown).toContain('Android (android)：unavailable · 原因：未连接用户真机')
    expect(markdown).toContain('https://www.zhihu.com/signin?next=%2F')
    expect(markdown).toContain('138****5678')
    expect(markdown).toContain('ag***@example.com')
    expect(markdown).not.toContain('super-secret')
    expect(markdown).not.toContain('abcdef')
    expect(markdown).not.toContain('13812345678')
    expect(markdown).not.toContain('raw-agent-session-secret')
  })

  it('reports correlation mismatches without exposing the raw session', () => {
    const input = minimalReportInput({ kind: 'browser', instanceId: 'tab-current' })
    input.workspaceRef = { kind: 'local', path: '/workspace-current' }
    input.conversation = {
      id: 'conversation-current',
      title: 'diagnostic correlation',
      surface: 'assistant-panel',
      runtime: { location: 'local', transport: 'local', backend: 'cclink-studio-agent' },
      messages: [],
      input: '',
      loading: true,
      backendState: 'streaming',
      runStatus: 'running',
      activeRunId: 'run-current',
      lastRunEventAt: 1,
      lastRunTerminalReason: null,
      sessionId: 'raw-session-current',
      streamingMessageId: null,
      lastCost: null,
      contextUsage: null,
      contextCompaction: {
        status: 'idle',
        trigger: null,
        preTokens: null,
        postTokens: null,
        error: null,
        updatedAt: null,
      },
      scope: { kind: 'browser', instanceId: 'tab-current' },
      mountedResources: [],
      mountedSkills: [],
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
    }
    input.agentRuntime = {
      connected: true,
      busy: true,
      ready: true,
      runId: 'run-current',
      sessionId: 'raw-session-current',
      sessionRef: 'session-current-ref',
    }
    input.browser = {
      tabId: 'tab-current',
      url: 'https://example.com',
      title: 'Example',
      profile: 'profile-current',
      viewState: null,
    }
    input.browserRuntime = {
      requestedTabId: 'tab-current',
      visibleTabId: 'tab-current',
      visibleUrl: 'https://example.com',
      visibleTitle: 'Example',
      profileId: 'profile-current',
      viewState: null,
      playwrightTabId: 'tab-current',
      playwrightUrl: 'https://example.com',
      playwrightTitle: 'Example',
      bindingStatus: 'matched',
      recentUrls: [],
      lastClaim: null,
      session: null,
      page: null,
    }
    input.browserTask = {
      id: 'task-other',
      tabId: 'tab-other',
      goal: 'other operation',
      correlation: {
        workspaceKey: '/workspace-other',
        conversationId: 'conversation-other',
        agentRunId: 'run-other',
        agentSessionRef: 'session-other-ref',
        profileId: 'profile-other',
      },
      status: 'running',
      startedAt: 1,
      downloadIds: [],
    }

    const markdown = buildAgentDiagnosticMarkdown(input)
    expect(markdown).toContain('- 状态：mismatch')
    expect(markdown).toContain(
      '- 错配字段：workspace, conversation, tab, profile, agent-run, agent-session',
    )
    expect(markdown).not.toContain('raw-session-current')
    expect(markdown).not.toContain('raw-session-other')
  })

  it('selects only the current conversation task and falls back to legacy tasks', () => {
    const task = (
      id: string,
      startedAt: number,
      correlation?: BrowserTaskRun['correlation'],
    ): BrowserTaskRun => ({
      id,
      tabId: 'tab-shared',
      goal: id,
      correlation,
      status: 'completed',
      startedAt,
      endedAt: startedAt + 1,
      downloadIds: [],
    })
    const legacy = task('legacy', 10)
    const otherConversation = task('other', 30, {
      workspaceKey: '/workspace-a',
      conversationId: 'conversation-b',
      agentRunId: 'run-b',
      agentSessionRef: null,
      profileId: null,
    })
    const currentConversation = task('current', 20, {
      workspaceKey: '/workspace-a',
      conversationId: 'conversation-a',
      agentRunId: 'run-a',
      agentSessionRef: null,
      profileId: null,
    })

    expect(
      selectDiagnosticBrowserTask({
        tasks: [legacy, otherConversation, currentConversation],
        tabId: 'tab-shared',
        workspaceKey: '/workspace-a',
        conversationId: 'conversation-a',
      })?.id,
    ).toBe('current')
    expect(
      selectDiagnosticBrowserTask({
        tasks: [legacy, otherConversation],
        tabId: 'tab-shared',
        workspaceKey: '/workspace-a',
        conversationId: 'conversation-a',
      })?.id,
    ).toBe('legacy')
  })

  it('formats non-instance scopes without assuming an instance id', () => {
    expect(buildAgentDiagnosticMarkdown(minimalReportInput({ kind: 'editor' }))).toContain(
      '- Scope：editor',
    )
    expect(buildAgentDiagnosticMarkdown(minimalReportInput({ kind: 'android' }))).toContain(
      '- Scope：android',
    )
  })
})
