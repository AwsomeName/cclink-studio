import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpToolHost } from '../tools/tool-host'
import type { ToolDefinition } from '../tools/types'
import {
  LocalClaudeCodeBackend,
  type BrowserAutomationHost,
  type McpConfigComposer,
} from './local-claude-code-backend'

const queryMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}))

function createMockQuery(events: Array<Record<string, unknown>> = []): AsyncIterable<unknown> & {
  close: ReturnType<typeof vi.fn>
} {
  return {
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event
    },
  }
}

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
    },
  }
}

function createBackendFixture(): {
  backend: LocalClaudeCodeBackend
  createToolSession: ReturnType<typeof vi.fn>
  releaseToolSession: ReturnType<typeof vi.fn>
  composeMcpConfig: ReturnType<typeof vi.fn>
} {
  const playwrightBridge: BrowserAutomationHost = {
    getPage: () => ({ url: () => 'https://www.baidu.com/' }),
  }
  const createToolSession = vi.fn(() => 'mcp-session-1')
  const releaseToolSession = vi.fn()
  const toolHost = {
    getPort: () => 39876,
    createToolSession,
    releaseToolSession,
    getAllTools: () => [
      createTool('browser_navigate'),
      createTool('browser_new_tab'),
      createTool('editor_write'),
    ],
  } as unknown as McpToolHost
  const composeMcpConfig = vi.fn((internalPort: number, sessionToken?: string) => {
    const url = new URL(`http://127.0.0.1:${internalPort}/mcp`)
    if (sessionToken) url.searchParams.set('session', sessionToken)
    return {
      mcpServers: {
        cclink_studio: { type: 'http', url: url.toString() },
      },
    }
  })
  const mcpClientMgr = {
    composeMcpConfig,
  } satisfies McpConfigComposer

  const backend = new LocalClaudeCodeBackend(
    playwrightBridge,
    toolHost,
    mcpClientMgr,
    undefined as never,
    {
      claudeCodePath: '/usr/local/bin/claude',
      apiBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
      apiKey: 'test-api-key',
      modelName: 'glm-4.6',
      getWorkspacePath: () => '/Users/apple/Desktop/project',
      hostContext: {
        hostName: 'CCLink Studio',
        mcpServerName: 'cclink_studio',
        androidControllerName: 'CCLink Studio',
      },
    },
  )

  return { backend, createToolSession, releaseToolSession, composeMcpConfig }
}

function createBackend(): LocalClaudeCodeBackend {
  return createBackendFixture().backend
}

function getLastQueryParams(): { prompt: string; options: Record<string, any> } {
  const call = queryMock.mock.calls.at(-1)
  if (!call) throw new Error('query was not called')
  return call[0]
}

function getSystemPromptAppend(): string {
  const params = getLastQueryParams()
  return params.options.systemPrompt.append
}

