import { describe, expect, it, vi } from 'vitest'
import { createCclinkEnvelope, type CclinkProtocolMessage } from '../../shared/cclink'
import { CclinkTerminalExecutionAdapter } from './terminal-cclink-execution-adapter'

describe('CclinkTerminalExecutionAdapter', () => {
  it('校验工作区绑定并把远程输出定向到本地 Terminal session', async () => {
    const protocolListeners: Array<
      (event: { serverId: string; message: CclinkProtocolMessage }) => void
    > = []
    const client = {
      onProtocolEvent: vi.fn((listener) => {
        protocolListeners.push(listener)
        return () => undefined
      }),
      request: vi.fn(async (_serverId, message) => ({
        ...createCclinkEnvelope('terminal_pty_open_response', { trace_id: message.trace_id }),
        status: 'ok',
        terminal_id: (message as { terminal_id: string }).terminal_id,
        agent_id: 'agent-1',
        workspace_id: 'workspace-1',
        workspace_path: '/srv/project',
        pty_protocol_version: 1,
        terminal_seq: 0,
      })),
      send: vi.fn(async () => undefined),
    }
    const service = {
      getRealtimeStatus: vi.fn(() => ({ state: 'online' })),
      onStatus: vi.fn(() => () => undefined),
      getStatus: vi.fn(async () => ({
        state: 'online',
        capabilities: { shell: { pty: true } },
      })),
    }
    const adapter = new CclinkTerminalExecutionAdapter(service as never, client as never)
    const events: unknown[] = []
    adapter.onEvent((event) => events.push(event))
    const ref = {
      kind: 'remote' as const,
      transport: 'cclink' as const,
      endpointId: 'agent-1',
      workspaceId: 'workspace-1',
      path: '/srv/project',
    }
    const result = await adapter.start({
      sessionId: 'local-session',
      runtime: {
        location: 'remote',
        transport: 'cclink',
        backend: 'remote-shell',
        endpointId: 'agent-1',
        workspaceRef: ref,
        cwd: ref.path,
      },
    })
    const repeated = await adapter.start({
      sessionId: 'local-session',
      runtime: {
        location: 'remote',
        transport: 'cclink',
        backend: 'remote-shell',
        endpointId: 'agent-1',
        workspaceRef: ref,
        cwd: ref.path,
      },
    })
    const open = client.request.mock.calls[0]![1] as unknown as {
      terminal_id: string
      trace_id: string
    }
    protocolListeners[0]!({
      serverId: 'agent-1',
      message: {
        ...createCclinkEnvelope('terminal_pty_output', { trace_id: open.trace_id }),
        terminal_id: open.terminal_id,
        workspace_id: 'workspace-1',
        workspace_path: '/srv/project',
        terminal_seq: 1,
        data: '/srv/project\r\n',
      },
    })
    expect(result.processId).toContain('cclink:agent-1:')
    expect(repeated.processId).toBe(result.processId)
    expect(client.request).toHaveBeenCalledTimes(1)
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'output',
        sessionId: 'local-session',
        data: '/srv/project\r\n',
      }),
    )
  })

  it('实时连接恢复后 attach 原 PTY 并从断点继续', async () => {
    const statusListeners: Array<(status: { state: string }) => void> = []
    const client = {
      onProtocolEvent: vi.fn(() => () => undefined),
      request: vi.fn(async (_serverId, message: CclinkProtocolMessage) => {
        const request = message as CclinkProtocolMessage & {
          terminal_id: string
          workspace_id?: string
          workspace_path?: string
        }
        if (request.cc_type === 'terminal_pty_open') {
          return {
            ...createCclinkEnvelope('terminal_pty_open_response', {
              trace_id: request.trace_id,
            }),
            status: 'ok',
            terminal_id: request.terminal_id,
            agent_id: 'agent-1',
            workspace_id: request.workspace_id,
            workspace_path: request.workspace_path,
            pty_protocol_version: 1,
            terminal_seq: 7,
          }
        }
        return {
          ...createCclinkEnvelope('terminal_pty_attach_response', {
            trace_id: request.trace_id,
          }),
          status: 'ok',
          terminal_id: request.terminal_id,
          workspace_id: 'workspace-1',
          workspace_path: '/srv/project',
          terminal_seq: 7,
        }
      }),
      send: vi.fn(async () => undefined),
    }
    const service = {
      getRealtimeStatus: vi.fn(() => ({ state: 'online' })),
      onStatus: vi.fn((listener) => {
        statusListeners.push(listener)
        return () => undefined
      }),
      getStatus: vi.fn(async () => ({
        state: 'online',
        capabilities: { shell: { pty: true } },
      })),
    }
    const adapter = new CclinkTerminalExecutionAdapter(service as never, client as never)
    const ref = {
      kind: 'remote' as const,
      transport: 'cclink' as const,
      endpointId: 'agent-1',
      workspaceId: 'workspace-1',
      path: '/srv/project',
    }
    await adapter.start({
      sessionId: 'local-session',
      runtime: {
        location: 'remote',
        transport: 'cclink',
        backend: 'remote-shell',
        endpointId: 'agent-1',
        workspaceRef: ref,
        cwd: ref.path,
      },
    })

    statusListeners[0]!({ state: 'offline' })
    statusListeners[0]!({ state: 'online' })
    await vi.waitFor(() => expect(client.request).toHaveBeenCalledTimes(2))

    expect(client.request.mock.calls[1]![1]).toEqual(
      expect.objectContaining({
        cc_type: 'terminal_pty_attach',
        last_terminal_seq: 7,
      }),
    )
  })
})
