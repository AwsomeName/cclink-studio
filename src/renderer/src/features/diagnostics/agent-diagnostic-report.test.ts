import { describe, expect, it } from 'vitest'
import {
  buildAgentDiagnosticMarkdown,
  redactDiagnosticValue,
  redactText,
} from './agent-diagnostic-report'
import type { AgentMessage, AgentScope } from '../../types'

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

function minimalReportInput(
  scope: AgentScope,
): Parameters<typeof buildAgentDiagnosticMarkdown>[0] {
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
    expect(redactDiagnosticValue('input', {
      token: 'abc',
      phone: '13812345678',
      nested: { password: 'secret' },
    })).toEqual({
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
        runtime: { location: 'local', transport: 'local', backend: 'deepink-agent' },
        messages,
        input: '',
        loading: false,
        backendState: 'streaming',
        sessionId: 'session-1',
        streamingMessageId: null,
        lastCost: null,
        scope: { kind: 'browser', instanceId: 'tab-1' },
        mountedResources: [],
        mountedSkills: [],
        createdAt: 1,
        updatedAt: 2,
        archivedAt: null,
      },
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
    expect(markdown).toContain('browser_action_fail')
    expect(markdown).toContain('https://www.zhihu.com/signin?token=[redacted]')
    expect(markdown).toContain('疑似挑战：auth_required, captcha_or_bot_check')
    expect(markdown).toContain('138****5678')
    expect(markdown).toContain('ag***@example.com')
    expect(markdown).not.toContain('super-secret')
    expect(markdown).not.toContain('abcdef')
    expect(markdown).not.toContain('13812345678')
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
