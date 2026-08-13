import { describe, expect, it, vi } from 'vitest'
import type { TerminalExecutionAdapter } from './terminal-execution-adapter'
import { CompositeTerminalExecutionAdapter } from './terminal-composite-execution-adapter'

function adapter(backend: 'local-shell' | 'remote-shell'): TerminalExecutionAdapter {
  return {
    backend,
    start: vi.fn(async (input) => ({ sessionId: input.sessionId, status: 'running' as const })),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    terminate: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => undefined),
  }
}

describe('CompositeTerminalExecutionAdapter', () => {
  it('按 runtime location 把远程工作区交给 CCLink adapter', async () => {
    const local = adapter('local-shell')
    const remote = adapter('remote-shell')
    const composite = new CompositeTerminalExecutionAdapter({ local, remote })
    await composite.start({
      sessionId: 'terminal-remote',
      runtime: {
        location: 'remote',
        transport: 'cclink',
        backend: 'remote-shell',
        endpointId: 'agent-1',
        workspaceRef: {
          kind: 'remote',
          transport: 'cclink',
          endpointId: 'agent-1',
          workspaceId: 'workspace-1',
          path: '/srv/project',
        },
      },
    })
    expect(remote.start).toHaveBeenCalledOnce()
    expect(local.start).not.toHaveBeenCalled()
    await composite.write({ sessionId: 'terminal-remote', data: 'pwd\r', actor: 'user' })
    expect(remote.write).toHaveBeenCalledOnce()
  })
})
