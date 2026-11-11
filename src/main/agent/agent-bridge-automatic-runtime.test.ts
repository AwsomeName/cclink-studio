import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentBridge } from './agent-bridge'
import { AgentRuntimeStateStore } from './agent-runtime-state-store'
import { selectAutomaticTaskAgent } from './automatic-agent-selection'
import { createDefaultAgentConversationConfiguration } from '../../shared/agent-role'
import type {
  AgentEventHandler,
  AgentSendOptions,
  BackendConfig,
} from '../agent-core/backends/types'

const fixture = vi.hoisted(() => ({
  sends: [] as Array<{ type: string; options?: AgentSendOptions }>,
  failure: false,
  errorResult: false,
  afterComplete: null as Promise<void> | null,
}))
vi.mock('./automatic-agent-selection', () => ({ selectAutomaticTaskAgent: vi.fn() }))
vi.mock('../agent-core/backends/backend-factory', () => ({
  createBackend: (config: BackendConfig) => {
    let handler: AgentEventHandler
    let sessionId: string | null = null
    return {
      onEvent: (callback: AgentEventHandler) => {
        handler = callback
      },
      setScope: vi.fn(),
      getStatus: () => ({ connected: false, sessionId }),
      getSessionId: () => sessionId,
      setSessionId: (id: string | null) => {
        sessionId = id
      },
      resetSession: () => {
        sessionId = null
      },
      abort: vi.fn(async () => {}),
      destroy: vi.fn(async () => {}),
      sendMessage: async (_message: string, options: AgentSendOptions) => {
        fixture.sends.push({ type: config.type, options })
        if (fixture.failure) throw new Error('model request failed')
        handler('complete', {
          result: fixture.errorResult ? 'provider refused' : '# Generated',
          is_error: fixture.errorResult,
        })
        await fixture.afterComplete
      },
    }
  },
}))

const select = vi.mocked(selectAutomaticTaskAgent)
let bridge: AgentBridge
let state: AgentRuntimeStateStore
let send: ReturnType<typeof vi.fn>
beforeEach(() => {
  fixture.sends = []
  fixture.failure = false
  fixture.errorResult = false
  fixture.afterComplete = null
  select.mockReset().mockResolvedValue({ binding: { kind: 'codex' }, reason: 'CODEX_READY' })
  state = new AgentRuntimeStateStore()
  send = vi.fn()
  bridge = new AgentBridge(
    { isDestroyed: () => false, webContents: { send } } as never,
    null,
    { cancelToolSession: vi.fn() } as never,
    { cancelForRun: vi.fn() } as never,
    {} as never,
    null,
    { runtimeStateStore: state, apiKey: 'configured', claudeCodePath: process.execPath },
  )
})
afterEach(async () => {
  await bridge.destroy()
})

const context = {
  automaticRuntime: true,
  runId: 'run-1',
  workspaceRef: { kind: 'local' as const, path: '/workspace/task' },
  allowedTools: ['mcp__cclink_studio__editor_read'],
  disableBuiltinTools: true,
}

