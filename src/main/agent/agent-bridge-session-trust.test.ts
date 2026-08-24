import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentBridge } from './agent-bridge'
import { AgentRuntimeStateStore } from './agent-runtime-state-store'

const queryMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}))

function createMockQuery(
  sessionId: string,
  result: Record<string, unknown> = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
  },
): AsyncIterable<unknown> & {
  close: ReturnType<typeof vi.fn>
  getContextUsage: ReturnType<typeof vi.fn>
} {
  return {
    close: vi.fn(),
    getContextUsage: vi.fn(async () => null),
    async *[Symbol.asyncIterator]() {
      yield { type: 'system', subtype: 'init', session_id: sessionId }
      yield result
    },
  }
}

function createBridge(runtimeStateStore?: AgentRuntimeStateStore): AgentBridge {
  return new AgentBridge(
    {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    } as never,
    null,
    {
      getPort: () => 39876,
      getAllTools: () => [],
      createToolSession: vi.fn(() => 'mcp-session'),
      releaseToolSession: vi.fn(),
      cancelToolSession: vi.fn(),
    } as never,
    { requestConfirmation: vi.fn() } as never,
    {
      composeMcpConfig: () => ({
        mcpServers: {
          cclink_studio: { type: 'http', url: 'http://127.0.0.1:39876/mcp' },
        },
      }),
    } as never,
    null,
    { sessionCompatibilityFingerprint: 'runtime-fingerprint', runtimeStateStore },
  )
}

