import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentBridge } from './agent-bridge'
import { AgentRuntimeStateStore } from './agent-runtime-state-store'

const queryMock = vi.hoisted(() => vi.fn())
const temporaryDirectories: string[] = []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }))

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function createBlockingQuery(): AsyncIterable<unknown> & {
  close: ReturnType<typeof vi.fn>
  releaseDone: () => void
} {
  let resolveNext: ((result: IteratorResult<unknown>) => void) | null = null
  const iterator = {
    next: () =>
      new Promise<IteratorResult<unknown>>((resolve) => {
        resolveNext = resolve
      }),
    return: vi.fn(async () => ({ done: true as const, value: undefined })),
  }
  return {
    close: vi.fn(),
    releaseDone: () => resolveNext?.({ done: true, value: undefined }),
    [Symbol.asyncIterator]() {
      return iterator
    },
  }
}

function createCancellationRaceQuery(): AsyncIterable<unknown> & {
  close: ReturnType<typeof vi.fn>
  releaseResult: () => void
  releaseDone: () => void
  getContextUsage: ReturnType<typeof vi.fn>
} {
  const pending: Array<(result: IteratorResult<unknown>) => void> = []
  const iterator = {
    next: () =>
      new Promise<IteratorResult<unknown>>((resolve) => {
        pending.push(resolve)
      }),
    return: vi.fn(async () => ({ done: true as const, value: undefined })),
  }
  return {
    close: vi.fn(),
    releaseResult: () =>
      pending.shift()?.({
        done: false,
        value: { type: 'result', subtype: 'success', is_error: false, result: 'done' },
      }),
    releaseDone: () => pending.shift()?.({ done: true, value: undefined }),
    getContextUsage: vi.fn(async () => null),
    [Symbol.asyncIterator]() {
      return iterator
    },
  }
}

function createBridge(
  permissionManager: { cancelForRun: ReturnType<typeof vi.fn> },
  runtimeStateStore?: AgentRuntimeStateStore,
  cancelToolSession: ReturnType<typeof vi.fn> = vi.fn(),
): {
  bridge: AgentBridge
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn()
  return {
    bridge: new AgentBridge(
      { isDestroyed: () => false, webContents: { send } } as never,
      null,
      {
        getPort: () => 39876,
        getAllTools: () => [],
        createToolSession: vi.fn(() => 'mcp-session'),
        releaseToolSession: vi.fn(),
        cancelToolSession,
      } as never,
      permissionManager as never,
      { composeMcpConfig: () => ({ mcpServers: {} }) } as never,
      null,
      {
        sessionCompatibilityFingerprint: 'runtime-fingerprint',
        ...(runtimeStateStore ? { runtimeStateStore } : {}),
      },
    ),
    send,
  }
}

