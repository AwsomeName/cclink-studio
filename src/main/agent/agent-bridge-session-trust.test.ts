import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentBridge } from './agent-bridge'

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

function createBridge(): AgentBridge {
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
    { sessionCompatibilityFingerprint: 'runtime-fingerprint' },
  )
}

describe('AgentBridge main-process Claude session trust', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  it('rejects a renderer-paired old session but resumes a session observed in this process', async () => {
    queryMock
      .mockImplementationOnce(() => createMockQuery('current-session'))
      .mockImplementationOnce(() => createMockQuery('current-session'))
    const bridge = createBridge()
    const conversationId = 'conversation-1'
    const fingerprint = bridge.getStatus(conversationId).sessionCompatibilityFingerprint

    const firstReceipt = await bridge.sendMessage('first', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionId: 'old-session',
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

  it('clears process trust when a backend switch drops sessions', async () => {
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
    const receipt = await bridge.sendMessage('second', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionId: 'current-session',
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

    const retryReceipt = await bridge.sendMessage('retry', conversationId, {
      workspaceRef: { kind: 'global' },
      sessionId: 'current-session',
      sessionCompatibilityFingerprint: fingerprint,
    })
    expect(retryReceipt.runtimeSessionMode).toBe('new')
    await vi.waitFor(() => expect(bridge.isBusy(conversationId)).toBe(false))
    expect(queryMock.mock.calls[2]?.[0].options.resume).toBeUndefined()
    await bridge.destroy()
  })
})