describe('AgentBridge main-process Claude session trust', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  it('rejects a renderer-paired old session and resumes only a session observed by this runtime', async () => {
    queryMock
      .mockImplementationOnce(() => createMockQuery('current-session'))
      .mockImplementationOnce(() => createMockQuery('current-session'))
    const bridge = createBridge()
    const conversationId = 'conversation-1'
    const fingerprint = bridge.getStatus(conversationId).sessionCompatibilityFingerprint

    await expect(
      bridge.sendMessage('untrusted', conversationId, {
        workspaceRef: { kind: 'global' },
        sessionId: 'old-session',
        sessionCompatibilityFingerprint: fingerprint,
      }),
    ).rejects.toThrow('Runtime Session')

    const firstReceipt = await bridge.sendMessage('first', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionId: null,
      sessionCompatibilityFingerprint: fingerprint,
    })

    expect(firstReceipt.runtimeSessionMode).toBe('new')
    await vi.waitFor(() => expect(bridge.isBusy(conversationId)).toBe(false))
    expect(queryMock.mock.calls[0]?.[0].options.resume).toBeUndefined()
    expect(bridge.getStatus(conversationId).sessionId).toBe('current-session')

    const secondReceipt = await bridge.sendMessage('second', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionId: 'current-session',
      sessionCompatibilityFingerprint: fingerprint,
    })

    expect(secondReceipt.runtimeSessionMode).toBe('resumed')
    await vi.waitFor(() => expect(bridge.isBusy(conversationId)).toBe(false))
    expect(queryMock.mock.calls[1]?.[0].options.resume).toBe('current-session')
    await bridge.destroy()
  })

  it('rejects a previously trusted session when a backend switch drops sessions', async () => {
    queryMock
      .mockImplementationOnce(() => createMockQuery('current-session'))
      .mockImplementationOnce(() => createMockQuery('replacement-session'))
    const bridge = createBridge()
    const conversationId = 'conversation-1'
    const fingerprint = bridge.getStatus(conversationId).sessionCompatibilityFingerprint

    await bridge.sendMessage('first', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionCompatibilityFingerprint: fingerprint,
    })
    await vi.waitFor(() => expect(bridge.isBusy(conversationId)).toBe(false))

    bridge.switchBackend(
      {
        type: 'local-claude-code',
        claudeCode: {
          hostContext: {
            hostName: 'CCLink Studio',
            mcpServerName: 'cclink_studio',
            androidControllerName: 'CCLink Studio',
          },
        },
      },
      false,
    )
    await expect(
      bridge.sendMessage('stale', conversationId, {
        workspaceRef: { kind: 'global' },
        sessionId: 'current-session',
        sessionCompatibilityFingerprint: fingerprint,
      }),
    ).rejects.toThrow('Runtime Session')
    const receipt = await bridge.sendMessage('second', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionId: null,
      sessionCompatibilityFingerprint: fingerprint,
    })

    expect(receipt.runtimeSessionMode).toBe('new')
    await vi.waitFor(() => expect(bridge.isBusy(conversationId)).toBe(false))
    expect(queryMock.mock.calls[1]?.[0].options.resume).toBeUndefined()
    await bridge.destroy()
  })

  it('revokes process trust when the backend invalidates an observed session', async () => {
    queryMock
      .mockImplementationOnce(() => createMockQuery('current-session'))
      .mockImplementationOnce(() =>
        createMockQuery('current-session', {
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: 'API Error: 400 invalid_request_error',
        }),
      )
      .mockImplementationOnce(() => createMockQuery('replacement-session'))
    const bridge = createBridge()
    const conversationId = 'conversation-1'
    const fingerprint = bridge.getStatus(conversationId).sessionCompatibilityFingerprint

    await bridge.sendMessage('first', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionCompatibilityFingerprint: fingerprint,
    })
    await vi.waitFor(() => expect(bridge.isBusy(conversationId)).toBe(false))

    const invalidReceipt = await bridge.sendMessage('invalid', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionId: 'current-session',
      sessionCompatibilityFingerprint: fingerprint,
    })
    expect(invalidReceipt.runtimeSessionMode).toBe('resumed')
    await vi.waitFor(() => expect(bridge.isBusy(conversationId)).toBe(false))
    expect(bridge.getStatus(conversationId).sessionId).toBeNull()

    await expect(
      bridge.sendMessage('stale retry', conversationId, {
        workspaceRef: { kind: 'global' },
        sessionId: 'current-session',
        sessionCompatibilityFingerprint: fingerprint,
      }),
    ).rejects.toThrow('Runtime Session')
    const retryReceipt = await bridge.sendMessage('retry', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionId: null,
      sessionCompatibilityFingerprint: fingerprint,
    })
    expect(retryReceipt.runtimeSessionMode).toBe('new')
    await vi.waitFor(() => expect(bridge.isBusy(conversationId)).toBe(false))
    expect(queryMock.mock.calls[2]?.[0].options.resume).toBeUndefined()
    await bridge.destroy()
  })

  it('restores persisted trust only for the original workspace and runtime binding', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-agent-session-trust-'))
    const filePath = join(directory, 'state.json')
    try {
      queryMock
        .mockImplementationOnce(() => createMockQuery('persisted-session'))
        .mockImplementationOnce(() => createMockQuery('persisted-session'))
      const firstStore = new AgentRuntimeStateStore(filePath)
      await firstStore.load()
      const firstBridge = createBridge(firstStore)
      const fingerprint = firstBridge.getStatus('conversation-1').sessionCompatibilityFingerprint
      await firstBridge.sendMessage('first', 'conversation-1', {
        workspaceRef: { kind: 'global' },
        sessionId: null,
      })
      await vi.waitFor(() => expect(firstBridge.isBusy('conversation-1')).toBe(false))
      await firstBridge.destroy()

      const restartedStore = new AgentRuntimeStateStore(filePath)
      await restartedStore.load()
      const restartedBridge = createBridge(restartedStore)
      await expect(
        restartedBridge.sendMessage('wrong workspace', 'conversation-1', {
          runId: 'wrong-workspace-run',
          workspaceRef: { kind: 'local', path: '/different-workspace' },
          sessionId: 'persisted-session',
          sessionCompatibilityFingerprint: fingerprint,
        }),
      ).rejects.toThrow('Runtime Session')

      await expect(
        restartedBridge.sendMessage('resume', 'conversation-1', {
          runId: 'resume-run',
          workspaceRef: { kind: 'global' },
          sessionId: 'persisted-session',
          sessionCompatibilityFingerprint: fingerprint,
        }),
      ).resolves.toMatchObject({ runtimeSessionMode: 'resumed' })
      await vi.waitFor(() => expect(restartedBridge.isBusy('conversation-1')).toBe(false))
      expect(queryMock.mock.calls[1]?.[0].options.resume).toBe('persisted-session')
      await restartedBridge.destroy()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