describe('LocalClaudeCodeBackend visible browser policy', () => {
  beforeEach(() => {
    queryMock.mockReset()
    queryMock.mockImplementation(() => createMockQuery())
  })

  it('uses the Claude Agent SDK with configured provider settings', async () => {
    await createBackend().sendMessage('普通问答')

    const params = getLastQueryParams()
    expect(params.prompt).toBe('普通问答')
    expect(params.options).toMatchObject({
      cwd: '/Users/apple/Desktop/project',
      additionalDirectories: ['/Users/apple/Desktop/project'],
      includePartialMessages: true,
      maxBudgetUsd: 1,
      model: 'glm-4.6',
      pathToClaudeCodeExecutable: '/usr/local/bin/claude',
      strictMcpConfig: true,
      allowedTools: ['mcp__cclink_studio__*'],
      mcpServers: {
        cclink_studio: {
          type: 'http',
          url: 'http://127.0.0.1:39876/mcp?session=mcp-session-1',
        },
      },
    })
    expect(params.options.env.ANTHROPIC_BASE_URL).toBe('https://open.bigmodel.cn/api/anthropic')
    expect(params.options.env.ANTHROPIC_API_KEY).toBe('test-api-key')
    expect(params.options.env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('cclink-studio/0.1.1')
    expect(params.options.tools).toBeUndefined()
    expect(params.options.disallowedTools).toBeUndefined()
    expect(getSystemPromptAppend()).toContain('| browser_new_tab |')
  })

  it('disables invisible browser routes when a visible browser tab is forced', async () => {
    await createBackend().sendMessage('操作这个网页', { forceVisibleBrowser: true })

    const params = getLastQueryParams()
    expect(params.options.tools).toEqual([])
    expect(params.options.strictMcpConfig).toBe(true)
    expect(params.options.disallowedTools).toEqual([
      'mcp__cclink_studio__browser_new_tab',
      'AskUserQuestion',
    ])

    const prompt = getSystemPromptAppend()
    expect(prompt).toContain('不要使用 Claude Code 内置 WebSearch/WebFetch')
    expect(prompt).toContain('只有 URL host 已匹配目标站点时')
    expect(prompt).toContain('不要调用 AskUserQuestion')
    expect(prompt).not.toContain('| browser_new_tab |')
  })

  it('binds MCP tool sessions to the current conversation', async () => {
    const { backend, createToolSession, releaseToolSession, composeMcpConfig } =
      createBackendFixture()

    await backend.sendMessage('操作当前会话', {
      conversationId: 'conv-123',
      workspacePath: '/Users/apple/Desktop/project-a',
    })

    expect(createToolSession).toHaveBeenCalledWith('conv-123', '/Users/apple/Desktop/project-a')
    expect(composeMcpConfig).toHaveBeenCalledWith(39876, 'mcp-session-1')
    await vi.waitFor(() => expect(releaseToolSession).toHaveBeenCalledWith('mcp-session-1'))
  })

  it('uses the conversation workspace instead of the global workspace fallback', async () => {
    await createBackend().sendMessage('继续处理旧项目', {
      workspacePath: '/Users/apple/Desktop/previous-project',
    })

    expect(getLastQueryParams().options).toMatchObject({
      cwd: '/Users/apple/Desktop/previous-project',
      additionalDirectories: ['/Users/apple/Desktop/previous-project'],
    })
  })

  it('injects the host resource context into the system prompt', async () => {
    await createBackend().sendMessage('登录我的知乎', {
      resourceContext: {
        version: 1,
        generatedAt: 1,
        scope: { kind: 'all' },
        activeBrowser: {
          tabId: 'tab-1',
          isVisible: true,
          url: 'https://www.baidu.com/s?wd=知乎',
          host: 'www.baidu.com',
          title: '知乎_百度搜索',
          profile: 'default',
          viewState: { viewMode: 'desktop', zoomMode: 'fit', zoomFactor: 1 },
          suspectedChallenges: [],
          consoleIssueCount: 0,
          networkIssueCount: 0,
        },
        workspace: {
          ref: { kind: 'local', path: '/Users/apple/Desktop/woniu-forward' },
          key: '/Users/apple/Desktop/woniu-forward',
          rootPath: '/Users/apple/Desktop/woniu-forward',
          writable: true,
        },
        config: {
          permissionMode: 'auto',
          agentEngine: 'local-claude-code',
          defaultBrowserViewMode: 'desktop',
          defaultBrowserZoomMode: 'fit',
        },
        task: {
          kind: 'browser_login',
          confidence: 'high',
          targetSite: 'zhihu',
          expectedHosts: ['www.zhihu.com', 'zhihu.com'],
          preferredUrl: 'https://www.zhihu.com/signin',
          reason: '用户要求登录 zhihu',
        },
        mountedResourceIds: [],
        notes: ['当前浏览器 host 与任务目标 host 不一致；禁止声称已经打开目标站点。'],
      },
    })

    const prompt = getSystemPromptAppend()
    expect(prompt).toContain('### CCLink Studio 资源事实包')
    expect(prompt).toContain('"host": "www.baidu.com"')
    expect(prompt).toContain('"expectedHosts"')
    expect(prompt).toContain('以这里的 URL/host/workspace/config/task 为准')
  })

  it('resumes existing Claude sessions via SDK options', async () => {
    const backend = createBackend()
    backend.setSessionId('123e4567-e89b-12d3-a456-426614174000')

    await backend.sendMessage('继续')

    expect(getLastQueryParams().options.resume).toBe('123e4567-e89b-12d3-a456-426614174000')
  })

  it('updates the stored session id from SDK init events', async () => {
    queryMock.mockReturnValueOnce(
      createMockQuery([
        {
          type: 'system',
          subtype: 'init',
          session_id: '123e4567-e89b-12d3-a456-426614174001',
        },
      ]),
    )
    const backend = createBackend()
    const events: Array<{ type: string; data: unknown }> = []
    backend.onEvent((type, data) => events.push({ type, data }))

    await backend.sendMessage('你好')

    await vi.waitFor(() =>
      expect(backend.getSessionId()).toBe('123e4567-e89b-12d3-a456-426614174001'),
    )
    expect(events.some((event) => event.type === 'system')).toBe(true)
  })

  it('emits an error when the SDK stream ends without a result event', async () => {
    queryMock.mockReturnValueOnce(
      createMockQuery([
        {
          type: 'stream_event',
          event: { type: 'message_start', message: { id: 'message-1' } },
        },
      ]),
    )
    const backend = createBackend()
    const events: Array<{ type: string; data: any }> = []
    backend.onEvent((type, data) => events.push({ type, data }))

    await backend.sendMessage('继续')

    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: 'error',
        data: expect.objectContaining({
          code: 'stream_ended_without_result',
        }),
      }),
    )
  })

  it('does not emit a silent-end error after a normal result', async () => {
    queryMock.mockReturnValueOnce(
      createMockQuery([
        {
          type: 'result',
          is_error: false,
          total_cost_usd: 0.01,
        },
      ]),
    )
    const backend = createBackend()
    const events: Array<{ type: string; data: any }> = []
    backend.onEvent((type, data) => events.push({ type, data }))

    await backend.sendMessage('继续')

    await vi.waitFor(() => expect(events.some((event) => event.type === 'complete')).toBe(true))
    expect(
      events.some(
        (event) => event.type === 'error' && event.data?.code === 'stream_ended_without_result',
      ),
    ).toBe(false)
  })
})
