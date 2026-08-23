import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IAgentBackend } from '../backends/types'
import { AgentRuntime } from './agent-runtime'

const backends = vi.hoisted(() => [] as TestBackend[])

class TestBackend implements IAgentBackend {
  sessionId: string | null = null
  scope: unknown = null
  destroy = vi.fn(async () => {})
  sendMessage = vi.fn(async () => {})
  compact = vi.fn(async () => {})
  getContextUsage = vi.fn(async () => ({
    categories: [],
    totalTokens: 40_000,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 20,
    model: 'claude-sonnet',
    autoCompactThreshold: 190_000,
    isAutoCompactEnabled: true,
    capturedAt: 1,
  }))
  abort = vi.fn(async () => {})
  eventHandler: Parameters<IAgentBackend['onEvent']>[0] | null = null

  getStatus() {
    return { connected: false, sessionId: this.sessionId }
  }

  resetSession(): void {
    this.sessionId = null
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId
  }

  setScope(scope: unknown): void {
    this.scope = scope
  }

  onEvent(handler: Parameters<IAgentBackend['onEvent']>[0]): void {
    this.eventHandler = handler
  }
}

vi.mock('../backends/backend-factory.js', () => ({
  createBackend: vi.fn(() => {
    const backend = new TestBackend()
    backends.push(backend)
    return backend
  }),
}))

describe('AgentRuntime session continuity', () => {
  beforeEach(() => {
    backends.length = 0
  })

  it('preserves session id and scope when backend settings are reconfigured', () => {
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
    })
    runtime.restoreConversation('conversation-1', 'session-1')
    runtime.setScope({ kind: 'editor' }, 'conversation-1')

    runtime.switchBackend({
      type: 'local-claude-code',
      claudeCode: { modelName: 'next-model' },
    })

    expect(runtime.getStatus('conversation-1').sessionId).toBe('session-1')
    expect(runtime.getScope('conversation-1')).toEqual({ kind: 'editor' })
  })

  it('drops SDK session ids when the runtime compatibility fingerprint changes', () => {
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
    })
    runtime.restoreConversation('conversation-1', 'session-from-other-runtime')
    runtime.setScope({ kind: 'editor' }, 'conversation-1')

    runtime.switchBackend(
      {
        type: 'local-claude-code',
        claudeCode: { claudeCodePath: '/new/runtime/claude' },
      },
      false,
    )

    expect(runtime.getStatus('conversation-1').sessionId).toBeNull()
    expect(runtime.getScope('conversation-1')).toEqual({ kind: 'editor' })
  })

  it('attaches the active run id to backend events and clears it at completion', async () => {
    const events: Array<{ conversationId: string; runId: string | null; type: string }> = []
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
      onEvent: (event) => events.push(event),
    })

    await runtime.sendMessage('hello', 'conversation-1', { runId: 'run-1' })
    expect(runtime.getStatus('conversation-1').runId).toBe('run-1')

    backends.at(-1)?.eventHandler?.('complete', { total_cost_usd: 0 })

    expect(events.at(-1)).toMatchObject({
      conversationId: 'conversation-1',
      runId: 'run-1',
      type: 'complete',
    })
    expect(runtime.getStatus('conversation-1').runId).toBeNull()
  })

  it('drops backend events that arrive after the run was aborted', async () => {
    const events: Array<{ conversationId: string; runId: string | null; type: string }> = []
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
      onEvent: (event) => events.push(event),
    })

    await runtime.sendMessage('hello', 'conversation-1', { runId: 'run-1' })
    await runtime.abort('conversation-1', 'run-1')

    backends.at(-1)?.eventHandler?.('stream', { type: 'stream_event' })
    backends.at(-1)?.eventHandler?.('complete', { total_cost_usd: 0 })

    expect(events).toEqual([])
    expect(runtime.getStatus('conversation-1').runId).toBeNull()
  })

  it('emits a terminal error when backend reconfiguration interrupts an active run', async () => {
    const events: Array<{
      conversationId: string
      runId: string | null
      type: string
      data: unknown
    }> = []
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
      onEvent: (event) => events.push(event),
    })

    await runtime.sendMessage('hello', 'conversation-1', { runId: 'run-1' })
    runtime.switchBackend({
      type: 'local-claude-code',
      claudeCode: { modelName: 'next-model' },
    })

    expect(events.at(-1)).toMatchObject({
      conversationId: 'conversation-1',
      runId: 'run-1',
      type: 'error',
      data: {
        code: 'backend_reconfigured',
      },
    })
    expect(runtime.getStatus('conversation-1').runId).toBeNull()
  })

  it('runs compaction against the selected conversation and exposes its SDK usage', async () => {
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
    })

    await runtime.compactConversation('conversation-1', '保留待办', { runId: 'compact-1' })

    const backend = backends.at(-1)
    expect(backend?.compact).toHaveBeenCalledWith('保留待办', {
      conversationId: 'conversation-1',
      runId: 'compact-1',
    })
    await expect(runtime.getContextUsage('conversation-1')).resolves.toMatchObject({
      totalTokens: 40_000,
      percentage: 20,
    })
  })

  it('clears the active run when compaction fails before emitting an event', async () => {
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
    })
    const backend = runtime.getBackend('conversation-1') as TestBackend
    backend.compact.mockRejectedValueOnce(new Error('compact unavailable'))

    await expect(
      runtime.compactConversation('conversation-1', undefined, { runId: 'compact-failed' }),
    ).rejects.toThrow('compact unavailable')
    expect(runtime.getStatus('conversation-1').runId).toBeNull()
  })

  it('binds ACP per conversation without changing the Claude default', () => {
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
    })
    runtime.bindConversationBackend('codex-thread', {
      type: 'local-acp',
      acp: {
        implementationId: 'codex-acp',
        codexHome: '/tmp/codex-acp-test',
        requestPermission: async () => false,
      },
    })

    expect(runtime.getBackendType('codex-thread')).toBe('local-acp')
    expect(runtime.getBackendType('claude-thread')).toBe('local-claude-code')
  })

  it('refuses to switch a conversation runtime after it owns a session', () => {
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
    })
    runtime.restoreConversation('conversation-1', 'session-1')

    expect(() =>
      runtime.bindConversationBackend('conversation-1', {
        type: 'local-acp',
        acp: {
          implementationId: 'codex-acp',
          codexHome: '/tmp/codex-acp-test',
          requestPermission: async () => false,
        },
      }),
    ).toThrow('不能切换')
  })

  it('reconfigures ACP conversations without replacing Claude conversations', () => {
    const runtime = new AgentRuntime({
      config: { type: 'local-claude-code' },
      deps: {} as never,
    })
    const claude = runtime.getBackend('claude-thread') as TestBackend
    runtime.bindConversationBackend('codex-thread', {
      type: 'local-acp',
      acp: {
        implementationId: 'codex-acp',
        codexHome: '/tmp/codex-acp-test',
        requestPermission: async () => false,
      },
    })
    const codex = runtime.getBackend('codex-thread') as TestBackend

    runtime.reconfigureBackendType('local-acp', {
      type: 'local-acp',
      acp: {
        implementationId: 'codex-acp',
        apiKey: 'next-key',
        codexHome: '/tmp/codex-acp-test',
        requestPermission: async () => false,
      },
    })

    expect(runtime.getBackend('claude-thread')).toBe(claude)
    expect(runtime.getBackend('codex-thread')).not.toBe(codex)
    expect(claude.destroy).not.toHaveBeenCalled()
    expect(codex.destroy).toHaveBeenCalledOnce()
  })
})