describe('main-owned automatic Agent tasks', () => {
  it('binds the fallback before onRunPrepared and keeps the task permission context', async () => {
    select.mockResolvedValue({
      binding: { kind: 'claude-code' },
      reason: 'CODEX_UNAVAILABLE:CODEX_AUTH_REQUIRED',
    })
    const onRunPrepared = vi.fn(async () => {
      expect(bridge.getRuntimeIdentity('task').agentRuntimeBindingKey).toBe('claude-code')
    })
    const articlePublishingPolicy = {
      origin: 'article-publishing' as const,
      workspaceId: 'ws',
      affairId: 'a',
      attemptId: 'at',
      executionGeneration: 1,
      launchOperationId: 'op',
    }
    await bridge.sendMessage('execute', 'task', {
      ...context,
      onRunPrepared,
      articlePublishingPolicy,
    })
    expect(onRunPrepared).toHaveBeenCalledOnce()
    expect(fixture.sends).toEqual([
      {
        type: 'local-claude-code',
        options: expect.objectContaining({
          allowedTools: context.allowedTools,
          disableBuiltinTools: true,
          articlePublishingPolicy,
        }),
      },
    ])
    expect(send).toHaveBeenCalledWith(
      'agent:stream',
      expect.objectContaining({
        subtype: 'runtime-selected',
        runtimeBinding: { kind: 'claude-code' },
        runId: 'run-1',
      }),
    )
  })

  it('returns internal text through the selected backend, then releases the conversation', async () => {
    await expect(
      bridge.requestInternalText({
        purpose: 'media-storyboard',
        prompt: 'JSON',
        workspacePath: '/workspace/task',
      }),
    ).resolves.toBe('# Generated')
    expect(fixture.sends[0]).toMatchObject({
      type: 'local-codex',
      options: { allowedTools: [], disableBuiltinTools: true },
    })
    const id = fixture.sends[0].options!.conversationId!
    expect(state.getSession(id)).toBeNull()
    expect(state.hasActiveRuns()).toBe(false)
    expect(send.mock.calls.some(([channel]) => channel === 'agent:stream')).toBe(false)
  })

  it('reports both-unavailable failures without sending or leaving an internal run active', async () => {
    select.mockRejectedValue(new Error('Codex unavailable; Claude unavailable'))
    await expect(
      bridge.requestInternalText({ purpose: 'classification', prompt: 'classify' }),
    ).rejects.toThrow('Codex unavailable; Claude unavailable')
    expect(fixture.sends).toEqual([])
    expect(state.hasActiveRuns()).toBe(false)
  })

  it('waits for the selected backend to settle before releasing an internal conversation', async () => {
    let release!: () => void
    fixture.afterComplete = new Promise<void>((resolve) => {
      release = resolve
    })
    let returned = false
    const pending = bridge
      .requestInternalText({ purpose: 'cleanup', prompt: 'generate' })
      .then((text) => {
        returned = true
        return text
      })
    await vi.waitFor(() => expect(fixture.sends).toHaveLength(1))
    expect(returned).toBe(false)
    release()
    await expect(pending).resolves.toBe('# Generated')
  })

  it('does not return an error result as successful internal text', async () => {
    fixture.errorResult = true
    await expect(
      bridge.requestInternalText({ purpose: 'narration', prompt: 'generate' }),
    ).rejects.toThrow()
    expect(state.hasActiveRuns()).toBe(false)
  })

  it('does not retry after a model request fails', async () => {
    fixture.failure = true
    await expect(bridge.sendMessage('execute', 'task', context)).rejects.toThrow(
      'model request failed',
    )
    expect(select).toHaveBeenCalledOnce()
    expect(fixture.sends).toHaveLength(1)
    expect(bridge.getRunStatus('task', 'run-1')?.status).toBe('failed')
  })

  it('does not send after cancellation during product runtime binding', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const onRunPrepared = vi.fn(() => gate)
    const pending = bridge.sendMessage('execute', 'task', { ...context, onRunPrepared })
    const rejected = expect(pending).rejects.toThrow('取消')
    await vi.waitFor(() => expect(onRunPrepared).toHaveBeenCalledOnce())
    expect((await bridge.abort('task', 'run-1')).accepted).toBe(true)
    release()
    await rejected
    expect(fixture.sends).toEqual([])
    expect(state.hasActiveRuns()).toBe(false)
  })

  it('cancels an internal generation timeout without an unhandled result or late launch', async () => {
    vi.useFakeTimers()
    select.mockImplementation(async ({ signal }) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      signal.throwIfAborted()
      return { binding: { kind: 'codex' }, reason: 'unused' }
    })
    try {
      const pending = bridge.requestInternalText({
        purpose: 'timeout',
        prompt: 'generate',
        timeoutMs: 10_000,
      })
      const rejected = expect(pending).rejects.toThrow('生成超时')
      await vi.waitFor(() => expect(select).toHaveBeenCalledOnce())
      await vi.advanceTimersByTimeAsync(10_001)
      await rejected
      expect(fixture.sends).toEqual([])
      expect(state.hasActiveRuns()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps explicit chat choices and existing native sessions', async () => {
    await bridge.sendMessage('chat', 'explicit', { runtimeBinding: { kind: 'claude-code' } })
    bridge.restoreConversation(
      'existing',
      null,
      createDefaultAgentConversationConfiguration(),
      null,
      [],
      { kind: 'claude-code' },
    )
    // Persisted ownership must also survive a host restart without reselecting Codex.
    await state.rememberSession({
      conversationId: 'existing',
      sessionId: 'session',
      compatibilityFingerprint: 'fingerprint',
      workspaceKey: '/workspace/task',
      runtimeBindingKey: 'claude-code',
      updatedAt: 1,
    })
    await bridge.sendMessage('continue', 'existing', context)
    expect(select).not.toHaveBeenCalled()
    expect(fixture.sends.map((call) => call.type)).toEqual([
      'local-claude-code',
      'local-claude-code',
    ])
  })

  it('reselects for a new product operation that explicitly discards the old native session', async () => {
    bridge.restoreConversation(
      'repeat-task',
      null,
      createDefaultAgentConversationConfiguration(),
      null,
      [],
      { kind: 'claude-code' },
    )
    await state.rememberSession({
      conversationId: 'repeat-task',
      sessionId: 'old-session',
      compatibilityFingerprint: 'fingerprint',
      workspaceKey: '/workspace/task',
      runtimeBindingKey: 'claude-code',
      updatedAt: 1,
    })
    await bridge.sendMessage('new operation', 'repeat-task', { ...context, sessionId: null })
    expect(select).toHaveBeenCalledOnce()
    expect(fixture.sends).toEqual([
      { type: 'local-codex', options: expect.objectContaining({ runId: 'run-1' }) },
    ])
    expect(state.getSession('repeat-task')).toBeNull()
    expect(bridge.getStatus('repeat-task').runtimeBinding).toEqual({ kind: 'codex' })
  })

  it.each(['cancel', 'close', 'destroy'] as const)(
    'stops preparation on %s without a late send or fallback',
    async (action) => {
      select.mockImplementation(async ({ signal }) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        )
        signal.throwIfAborted()
        return { binding: { kind: 'claude-code' }, reason: 'unused' }
      })
      const pending = bridge.sendMessage('execute', 'task', context)
      const rejected = expect(pending).rejects.toThrow(/取消|退出/)
      await vi.waitFor(() => expect(select).toHaveBeenCalledOnce())
      expect(bridge.beginConfigurationChange()).toBe(false)
      expect(bridge.isBusy('task')).toBe(true)
      await expect(
        bridge.sendMessage('duplicate', 'task', { runtimeBinding: { kind: 'claude-code' } }),
      ).rejects.toThrow('已有活动任务')
      expect(() =>
        bridge.restoreConversation('task', null, createDefaultAgentConversationConfiguration()),
      ).toThrow('正在启动')
      if (action === 'cancel') expect((await bridge.abort('task', 'run-1')).accepted).toBe(true)
      if (action === 'close') await bridge.closeConversation('task')
      if (action === 'destroy') await bridge.destroy()
      await rejected
      expect(fixture.sends).toEqual([])
      expect(bridge.getRunStatus('task', 'run-1')?.status).toBe('cancelled')
      expect(state.hasActiveRuns()).toBe(false)
    },
  )
})
