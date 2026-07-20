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
  getContextUsage: ReturnType<typeof vi.fn>
} {
  return {
    close: vi.fn(),
    getContextUsage: vi.fn(async () => ({
      categories: [
        { name: 'messages', tokens: 24_000, color: '#0078d4' },
        { name: 'tools', tokens: 8_000, color: '#28a66a' },
      ],
      totalTokens: 32_000,
      maxTokens: 200_000,
      rawMaxTokens: 200_000,
      percentage: 16,
      gridRows: [],
      model: 'claude-sonnet',
      memoryFiles: [],
      mcpTools: [],
      autoCompactThreshold: 190_000,
      isAutoCompactEnabled: true,
      apiUsage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    })),
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

function createBackendFixture(externalMcp = false): {
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
        ...(externalMcp ? { knowledge: { type: 'http', url: 'https://mcp.example.com' } } : {}),
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
    expect(params.options.hooks.PreToolUse).toHaveLength(1)
    expect(getSystemPromptAppend()).toContain('| browser_new_tab |')
  })

  it('blocks built-in file tools from using absolute paths outside the conversation workspace', async () => {
    await createBackend().sendMessage('继续处理下一篇')

    const params = getLastQueryParams()
    const hook = params.options.hooks.PreToolUse[0].hooks[0]
    const result = await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Glob',
        tool_input: {
          path: '/Users/someone-else/Documents/unrelated-project',
          pattern: '*.docx',
        },
        tool_use_id: 'tool-1',
      },
      'tool-1',
      { signal: new AbortController().signal },
    )

    expect(result).toMatchObject({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining(
          '当前会话工作区是 /Users/apple/Desktop/project',
        ),
      },
    })
  })

  it('allows built-in file tools to use paths inside the conversation workspace', async () => {
    await createBackend().sendMessage('读取项目文件')

    const params = getLastQueryParams()
    const hook = params.options.hooks.PreToolUse[0].hooks[0]
    const result = await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_input: { file_path: '/Users/apple/Desktop/project/docs/next.docx' },
        tool_use_id: 'tool-2',
      },
      'tool-2',
      { signal: new AbortController().signal },
    )

    expect(result).toEqual({ continue: true })
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

  it('allows enabled external MCP servers in the all scope', async () => {
    const { backend } = createBackendFixture(true)
    await backend.sendMessage('查询外部知识库')

    expect(getLastQueryParams().options.allowedTools).toEqual([
      'mcp__cclink_studio__*',
      'mcp__knowledge__*',
    ])
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

  it('injects the UI continuity snapshot into the per-run system prompt', async () => {
    await createBackend().sendMessage('继续', {
      continuity: {
        recentMessages: [
          { role: 'user', text: '按顺序读取第九篇和第十篇' },
          { role: 'assistant', text: '第九篇已完成，接下来读取第十篇。' },
        ],
        tasks: [{ content: '读取第十篇', status: 'in_progress' }],
      },
    })

    expect(getLastQueryParams().prompt).toBe('继续')
    const prompt = getSystemPromptAppend()
    expect(prompt).toContain('CCLink Studio 会话连续性快照')
    expect(prompt).toContain('按顺序读取第九篇和第十篇')
    expect(prompt).toContain('读取第十篇')
    expect(prompt).toContain('不要重复执行已完成任务')
    expect(prompt).toContain('当前会话唯一可信的工作区根目录')
    expect(prompt).toContain('不要搜索用户主目录或猜测其他项目名')
  })

  it('resumes existing Claude sessions via SDK options', async () => {
    const backend = createBackend()
    backend.setSessionId('123e4567-e89b-12d3-a456-426614174000')

    await backend.sendMessage('继续')

    expect(getLastQueryParams().options.resume).toBe('123e4567-e89b-12d3-a456-426614174000')
  })

  it('reports the real SDK context usage snapshot', async () => {
    const backend = createBackend()
    const events: Array<{ type: string; data: unknown }> = []
    backend.onEvent((type, data) => events.push({ type, data }))
    queryMock.mockImplementationOnce(() =>
      createMockQuery([
        {
          type: 'system',
          subtype: 'init',
          session_id: '123e4567-e89b-12d3-a456-426614174000',
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: '123e4567-e89b-12d3-a456-426614174000',
          total_cost_usd: 0.01,
        },
      ]),
    )

    await backend.sendMessage('继续')

    await vi.waitFor(() =>
      expect(
        events.some(
          (event) =>
            event.type === 'system' &&
            (event.data as { subtype?: string }).subtype === 'context_usage',
        ),
      ).toBe(true),
    )
    await expect(backend.getContextUsage()).resolves.toMatchObject({
      totalTokens: 32_000,
      maxTokens: 200_000,
      percentage: 16,
      autoCompactThreshold: 190_000,
      isAutoCompactEnabled: true,
    })
  })

  it('runs manual compaction on the resumed SDK session', async () => {
    const backend = createBackend()
    backend.setSessionId('123e4567-e89b-12d3-a456-426614174000')
    queryMock.mockImplementationOnce(() =>
      createMockQuery([
        {
          type: 'system',
          subtype: 'compact_boundary',
          compact_metadata: { trigger: 'manual', pre_tokens: 160_000, post_tokens: 28_000 },
          session_id: '123e4567-e89b-12d3-a456-426614174000',
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: '123e4567-e89b-12d3-a456-426614174000',
          total_cost_usd: 0.01,
        },
      ]),
    )

    await backend.compact('保留当前方案和未完成任务')

    expect(getLastQueryParams()).toMatchObject({
      prompt: '/compact 保留当前方案和未完成任务',
      options: { resume: '123e4567-e89b-12d3-a456-426614174000' },
    })
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

  it('invalidates an incomplete SDK session after the budget limit is reached', async () => {
    const backend = createBackend()
    backend.setSessionId('123e4567-e89b-12d3-a456-426614174000')
    const events: Array<{ type: string; data: any }> = []
    backend.onEvent((type, data) => events.push({ type, data }))
    queryMock.mockReturnValueOnce(
      createMockQuery([
        {
          type: 'result',
          subtype: 'error_max_budget_usd',
          is_error: true,
          result: 'Reached maximum budget ($1)',
        },
      ]),
    )

    await backend.sendMessage('继续')

    await vi.waitFor(() => expect(backend.getSessionId()).toBeNull())
    expect(events).toContainEqual({
      type: 'error',
      data: expect.objectContaining({
        code: 'budget_exceeded',
        message: expect.stringContaining('SDK 会话已安全重置'),
      }),
    })

    await backend.sendMessage('继续')
    expect(getLastQueryParams().options.resume).toBeUndefined()
  })

  it('invalidates a resumed SDK session rejected as an invalid request', async () => {
    const backend = createBackend()
    backend.setSessionId('123e4567-e89b-12d3-a456-426614174000')
    const events: Array<{ type: string; data: any }> = []
    backend.onEvent((type, data) => events.push({ type, data }))
    queryMock.mockReturnValueOnce(
      createMockQuery([
        {
          type: 'result',
          is_error: true,
          result:
            'API Error: 400 {"error":{"message":"Invalid request","type":"invalid_request_error"}}',
        },
      ]),
    )

    await backend.sendMessage('继续')

    await vi.waitFor(() => expect(backend.getSessionId()).toBeNull())
    expect(events).toContainEqual({
      type: 'error',
      data: expect.objectContaining({ code: 'sdk_session_invalid' }),
    })
  })

  it('does not duplicate an SDK error already delivered as a result event', async () => {
    const backend = createBackend()
    const events: Array<{ type: string; data: any }> = []
    backend.onEvent((type, data) => events.push({ type, data }))
    queryMock.mockReturnValueOnce({
      close: vi.fn(),
      getContextUsage: vi.fn(async () => ({
        categories: [],
        totalTokens: 0,
        maxTokens: 200_000,
        rawMaxTokens: 200_000,
        percentage: 0,
        gridRows: [],
        model: 'claude-sonnet',
        memoryFiles: [],
        mcpTools: [],
        isAutoCompactEnabled: true,
        apiUsage: {},
      })),
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'result',
          is_error: true,
          result: 'Reached maximum budget ($1)',
        }
        throw new Error('Claude Code returned an error result: Reached maximum budget ($1)')
      },
    })

    await backend.sendMessage('继续')

    await vi.waitFor(() => expect(events.filter((event) => event.type === 'error')).toHaveLength(1))
  })
})
