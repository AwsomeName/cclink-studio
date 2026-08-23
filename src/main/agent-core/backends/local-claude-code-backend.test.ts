import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

function createDeferredQuery(): AsyncIterable<unknown> & {
  close: ReturnType<typeof vi.fn>
  getContextUsage: ReturnType<typeof vi.fn>
  returned: ReturnType<typeof vi.fn>
  release: (event: Record<string, unknown>) => void
} {
  let release: ((result: IteratorResult<unknown>) => void) | null = null
  const returned = vi.fn(async () => ({ done: true as const, value: undefined }))
  const close = vi.fn(() => release?.({ done: true, value: undefined }))
  const iterator = {
    next: vi.fn(
      () =>
        new Promise<IteratorResult<unknown>>((resolve) => {
          release = resolve
        }),
    ),
    return: returned,
  }
  return {
    close,
    getContextUsage: vi.fn(async () => null),
    returned,
    release: (event) => release?.({ done: false, value: event }),
    [Symbol.asyncIterator]() {
      return iterator
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

function createBackendFixture(
  externalMcp = false,
  workspacePath = '/Users/apple/Desktop/project',
): {
  backend: LocalClaudeCodeBackend
  createToolSession: ReturnType<typeof vi.fn>
  releaseToolSession: ReturnType<typeof vi.fn>
  cancelToolSession: ReturnType<typeof vi.fn>
  composeMcpConfig: ReturnType<typeof vi.fn>
} {
  const playwrightBridge: BrowserAutomationHost = {
    getPage: () => ({ url: () => 'https://www.baidu.com/' }),
  }
  const createToolSession = vi.fn(() => 'mcp-session-1')
  const releaseToolSession = vi.fn()
  const cancelToolSession = vi.fn()
  const toolHost = {
    getPort: () => 39876,
    createToolSession,
    releaseToolSession,
    cancelToolSession,
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
      getWorkspacePath: () => workspacePath,
      hostContext: {
        hostName: 'CCLink Studio',
        mcpServerName: 'cclink_studio',
        androidControllerName: 'CCLink Studio',
      },
    },
  )

  return { backend, createToolSession, releaseToolSession, cancelToolSession, composeMcpConfig }
}

function createBackend(): LocalClaudeCodeBackend {
  return createBackendFixture().backend
}

function getLastQueryParams(): {
  prompt: string | AsyncIterable<unknown>
  options: Record<string, any>
} {
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
    expect(params.options.maxBudgetUsd).toBeUndefined()
    expect(params.options.env.ANTHROPIC_BASE_URL).toBe('https://open.bigmodel.cn/api/anthropic')
    expect(params.options.env.ANTHROPIC_API_KEY).toBe('test-api-key')
    expect(params.options.env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('cclink-studio/0.1.1')
    expect(params.options.tools).toBeUndefined()
    expect(params.options.disallowedTools).toEqual([
      'CronCreate',
      'CronDelete',
      'CronList',
      'ScheduleWakeup',
      'RemoteTrigger',
    ])
    expect(params.options.skills).toBeUndefined()
    expect(params.options.settings).toMatchObject({ skillOverrides: { loop: 'off' } })
    expect(params.options.hooks.PreToolUse).toHaveLength(1)
    expect(getSystemPromptAppend()).toContain('| browser_new_tab |')
    expect(getSystemPromptAppend()).toContain('ScheduledTaskService 是定时任务')
    expect(getSystemPromptAppend()).toContain('scheduled_task_list')
  })

  it('does not let an aborted SDK query emit into or clean up the next query', async () => {
    const previousQuery = createDeferredQuery()
    const nextQuery = createDeferredQuery()
    queryMock.mockReturnValueOnce(previousQuery).mockReturnValueOnce(nextQuery)
    const { backend, releaseToolSession, cancelToolSession } = createBackendFixture()
    const onEvent = vi.fn()
    backend.onEvent(onEvent)

    await backend.sendMessage('等待后终止')
    await backend.abort()
    await backend.sendMessage('终止后的新消息')
    previousQuery.release({
      type: 'stream_event',
      event: { type: 'message_start', message: { id: 'late-message' } },
    })

    expect(previousQuery.close).toHaveBeenCalledTimes(1)
    expect(onEvent).not.toHaveBeenCalled()
    expect(backend.getStatus().connected).toBe(true)
    expect(cancelToolSession).toHaveBeenCalledTimes(1)
    expect(releaseToolSession).not.toHaveBeenCalled()

    await backend.abort()
    expect(nextQuery.close).toHaveBeenCalledTimes(1)
    expect(cancelToolSession).toHaveBeenCalledTimes(2)
    expect(releaseToolSession).not.toHaveBeenCalled()
  })

  it('does not finish abort until in-flight Studio tools have drained', async () => {
    const query = createDeferredQuery()
    queryMock.mockReturnValue(query)
    const { backend, cancelToolSession } = createBackendFixture()
    let finishToolDrain!: () => void
    cancelToolSession.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishToolDrain = resolve
      }),
    )

    await backend.sendMessage('执行工具后取消')
    let abortSettled = false
    const abort = backend.abort().finally(() => {
      abortSettled = true
    })
    await vi.waitFor(() => expect(query.close).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(abortSettled).toBe(false)

    finishToolDrain()
    await abort

    expect(abortSettled).toBe(true)
    expect(cancelToolSession).toHaveBeenCalledWith('mcp-session-1')
  })

  it('injects a resolved role into the system prompt without changing tool permissions', async () => {
    await createBackend().sendMessage('评估这个方案', {
      agentProfile: {
        ref: { roleId: 'critical-challenger', version: 1 },
        label: '反方挑战者',
        systemInstructions: '检查反例和失败路径。',
      },
    })

    const params = getLastQueryParams()
    expect(getSystemPromptAppend()).toContain('### 当前 Agent 角色')
    expect(getSystemPromptAppend()).toContain('反方挑战者')
    expect(getSystemPromptAppend()).toContain('critical-challenger@1')
    expect(getSystemPromptAppend()).toContain('检查反例和失败路径。')
    expect(getSystemPromptAppend()).toContain('不能扩大工具权限')
    expect(params.options.allowedTools).toEqual(['mcp__cclink_studio__*'])
  })

  it('injects the selected role again on the second send of the same backend conversation', async () => {
    const backend = createBackend()
    const agentProfile = {
      ref: { roleId: 'fact-checker', version: 1 },
      label: '事实核查员',
      systemInstructions: '区分事实、推断和观点。',
    } as const

    await backend.sendMessage('第一轮', { agentProfile })
    await backend.sendMessage('第二轮', { agentProfile })

    expect(queryMock).toHaveBeenCalledTimes(2)
    for (const [params] of queryMock.mock.calls) {
      expect(params.options.systemPrompt.append).toContain('fact-checker@1')
      expect(params.options.systemPrompt.append).toContain('区分事实、推断和观点。')
    }
  })

  it('sends attached images as native Claude multimodal content blocks', async () => {
    await createBackend().sendMessage('分析这张截图', {
      images: [
        {
          id: 'image-1',
          name: 'screen.png',
          mediaType: 'image/png',
          data: 'AQID',
          size: 3,
        },
      ],
    })

    const prompt = getLastQueryParams().prompt
    expect(typeof prompt).not.toBe('string')
    const messages: unknown[] = []
    for await (const message of prompt as AsyncIterable<unknown>) messages.push(message)
    expect(messages).toEqual([
      {
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '分析这张截图' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'AQID',
              },
            },
          ],
        },
        parent_tool_use_id: null,
      },
    ])
  })

  it('lets the SDK use its own executable only when no resolved path was supplied', async () => {
    const playwrightBridge: BrowserAutomationHost = { getPage: () => null }
    const toolHost = {
      getPort: () => 39876,
      createToolSession: () => 'mcp-session-1',
      releaseToolSession: vi.fn(),
      cancelToolSession: vi.fn(),
      getAllTools: () => [],
    } as unknown as McpToolHost
    const backend = new LocalClaudeCodeBackend(
      playwrightBridge,
      toolHost,
      { composeMcpConfig: () => ({ mcpServers: {} }) },
      undefined as never,
      { getWorkspacePath: () => '/Users/apple/Desktop/project' },
    )

    await backend.sendMessage('普通问答')

    expect(getLastQueryParams().options).not.toHaveProperty('pathToClaudeCodeExecutable')
  })

  it('blocks file tools from using absolute paths outside the conversation workspace', async () => {
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

    const editorResult = await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'mcp__cclink_studio__editor_write',
        tool_input: {
          filePath: '/Users/someone-else/Documents/unrelated-project/report.md',
          content: '# report',
        },
        tool_use_id: 'tool-editor-outside',
      },
      'tool-editor-outside',
      { signal: new AbortController().signal },
    )
    expect(editorResult.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(editorResult.hookSpecificOutput?.permissionDecisionReason).toContain(
      '当前会话工作区是 /Users/apple/Desktop/project',
    )
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

  it('blocks relative file and editor paths that escape the conversation workspace', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'cclink-workspace-relative-escape-'))
    const workspacePath = join(rootPath, 'workspace')
    const otherWorkspacePath = join(rootPath, 'other-workspace')
    await Promise.all([mkdir(workspacePath), mkdir(otherWorkspacePath)])
    try {
      const { backend } = createBackendFixture(false, workspacePath)
      await backend.sendMessage('读取项目文件')
      const hook = getLastQueryParams().options.hooks.PreToolUse[0].hooks[0]

      for (const [index, item] of [
        {
          tool_name: 'Read',
          tool_input: { file_path: '../other-workspace/secret.md' },
        },
        {
          tool_name: 'mcp__cclink_studio__editor_write',
          tool_input: { filePath: '../other-workspace/secret.md', content: 'secret' },
        },
        {
          tool_name: 'mcp__cclink_studio__editor_list',
          tool_input: { dirPath: '../other-workspace' },
        },
      ].entries()) {
        const result = await hook(
          {
            hook_event_name: 'PreToolUse',
            ...item,
            tool_use_id: `relative-escape-${index}`,
          },
          `relative-escape-${index}`,
          { signal: new AbortController().signal },
        )
        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
        expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
          `当前会话工作区是 ${workspacePath}`,
        )
      }
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })

  it('blocks file and editor paths whose workspace symlink resolves outside the workspace', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'cclink-workspace-symlink-escape-'))
    const workspacePath = join(rootPath, 'workspace')
    const otherWorkspacePath = join(rootPath, 'other-workspace')
    await Promise.all([mkdir(workspacePath), mkdir(otherWorkspacePath)])
    await symlink(otherWorkspacePath, join(workspacePath, 'linked-project'))
    try {
      const { backend } = createBackendFixture(false, workspacePath)
      await backend.sendMessage('读取项目文件')
      const hook = getLastQueryParams().options.hooks.PreToolUse[0].hooks[0]

      for (const [index, item] of [
        {
          tool_name: 'Read',
          tool_input: { file_path: 'linked-project/secret.md' },
        },
        {
          tool_name: 'mcp__cclink_studio__editor_write',
          tool_input: { filePath: 'linked-project/secret.md', content: 'secret' },
        },
        {
          tool_name: 'mcp__cclink_studio__editor_list',
          tool_input: { dirPath: 'linked-project' },
        },
      ].entries()) {
        const result = await hook(
          {
            hook_event_name: 'PreToolUse',
            ...item,
            tool_use_id: `symlink-escape-${index}`,
          },
          `symlink-escape-${index}`,
          { signal: new AbortController().signal },
        )
        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
      }
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })

  it('passes the same normalized workspace path to file and editor tool execution', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'cclink-workspace-normalized-path-'))
    try {
      const canonicalWorkspacePath = await realpath(workspacePath)
      const { backend } = createBackendFixture(false, workspacePath)
      await backend.sendMessage('更新项目文件')
      const hook = getLastQueryParams().options.hooks.PreToolUse[0].hooks[0]

      const writeResult = await hook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'mcp__cclink_studio__editor_write',
          tool_input: { filePath: 'docs/report.md', content: '# report' },
          tool_use_id: 'normalized-editor-write',
        },
        'normalized-editor-write',
        { signal: new AbortController().signal },
      )
      expect(writeResult).toMatchObject({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: {
            filePath: join(canonicalWorkspacePath, 'docs', 'report.md'),
            content: '# report',
          },
        },
      })

      const listResult = await hook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'mcp__cclink_studio__editor_list',
          tool_input: { dirPath: 'docs' },
          tool_use_id: 'normalized-editor-list',
        },
        'normalized-editor-list',
        { signal: new AbortController().signal },
      )
      expect(listResult).toMatchObject({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput: { dirPath: join(canonicalWorkspacePath, 'docs') },
        },
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('blocks native scheduling tools, /loop, system schedulers and Claude task files', async () => {
    await createBackend().sendMessage('检查定时任务')

    const hook = getLastQueryParams().options.hooks.PreToolUse[0].hooks[0]
    const cases = [
      { tool_name: 'CronList', tool_input: {} },
      { tool_name: 'Skill', tool_input: { skill: 'loop' } },
      { tool_name: 'Bash', tool_input: { command: 'sudo crontab -e' } },
      { tool_name: 'Bash', tool_input: { command: 'systemctl enable report.timer' } },
      {
        tool_name: 'Write',
        tool_input: {
          file_path: '/Users/apple/Desktop/project/.claude/scheduled_tasks.json',
          content: '{}',
        },
      },
      {
        tool_name: 'Write',
        tool_input: {
          file_path: '/Users/apple/Desktop/project/.claude/sub/../scheduled_tasks.json',
          content: '{}',
        },
      },
      {
        tool_name: 'Write',
        tool_input: {
          file_path: '/Users/apple/Desktop/project/claude-alias/scheduled_tasks.json',
          content: '{}',
        },
      },
      {
        tool_name: 'Bash',
        tool_input: {
          command: 'cd .claude && mv scheduled_tasks.json.disabled scheduled_tasks.json',
        },
      },
      {
        tool_name: 'mcp__cclink_studio__editor_insert',
        tool_input: { content: '{}', position: 'end' },
      },
      {
        tool_name: 'mcp__cclink_studio__editor_insert',
        tool_input: { filePath: ' ', content: '{}', position: 'end' },
      },
      {
        tool_name: 'mcp__cclink_studio__editor_save',
        tool_input: {},
      },
    ]

    for (const [index, item] of cases.entries()) {
      const result = await hook(
        {
          hook_event_name: 'PreToolUse',
          ...item,
          tool_use_id: `scheduling-${index}`,
        },
        `scheduling-${index}`,
        { signal: new AbortController().signal },
      )
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
      expect(result.hookSpecificOutput?.permissionDecisionReason).toMatch(
        /(?:NATIVE_SCHEDULING|SYSTEM_SCHEDULER|UNBOUND_EDITOR_MUTATION)/,
      )
    }
  })

  it('fails closed before resuming when a workspace contains native scheduled task state', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'cclink-native-scheduling-'))
    await mkdir(join(workspacePath, '.claude'))
    await writeFile(join(workspacePath, '.claude', 'scheduled_tasks.json'), '{}', 'utf8')
    try {
      const { backend, createToolSession } = createBackendFixture(false, workspacePath)
      const onEvent = vi.fn()
      backend.onEvent(onEvent)
      backend.setSessionId('legacy-session')

      await backend.sendMessage('继续旧会话')

      expect(queryMock).not.toHaveBeenCalled()
      expect(createToolSession).not.toHaveBeenCalled()
      expect(backend.getSessionId()).toBeNull()
      expect(onEvent).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'native_scheduling_state_detected' }),
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('fails closed when the native task path itself is a dangling symlink', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'cclink-native-task-path-symlink-'))
    await mkdir(join(workspacePath, '.claude'))
    await symlink('../ordinary.json', join(workspacePath, '.claude', 'scheduled_tasks.json'))
    try {
      const { backend, createToolSession } = createBackendFixture(false, workspacePath)
      const onEvent = vi.fn()
      backend.onEvent(onEvent)
      backend.setSessionId('legacy-session')

      await backend.sendMessage('继续旧会话')

      expect(queryMock).not.toHaveBeenCalled()
      expect(createToolSession).not.toHaveBeenCalled()
      expect(backend.getSessionId()).toBeNull()
      expect(onEvent).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ code: 'native_scheduling_state_detected' }),
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('blocks editor and Bash writes through a real dangling native scheduling symlink', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'cclink-native-scheduling-symlink-'))
    await mkdir(join(workspacePath, '.claude'))
    await symlink('scheduled_tasks.json', join(workspacePath, '.claude', 'alias.json'))
    try {
      const { backend } = createBackendFixture(false, workspacePath)
      await backend.sendMessage('更新项目文件')
      const hook = getLastQueryParams().options.hooks.PreToolUse[0].hooks[0]

      for (const [index, item] of [
        {
          tool_name: 'mcp__cclink_studio__editor_write',
          tool_input: { filePath: '.claude/alias.json', content: '{}' },
        },
        {
          tool_name: 'Bash',
          tool_input: { command: "cd .claude && echo '{}' > alias.json" },
        },
      ].entries()) {
        const result = await hook(
          {
            hook_event_name: 'PreToolUse',
            ...item,
            tool_use_id: `dangling-symlink-${index}`,
          },
          `dangling-symlink-${index}`,
          { signal: new AbortController().signal },
        )
        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
        expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
          'NATIVE_SCHEDULING_FILE_BLOCKED',
        )
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('blocks external symlink aliases that project back to native or system scheduling state', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'cclink-external-scheduling-symlink-'))
    const workspacePath = join(rootPath, 'workspace')
    const externalPath = join(rootPath, 'external')
    await Promise.all([mkdir(workspacePath), mkdir(externalPath)])
    const nativeAlias = join(externalPath, 'native-alias.json')
    const systemAlias = join(externalPath, 'system-alias')
    await symlink(join(workspacePath, '.claude', 'scheduled_tasks.json'), nativeAlias)
    await symlink('/Library/LaunchAgents/com.example.report.plist', systemAlias)
    try {
      const { backend } = createBackendFixture(false, workspacePath)
      await backend.sendMessage('更新项目文件')
      const hook = getLastQueryParams().options.hooks.PreToolUse[0].hooks[0]

      for (const [index, item] of [
        {
          tool_name: 'mcp__cclink_studio__editor_write',
          tool_input: { filePath: nativeAlias, content: '{}' },
        },
        {
          tool_name: 'Bash',
          tool_input: { command: `echo '{}' > ${nativeAlias}` },
        },
        {
          tool_name: 'Bash',
          tool_input: { command: `echo plist > ${systemAlias}` },
        },
      ].entries()) {
        const result = await hook(
          {
            hook_event_name: 'PreToolUse',
            ...item,
            tool_use_id: `external-symlink-${index}`,
          },
          `external-symlink-${index}`,
          { signal: new AbortController().signal },
        )
        expect(result.hookSpecificOutput?.permissionDecision).toBe('deny')
        expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
          'NATIVE_SCHEDULING_FILE_BLOCKED',
        )
      }
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })

  it('keeps ordinary workspace Bash and file writes available', async () => {
    await createBackend().sendMessage('更新项目文件')

    const hook = getLastQueryParams().options.hooks.PreToolUse[0].hooks[0]
    await expect(
      hook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'pnpm test' },
          tool_use_id: 'normal-bash',
        },
        'normal-bash',
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ continue: true })
    await expect(
      hook(
        {
          hook_event_name: 'PreToolUse',
          tool_name: 'Write',
          tool_input: {
            file_path: '/Users/apple/Desktop/project/docs/report.md',
            content: 'crontab is documented here',
          },
          tool_use_id: 'normal-write',
        },
        'normal-write',
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual({ continue: true })
  })

  it('disables invisible browser routes when a visible browser tab is forced', async () => {
    await createBackend().sendMessage('操作这个网页', { forceVisibleBrowser: true })

    const params = getLastQueryParams()
    expect(params.options.tools).toEqual([])
    expect(params.options.strictMcpConfig).toBe(true)
    expect(params.options.disallowedTools).toEqual([
      'CronCreate',
      'CronDelete',
      'CronList',
      'ScheduleWakeup',
      'RemoteTrigger',
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

    expect(createToolSession).toHaveBeenCalledWith({
      conversationId: 'conv-123',
      workspaceKey: '/Users/apple/Desktop/project-a',
      trustedWorkspace: {
        kind: 'local',
        rootPath: '/Users/apple/Desktop/project-a',
        workspaceKey: '/Users/apple/Desktop/project-a',
      },
      agentRunId: null,
      agentGoal: '操作当前会话',
    })
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

    const params = getLastQueryParams()
    expect(params).toMatchObject({
      prompt: '/compact 保留当前方案和未完成任务',
      options: { resume: '123e4567-e89b-12d3-a456-426614174000' },
    })
    expect(params.options.disallowedTools).toEqual([
      'CronCreate',
      'CronDelete',
      'CronList',
      'ScheduleWakeup',
      'RemoteTrigger',
    ])
    expect(params.options.skills).toBeUndefined()
    expect(params.options.settings).toMatchObject({ skillOverrides: { loop: 'off' } })
    expect(params.options.hooks.PreToolUse).toHaveLength(1)
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

  it.each([
    ['authentication_failed', 'API Error: 401 authentication_error invalid API key'],
    ['rate_limited', 'API Error: 429 Too many requests'],
    [
      'proxy_gateway_error',
      'API returned an empty or malformed response (HTTP 200) — check for a proxy or gateway',
    ],
    ['network_unavailable', 'fetch failed: ECONNRESET'],
  ])(
    'classifies provider failure as %s without discarding the SDK session',
    async (code, message) => {
      const backend = createBackend()
      backend.setSessionId('123e4567-e89b-12d3-a456-426614174000')
      const events: Array<{ type: string; data: any }> = []
      backend.onEvent((type, data) => events.push({ type, data }))
      queryMock.mockReturnValueOnce(
        createMockQuery([
          {
            type: 'result',
            is_error: true,
            result: message,
          },
        ]),
      )

      await backend.sendMessage('继续')

      await vi.waitFor(() =>
        expect(events.some((event) => event.type === 'error' && event.data?.code === code)).toBe(
          true,
        ),
      )
      expect(backend.getSessionId()).toBe('123e4567-e89b-12d3-a456-426614174000')
      expect(events).toContainEqual({
        type: 'error',
        data: expect.objectContaining({ code }),
      })
    },
  )

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
