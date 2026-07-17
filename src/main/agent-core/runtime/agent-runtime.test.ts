import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IAgentBackend } from '../backends/types'
import { AgentRuntime } from './agent-runtime'

const backends = vi.hoisted(() => [] as TestBackend[])

class TestBackend implements IAgentBackend {
  sessionId: string | null = null
  scope: unknown = null
  destroy = vi.fn(async () => {})
  sendMessage = vi.fn(async () => {})
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
})
