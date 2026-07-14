import { describe, expect, it, vi } from 'vitest'
import { REMOTE_ERROR_CODE } from '../../shared/remote-error'
import type { ChatccServer } from '../../shared/chatcc'
import type { ChatccProtocolMessage, ChatccTerminalOutputMessage } from '../../shared/chatcc/protocol'
import type { TerminalRuntimeRef } from '../../shared/terminal'
import { CclinkTerminalExecutionAdapter } from './terminal-cclink-execution-adapter'
import { TerminalLocalShellError } from './terminal-local-shell-adapter'

const server: ChatccServer = {
  id: 'agent-1',
  name: 'Mac mini',
  hostname: 'mac-mini',
  os: 'darwin',
  status: 'online',
  agentVersion: '1.0.0',
  claudeVersion: 'unknown',
  lastSeen: 1000,
  workspaces: [
    {
      id: 'workspace-1',
      path: '/srv/app',
      name: 'app',
      serverId: 'agent-1',
      sessionCount: 0,
    },
  ],
}

const runtime: TerminalRuntimeRef = {
  location: 'remote',
  transport: 'cclink',
  backend: 'remote-shell',
  endpointId: 'agent-1',
  workspaceRef: {
    kind: 'remote',
    transport: 'cclink',
    endpointId: 'agent-1',
    workspaceId: 'workspace-1',
    path: '/srv/app',
    label: 'app',
  },
  cwd: '/srv/app',
}

describe('CclinkTerminalExecutionAdapter', () => {
  it('sends terminal_command and emits terminal_output', async () => {
    const request = vi.fn(async (_serverId: string, message: ChatccProtocolMessage): Promise<ChatccTerminalOutputMessage> => ({
      cc_type: 'terminal_output',
      v: 1,
      min_v: 1,
      request_id: message.request_id,
      session_id: 'terminal-1',
      content: 'ok\n',
      exit_code: 0,
    }))
    const listener = vi.fn()
    const adapter = new CclinkTerminalExecutionAdapter(
      { listServers: vi.fn(async () => [server]) },
      { request },
      () => 1000,
    )
    adapter.onEvent(listener)

    await adapter.start({ sessionId: 'terminal-1', runtime })
    await adapter.write({ sessionId: 'terminal-1', data: 'pwd\n', actor: 'user' })

    expect(request).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        cc_type: 'terminal_command',
        session_id: 'terminal-1',
        content: 'pwd\n',
        cwd: '/srv/app',
      }),
      {
        expectedTypes: ['terminal_output'],
        timeoutMs: 60_000,
      },
    )
    expect(listener).toHaveBeenCalledWith({
      kind: 'output',
      sessionId: 'terminal-1',
      data: 'ok\n',
      stream: 'stdout',
      timestamp: 1000,
    })
    expect(listener).not.toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'exit',
        sessionId: 'terminal-1',
      }),
    )
  })

  it('rejects offline remote server with a structured execution error', async () => {
    const offlineServer = { ...server, status: 'offline' as const }
    const adapter = new CclinkTerminalExecutionAdapter(
      { listServers: vi.fn(async () => [offlineServer]) },
      { request: vi.fn() },
      () => 2000,
    )

    await expect(adapter.start({ sessionId: 'terminal-2', runtime })).rejects.toThrow(
      TerminalLocalShellError,
    )
    await expect(adapter.start({ sessionId: 'terminal-2', runtime })).rejects.toMatchObject({
      remoteError: {
        layer: 'execution-backend',
        code: REMOTE_ERROR_CODE.EXECUTION_BACKEND_UNAVAILABLE,
        message: '远程设备当前离线，无法执行命令',
        retryable: true,
      },
    })
  })
})
