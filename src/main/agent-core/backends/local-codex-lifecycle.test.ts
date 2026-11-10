import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexMessage } from './codex-app-server'
import { McpToolHost } from '../tools/tool-host'
import { LocalCodexBackend } from './local-codex-backend'

const fake = vi.hoisted(() => ({
  messages: [] as Array<{ method: string; params: Record<string, unknown> }>,
  replies: [] as unknown[],
  incoming: null as null | ((message: CodexMessage) => void),
  fail: '',
  authenticated: true,
  accountType: 'chatgpt',
  requiresOpenaiAuth: true,
  configExtras: {} as Record<string, unknown>,
  stop: vi.fn(async () => {}),
}))
vi.mock('./codex-app-server', () => ({
  CodexAppServer: class {
    constructor(incoming: (message: CodexMessage) => void) {
      fake.incoming = incoming
    }
    async start() {}
    stop() {
      return fake.stop()
    }
    async request(method: string, params: Record<string, unknown>) {
      fake.messages.push({ method, params })
      if (fake.fail === method) throw new Error('fixture failure')
      if (method === 'account/read')
        return {
          account: fake.authenticated ? { type: fake.accountType } : null,
          requiresOpenaiAuth: fake.requiresOpenaiAuth,
        }
      if (method === 'config/read')
        return {
          config: {
            mcp_servers: { external: { command: 'do-not-run', tool_timeout_sec: null } },
            ...fake.configExtras,
          },
        }
      if (method.startsWith('thread/'))
        return {
          thread: { id: 'native-thread' },
          modelProvider: 'openai',
          approvalPolicy: 'untrusted',
          approvalsReviewer: 'user',
          sandbox: {
            type: params.sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite',
            networkAccess: false,
            writableRoots: [],
          },
        }
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'cclink_studio', tools: {} }] }
      return { turn: { id: 'native-turn' } }
    }
    respond(_id: unknown, result: unknown) {
      fake.replies.push(result)
    }
  },
}))

function fixture() {
  const host = {
    allowsUnattendedNativeReads: vi.fn(() => true),
    getPort: () => 12345,
    createToolSession: vi.fn(() => 'fixture-session'),
    cancelToolSession: vi.fn(async () => {}),
    getAllTools: () => ['browser_title', 'editor_read'].map((name) => ({ name })),
    authorizeSdkTool: vi.fn(async () => ({ behavior: 'deny' })),
    authorizeClassifiedTool: vi.fn<McpToolHost['authorizeClassifiedTool']>(async () => ({
      behavior: 'deny',
    })),
  }
  const backend = new LocalCodexBackend(host as unknown as McpToolHost, () => '/workspace')
  const events = vi.fn()
  backend.onEvent(events)
  return { backend, host, events }
}
async function started() {
  await vi.waitFor(() => expect(fake.messages.some((r) => r.method === 'turn/start')).toBe(true))
}
function request(method: string, params: Record<string, unknown>) {
  fake.incoming?.({
    id: 100,
    method,
    params: { threadId: 'native-thread', turnId: 'native-turn', ...params },
  })
}
function complete() {
  fake.incoming?.({
    method: 'turn/completed',
    params: { threadId: 'native-thread', turn: { id: 'native-turn', status: 'completed' } },
  })
}

beforeEach(() => {
  fake.messages = []
  fake.replies = []
  fake.fail = ''
  fake.authenticated = true
  fake.accountType = 'chatgpt'
  fake.requiresOpenaiAuth = true
  fake.configExtras = {}
  fake.stop.mockReset().mockResolvedValue(undefined)
})

