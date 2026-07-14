import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalTabRef } from '@shared/terminal'
import { submitTerminalCommand } from './terminal-command'

const terminal: TerminalTabRef = {
  runtime: {
    location: 'remote',
    transport: 'cclink',
    backend: 'remote-shell',
    workspaceRef: {
      kind: 'remote',
      transport: 'cclink',
      endpointId: 'agent-1',
      workspaceId: 'workspace-1',
      path: '/srv/app',
      label: 'app',
    },
    cwd: '/srv/app',
    endpointId: 'agent-1',
  },
  permissionPolicy: {
    mode: 'ask-every-command',
    requireConfirmationFor: ['read', 'write', 'network', 'destructive', 'privileged', 'unknown'],
  },
  status: 'idle',
  closePolicy: 'terminate-process',
  sessionId: 'terminal-session-1',
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.stubGlobal('window', {
    deepink: {
      terminal: {
        submitCommand: vi.fn().mockResolvedValue({
          success: true,
          status: 'accepted',
          risk: 'read',
          execution: 'not-started',
          message: 'accepted',
        }),
        recordLifecycleEvent: vi.fn().mockResolvedValue({ success: true }),
      },
    },
  })
})

describe('submitTerminalCommand', () => {
  it('submits trimmed command with workspace key', async () => {
    const result = await submitTerminalCommand(terminal, ' pwd ')

    expect(result.retriedAfterRegister).toBe(false)
    expect(result.result.success).toBe(true)
    expect(window.deepink.terminal.submitCommand).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-session-1',
      command: 'pwd',
      actor: 'user',
      permissionPolicy: terminal.permissionPolicy,
      workspaceKey: 'cclink://agent-1/workspace-1',
    })
  })

  it('rejects empty commands before IPC', async () => {
    const result = await submitTerminalCommand(terminal, '   ')

    expect(result.result).toMatchObject({
      success: false,
      status: 'rejected',
      error: 'Terminal 命令不能为空',
    })
    expect(window.deepink.terminal.submitCommand).not.toHaveBeenCalled()
  })

  it('re-registers and retries when restored session is missing', async () => {
    vi.mocked(window.deepink.terminal.submitCommand)
      .mockResolvedValueOnce({
        success: false,
        status: 'rejected',
        error: 'Terminal session 不存在：terminal-session-1',
      })
      .mockResolvedValueOnce({
        success: true,
        status: 'accepted',
        risk: 'read',
        execution: 'not-started',
        message: 'accepted after retry',
      })

    const result = await submitTerminalCommand(terminal, 'ls')

    expect(result.retriedAfterRegister).toBe(true)
    expect(result.result.success).toBe(true)
    expect(window.deepink.terminal.recordLifecycleEvent).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-session-1',
      workspaceKey: 'cclink://agent-1/workspace-1',
      kind: 'created',
      message: 'Terminal Tab 已重新登记',
      runtime: terminal.runtime,
    })
    expect(window.deepink.terminal.submitCommand).toHaveBeenCalledTimes(2)
  })
})
