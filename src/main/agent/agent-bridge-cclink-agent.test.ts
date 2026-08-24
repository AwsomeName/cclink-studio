import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentBridge } from './agent-bridge'
import { AgentRuntimeStateStore } from './agent-runtime-state-store'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})

describe('AgentBridge cclink-agent capability boundary', () => {
  it('rejects cancellation before writing cancelling when the service lacks exact cancel', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('event: thinking\ndata: {"type":"thinking","state":"started"}\n\n')
    })
    const baseUrl = await listen(server)
    const stop = vi.fn(async () => undefined)
    const runtimeStateStore = new AgentRuntimeStateStore()
    const bridge = new AgentBridge(
      { isDestroyed: () => false, webContents: { send: vi.fn() } } as never,
      null,
      {
        getPort: () => 39876,
        getAllTools: () => [],
        createToolSession: vi.fn(() => 'mcp-session'),
        releaseToolSession: vi.fn(),
        cancelToolSession: vi.fn(),
      } as never,
      { cancelForRun: vi.fn(), requestConfirmation: vi.fn() } as never,
      { composeMcpConfig: () => ({ mcpServers: {} }) } as never,
      null,
      {
        sessionCompatibilityFingerprint: 'c'.repeat(64),
        runtimeStateStore,
        experimentalCclinkAgent: {
          baseUrl,
          token: 'mock:test:runtime:run:/tmp',
          runtimeId: 'claude_code',
          service: { stop } as never,
        },
      },
    )

    await bridge.sendMessage('hello', 'conversation-1', {
      runId: 'run-1',
      workspaceRef: { kind: 'local', path: '/tmp' },
      sessionId: null,
    })

    await expect(bridge.abort('conversation-1', 'run-1')).resolves.toMatchObject({
      accepted: false,
      error: expect.stringContaining('缺少按 request_id 精确取消接口'),
      run: { status: 'running' },
    })
    expect(bridge.getRunStatus('conversation-1', 'run-1')).toMatchObject({
      status: 'running',
      completedAt: null,
    })

    await bridge.destroy()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})

async function listen(server: Server): Promise<string> {
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server has no TCP address')
  return `http://127.0.0.1:${address.port}`
}
