import { describe, expect, it } from 'vitest'
import { createCclinkEnvelope } from './cclink'
import type { RemoteStatus } from './remote-protocol'
import { remoteTerminalUnavailableError } from './remote-terminal-availability'

const status: RemoteStatus = {
  ref: {
    kind: 'remote',
    transport: 'cclink',
    endpointId: 'agent-1',
    workspaceId: 'workspace-1',
    path: '/srv/project',
  },
  state: 'online',
  compatibility: 'compatible',
  workspacePath: '/srv/project',
  capabilities: {
    file: { tree: true, read: true, write: false, create: false, rename: false, delete: false },
    shell: { pty: false },
    agent: { session: true, stream: true },
  },
}

function withReason(reason: string): RemoteStatus {
  return {
    ...status,
    capabilityProbe: {
      state: 'ready',
      stale: false,
      response: {
        ...createCclinkEnvelope('capability_probe_response'),
        terminal_workspace_pty_status: 'unavailable',
        terminal_workspace_pty_reason: reason,
      },
    },
  }
}

describe('remoteTerminalUnavailableError', () => {
  it.each([
    ['node_pty_external_not_installed', '未安装独立的 node-pty 依赖'],
    ['node_pty_external_abi_mismatch', '与当前 Node.js 版本不兼容'],
    ['node_pty_external_version_unsupported', 'node-pty 版本不受支持'],
    ['node_pty_spawn_failed:ENOENT', 'PTY 启动检查未通过'],
  ])('explains %s and directs repair to the remote host', (reason, message) => {
    const error = remoteTerminalUnavailableError(withReason(reason))
    expect(error).toMatchObject({
      code: 'TERMINAL_PTY_UNAVAILABLE',
      context: { endpointId: 'agent-1', capability: 'shell.pty', reason },
    })
    expect(error?.message).toContain(message)
    expect(error?.message).toContain('chatcc doctor pty')
    expect(error?.message).toContain('chatcc restart')
  })

  it('treats an unfinished PTY probe as retryable without asking for dependency repair', () => {
    const error = remoteTerminalUnavailableError(withReason('node_pty_probe_pending'))
    expect(error).toMatchObject({ retryable: true })
    expect(error?.message).toContain('稍后重试')
    expect(error?.message).not.toContain('chatcc doctor pty')
  })

  it('preserves a probe timeout instead of claiming a missing capability', () => {
    const remoteError = {
      layer: 'transport' as const,
      code: 'REMOTE_REQUEST_TIMEOUT',
      message: '等待能力探测响应超时',
      retryable: true,
      context: { operation: 'capability.probe' },
    }
    expect(remoteTerminalUnavailableError({ ...status, remoteError })).toBe(remoteError)
  })

  it('keeps legacy capability failures actionable without inventing a dependency diagnosis', () => {
    const error = remoteTerminalUnavailableError(status)
    expect(error?.message).toContain('未声明持久 Terminal 能力')
    expect(error?.message).toContain('chatcc doctor pty')
    expect(error?.context).not.toHaveProperty('reason')
  })

  it.each(['\u001b[2Jtoken=secret', 'token:secret', 'token:secret with spaces', 'x'.repeat(161)])(
    'does not write arbitrary Agent diagnostic text into the terminal',
    (reason) => {
      const error = remoteTerminalUnavailableError(withReason(reason))
      expect(error?.message).not.toContain(reason)
      expect(error?.context).not.toHaveProperty('reason')
    },
  )

  it('does not confuse another unavailable Agent capability with PTY availability', () => {
    expect(
      remoteTerminalUnavailableError({
        ...status,
        capabilities: { ...status.capabilities, shell: { pty: true } },
        remoteError: {
          layer: 'remote-agent',
          code: 'REMOTE_CAPABILITY_UNAVAILABLE',
          message: '未声明远程会话能力',
          retryable: false,
        },
      }),
    ).toBeUndefined()
  })
})