describe('AgentBridge run lifecycle', () => {
  beforeEach(() => queryMock.mockReset())

  it('keeps an exact cancelled run occupied until the Runtime read loop exits', async () => {
    const query = createBlockingQuery()
    queryMock.mockReturnValue(query)
    const permissionManager = { cancelForRun: vi.fn(), requestConfirmation: vi.fn() }
    const { bridge, send } = createBridge(permissionManager)

    await bridge.sendMessage('first', 'conversation-1', {
      runId: 'run-1',
      workspaceRef: { kind: 'global' },
      sessionId: null,
    })
    await expect(bridge.abort('conversation-1', 'run-1')).resolves.toMatchObject({
      accepted: true,
      run: { status: 'cancelling' },
    })
    expect(bridge.getRunStatus('conversation-1', 'run-1')).toMatchObject({
      status: 'cancelling',
    })
    await expect(
      bridge.sendMessage('must be rejected', 'conversation-1', {
        runId: 'run-2',
        workspaceRef: { kind: 'global' },
        sessionId: null,
      }),
    ).rejects.toThrow('run-1')
    await expect(bridge.abort('conversation-1', 'run-1')).resolves.toMatchObject({
      accepted: true,
      run: { status: 'cancelling' },
    })
    expect(permissionManager.cancelForRun).toHaveBeenCalledWith('conversation-1', 'run-1')
    expect(query.close).toHaveBeenCalledTimes(1)

    query.releaseDone()
    await vi.waitFor(() =>
      expect(bridge.getRunStatus('conversation-1', 'run-1')).toMatchObject({
        status: 'cancelled',
        completedAt: expect.any(Number),
      }),
    )
    expect(send).toHaveBeenCalledWith(
      'agent:runStatus',
      expect.objectContaining({ runId: 'run-1', status: 'cancelled' }),
    )
    await bridge.destroy()
  })

  it('waits for Runtime exit and tool drain when cancellation races with a Runtime result', async () => {
    const query = createCancellationRaceQuery()
    queryMock.mockReturnValue(query)
    const runtimeStateStore = new AgentRuntimeStateStore()
    const originalMarkCancelling = runtimeStateStore.markCancelling.bind(runtimeStateStore)
    let releaseCancellingPersist!: () => void
    vi.spyOn(runtimeStateStore, 'markCancelling').mockImplementationOnce(
      async (conversationId, runId) => {
        const result = await originalMarkCancelling(conversationId, runId)
        await new Promise<void>((resolve) => {
          releaseCancellingPersist = resolve
        })
        return result
      },
    )
    let finishToolDrain!: () => void
    const cancelToolSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishToolDrain = resolve
        }),
    )
    const { bridge, send } = createBridge(
      { cancelForRun: vi.fn() },
      runtimeStateStore,
      cancelToolSession,
    )

    await bridge.sendMessage('first', 'conversation-1', {
      runId: 'run-1',
      workspaceRef: { kind: 'global' },
      sessionId: null,
    })
    const firstAbort = bridge.abort('conversation-1', 'run-1')
    await vi.waitFor(() =>
      expect(bridge.getRunStatus('conversation-1', 'run-1')).toMatchObject({
        status: 'cancelling',
      }),
    )

    query.releaseResult()
    await vi.waitFor(() => expect(query.getContextUsage).toHaveBeenCalled())
    await Promise.resolve()

    expect(bridge.getRunStatus('conversation-1', 'run-1')).toMatchObject({
      status: 'cancelling',
      completedAt: null,
    })
    expect(
      send.mock.calls.some(
        ([channel, record]) => channel === 'agent:runStatus' && record?.status === 'cancelled',
      ),
    ).toBe(false)
    expect(bridge.getStatus('conversation-1').runId).toBe('run-1')

    releaseCancellingPersist()
    await expect(firstAbort).resolves.toMatchObject({
      accepted: true,
      run: { status: 'cancelling' },
    })
    await expect(bridge.abort('conversation-1', 'run-1')).resolves.toMatchObject({
      accepted: true,
      run: { status: 'cancelling' },
    })
    await expect(
      bridge.sendMessage('must remain blocked', 'conversation-1', {
        runId: 'run-2',
        workspaceRef: { kind: 'global' },
        sessionId: null,
      }),
    ).rejects.toThrow('run-1')

    query.releaseDone()
    await Promise.resolve()
    expect(bridge.getRunStatus('conversation-1', 'run-1')).toMatchObject({
      status: 'cancelling',
      completedAt: null,
    })

    finishToolDrain()
    await vi.waitFor(() =>
      expect(bridge.getRunStatus('conversation-1', 'run-1')).toMatchObject({
        status: 'cancelled',
        completedAt: expect.any(Number),
      }),
    )

    const cancelledEvents = send.mock.calls.filter(
      ([channel, record]) => channel === 'agent:runStatus' && record?.status === 'cancelled',
    )
    expect(cancelledEvents).toHaveLength(1)
    await bridge.destroy()
  })

  it('does not start cancellation when natural completion wins before cancelling is recorded', async () => {
    const query = createBlockingQuery()
    queryMock.mockReturnValue(query)
    const runtimeStateStore = new AgentRuntimeStateStore()
    const originalMarkCancelling = runtimeStateStore.markCancelling.bind(runtimeStateStore)
    const markCancelling = vi.spyOn(runtimeStateStore, 'markCancelling')
    const { bridge } = createBridge({ cancelForRun: vi.fn() }, runtimeStateStore)

    await bridge.sendMessage('first', 'conversation-1', {
      runId: 'run-1',
      workspaceRef: { kind: 'global' },
      sessionId: null,
    })
    markCancelling.mockImplementationOnce(async (conversationId, runId) => {
      await runtimeStateStore.finishRun(conversationId, runId, 'succeeded')
      return originalMarkCancelling(conversationId, runId)
    })

    await expect(bridge.abort('conversation-1', 'run-1')).resolves.toMatchObject({
      accepted: false,
      run: { status: 'succeeded' },
      error: '目标任务已自然结束',
    })
    query.releaseDone()
    await bridge.destroy()
  })

  it('keeps the run cancelling until in-flight Studio tools have drained', async () => {
    const query = createBlockingQuery()
    queryMock.mockReturnValue(query)
    let finishToolDrain!: () => void
    const cancelToolSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishToolDrain = resolve
        }),
    )
    const { bridge } = createBridge({ cancelForRun: vi.fn() }, undefined, cancelToolSession)

    await bridge.sendMessage('first', 'conversation-1', {
      runId: 'run-1',
      workspaceRef: { kind: 'global' },
      sessionId: null,
    })
    await bridge.abort('conversation-1', 'run-1')
    query.releaseDone()
    await Promise.resolve()

    expect(bridge.getRunStatus('conversation-1', 'run-1')).toMatchObject({
      status: 'cancelling',
      completedAt: null,
    })

    finishToolDrain()
    await vi.waitFor(() =>
      expect(bridge.getRunStatus('conversation-1', 'run-1')).toMatchObject({
        status: 'cancelled',
        completedAt: expect.any(Number),
      }),
    )
    await bridge.destroy()
  })

  it('lets App shutdown detach an unresponsive tool and repairs the run on restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cclink-agent-exit-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'state.json')
    const runtimeStateStore = new AgentRuntimeStateStore(filePath)
    await runtimeStateStore.load()
    const query = createBlockingQuery()
    queryMock.mockReturnValue(query)
    const cancelToolSession = vi.fn(() => new Promise<void>(() => undefined))
    const { bridge } = createBridge({ cancelForRun: vi.fn() }, runtimeStateStore, cancelToolSession)

    await bridge.sendMessage('first', 'conversation-1', {
      runId: 'run-never-settles',
      workspaceRef: { kind: 'global' },
      sessionId: null,
    })
    await bridge.abort('conversation-1', 'run-never-settles')
    query.releaseDone()
    await Promise.resolve()

    await expect(bridge.destroy({ waitForActiveRuns: false })).resolves.toBeUndefined()
    expect(runtimeStateStore.getRun('conversation-1', 'run-never-settles')).toMatchObject({
      status: 'cancelling',
      completedAt: null,
    })

    const restarted = new AgentRuntimeStateStore(filePath)
    await restarted.load()
    expect(restarted.getRun('conversation-1', 'run-never-settles')).toMatchObject({
      status: 'failed',
      errorCode: 'runtime_owner_lost',
      completedAt: expect.any(Number),
    })
  })
})