describe('Codex lifecycle and authorization', () => {
  it.each([
    { accountType: 'apiKey', requiresOpenaiAuth: true, config: {} },
    { accountType: 'chatgpt', requiresOpenaiAuth: false, config: {} },
    { accountType: 'chatgpt', requiresOpenaiAuth: true, config: { model_provider: 'custom' } },
    {
      accountType: 'chatgpt',
      requiresOpenaiAuth: true,
      config: { model_providers: { openai: { base_url: 'https://example.test' } } },
    },
    {
      accountType: 'chatgpt',
      requiresOpenaiAuth: true,
      config: { chatgpt_base_url: 'https://example.test' },
    },
  ])(
    'rejects alternate authentication or provider before creating a session: %j',
    async ({ accountType, requiresOpenaiAuth, config }) => {
      fake.accountType = accountType
      fake.requiresOpenaiAuth = requiresOpenaiAuth
      fake.configExtras = config
      const { backend, host } = fixture()
      await expect(backend.sendMessage('hello')).rejects.toThrow()
      expect(host.createToolSession).not.toHaveBeenCalled()
      expect(fake.messages.some((m) => m.method === 'thread/start')).toBe(false)
      expect(fake.stop).toHaveBeenCalled()
    },
  )

  it('forces native patch deletion confirmation in the real default permission mode', async () => {
    const confirmation = vi.fn(async () => false)
    const realHost = new McpToolHost({
      getMode: () => 'auto-except-destructive',
      needsConfirmation: () => false,
      requestConfirmation: confirmation,
    })
    const { backend, host } = fixture()
    host.authorizeClassifiedTool.mockImplementation((input) =>
      realHost.authorizeClassifiedTool(input),
    )
    const run = backend.sendMessage('delete a file')
    await started()
    fake.incoming?.({
      method: 'item/started',
      params: {
        threadId: 'native-thread',
        item: {
          id: 'patch',
          type: 'fileChange',
          changes: [{ path: '/workspace/keep.txt', kind: { type: 'delete' }, diff: '' }],
        },
      },
    })
    request('item/fileChange/requestApproval', { itemId: 'patch' })
    await vi.waitFor(() => expect(fake.replies.at(-1)).toEqual({ decision: 'decline' }))
    expect(confirmation).toHaveBeenCalledWith(
      expect.objectContaining({ riskLevel: 'destructive', allowAlways: false }),
    )
    complete()
    await run
  })
  it('uses only Studio tools when native trusted reads would skip confirmation', async () => {
    const { backend, host } = fixture()
    host.allowsUnattendedNativeReads.mockReturnValue(false)
    const run = backend.sendMessage('read code')
    await started()
    const start = fake.messages.find((m) => m.method === 'thread/start')!
    expect(start.params.sandbox).toBe('read-only')
    expect(start.params.config).toMatchObject({
      'features.shell_tool': false,
      'features.unified_exec': false,
    })
    request('item/commandExecution/requestApproval', { command: 'cat file', itemId: 'command' })
    await vi.waitFor(() => expect(fake.replies.at(-1)).toEqual({ decision: 'decline' }))
    complete()
    await run
  })
  it('fails closed without auth and never creates an MCP session or Claude fallback', async () => {
    fake.authenticated = false
    const { backend, host } = fixture()
    await expect(backend.sendMessage('hello')).rejects.toThrow('尚未登录')
    expect(host.createToolSession).not.toHaveBeenCalled()
    expect(fake.stop).toHaveBeenCalled()
    expect(backend.getStatus().connected).toBe(false)
  })

  it('disables inherited MCP, narrows Studio tools and rejects stale or external approvals', async () => {
    const { backend, host } = fixture()
    backend.setScope({ kind: 'browser', instanceId: 'tab-1' })
    const run = backend.sendMessage('read page', {
      conversationId: 'conversation',
      runId: 'run',
      workspacePath: '/workspace',
    })
    await started()
    const config = fake.messages.find((m) => m.method === 'thread/start')!.params.config as Record<
      string,
      unknown
    >
    expect(config.mcp_servers).toMatchObject({
      external: { enabled: false },
      cclink_studio: { enabled_tools: ['browser_title'] },
    })
    expect(config['features.shell_tool']).toBe(false)
    request('mcpServer/elicitation/request', {
      serverName: 'cclink_studio',
      mode: 'form',
      _meta: { codex_approval_kind: 'mcp_tool_call', tool_name: 'browser_title' },
    })
    await vi.waitFor(() => expect(fake.replies.at(-1)).toEqual({ action: 'accept', content: {} }))
    request('mcpServer/elicitation/request', {
      serverName: 'external',
      mode: 'form',
      _meta: { codex_approval_kind: 'mcp_tool_call', tool_name: 'browser_title' },
    })
    await vi.waitFor(() => expect(fake.replies.at(-1)).toEqual({ action: 'decline' }))
    request('item/commandExecution/requestApproval', {
      command: 'rm file',
      itemId: 'command',
      turnId: 'old-turn',
    })
    await vi.waitFor(() => expect(fake.replies.at(-1)).toEqual({ decision: 'decline' }))
    expect(host.authorizeSdkTool).not.toHaveBeenCalled()
    complete()
    await run
    expect(host.cancelToolSession).toHaveBeenCalledWith('fixture-session')
  })

  it('routes native destructive commands to the existing broker and honours denial', async () => {
    const { backend, host } = fixture()
    const run = backend.sendMessage('delete', {
      conversationId: 'conversation',
      runId: 'run',
      workspacePath: '/workspace',
    })
    await started()
    request('item/commandExecution/requestApproval', { command: 'rm keep.txt', itemId: 'command' })
    await vi.waitFor(() => expect(fake.replies.at(-1)).toEqual({ decision: 'decline' }))
    expect(host.authorizeSdkTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'Bash',
        context: expect.objectContaining({ conversationId: 'conversation', agentRunId: 'run' }),
      }),
    )
    complete()
    await run
  })

  it('cancels its process and drains tools before reporting idle, without a late success', async () => {
    const { backend, host, events } = fixture()
    const run = backend.sendMessage('work')
    await started()
    await backend.abort()
    await run
    complete()
    expect(fake.messages.some((r) => r.method === 'turn/interrupt')).toBe(true)
    expect(host.cancelToolSession).toHaveBeenCalledTimes(1)
    expect(backend.getStatus().connected).toBe(false)
    expect(events.mock.calls.some(([type]) => type === 'complete')).toBe(false)
  })

  it('preserves a failed resume reference instead of silently starting a different thread', async () => {
    fake.fail = 'thread/resume'
    const { backend, host } = fixture()
    backend.setSessionId('previous-thread')
    await expect(backend.sendMessage('continue')).rejects.toThrow('fixture failure')
    expect(backend.getSessionId()).toBe('previous-thread')
    expect(fake.messages.some((r) => r.method === 'thread/start')).toBe(false)
    expect(host.cancelToolSession).toHaveBeenCalledWith('fixture-session')
  })
})
