import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { REMOTE_ERROR_CODE } from '../../shared/remote-error'
import type { TerminalRuntimeRef } from '../../shared/terminal'
import {
  LocalShellExecutionAdapter,
  TerminalLocalShellError,
} from './terminal-local-shell-adapter'

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  pid = 1234
  kill = vi.fn(() => {
    this.emit('exit', null, 'SIGTERM')
    return true
  })
}

const localRuntime: TerminalRuntimeRef = {
  location: 'local',
  transport: 'local',
  backend: 'local-shell',
  workspaceRef: {
    kind: 'local',
    path: '/tmp',
  },
  cwd: '/tmp',
}

const remoteRuntime: TerminalRuntimeRef = {
  location: 'remote',
  transport: 'cclink',
  backend: 'remote-shell',
  workspaceRef: {
    kind: 'remote',
    transport: 'cclink',
    endpointId: 'agent-1',
    workspaceId: 'workspace-1',
    path: '/srv/app',
  },
  cwd: '/srv/app',
}

describe('LocalShellExecutionAdapter', () => {
  it('starts a local shell and emits output events', async () => {
    const child = new FakeChildProcess()
    const listener = vi.fn()
    const adapter = new LocalShellExecutionAdapter({
      now: () => 1000,
      spawnShell: vi.fn(() => child as any),
    })
    adapter.onEvent(listener)

    await expect(
      adapter.start({ sessionId: 'terminal-1', runtime: localRuntime }),
    ).resolves.toEqual({
      sessionId: 'terminal-1',
      status: 'running',
      processId: 1234,
    })

    child.stdout.write('hello\n')
    child.stderr.write('warn\n')

    expect(listener).toHaveBeenCalledWith({
      kind: 'started',
      sessionId: 'terminal-1',
      processId: 1234,
      timestamp: 1000,
    })
    expect(listener).toHaveBeenCalledWith({
      kind: 'output',
      sessionId: 'terminal-1',
      data: 'hello\n',
      stream: 'stdout',
      timestamp: 1000,
    })
    expect(listener).toHaveBeenCalledWith({
      kind: 'output',
      sessionId: 'terminal-1',
      data: 'warn\n',
      stream: 'stderr',
      timestamp: 1000,
    })
  })

  it('writes to and terminates an existing shell session', async () => {
    const child = new FakeChildProcess()
    const listener = vi.fn()
    const adapter = new LocalShellExecutionAdapter({
      now: () => 2000,
      spawnShell: vi.fn(() => child as any),
    })
    adapter.onEvent(listener)

    await adapter.start({ sessionId: 'terminal-2', runtime: localRuntime })
    await adapter.write({ sessionId: 'terminal-2', data: 'pwd\n', actor: 'user' })
    await adapter.terminate('terminal-2')

    expect(child.stdin.read()?.toString('utf-8')).toBe('pwd\n')
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(listener).toHaveBeenCalledWith({
      kind: 'exit',
      sessionId: 'terminal-2',
      exitCode: undefined,
      signal: 'SIGTERM',
      timestamp: 2000,
    })
  })

  it('rejects remote runtime with a structured unavailable error', async () => {
    const listener = vi.fn()
    const adapter = new LocalShellExecutionAdapter({ now: () => 3000 })
    adapter.onEvent(listener)

    await expect(
      adapter.start({ sessionId: 'terminal-3', runtime: remoteRuntime }),
    ).rejects.toThrow(TerminalLocalShellError)
    await expect(
      adapter.start({ sessionId: 'terminal-3', runtime: remoteRuntime }),
    ).rejects.toMatchObject({
      remoteError: {
        layer: 'execution-backend',
        code: REMOTE_ERROR_CODE.EXECUTION_BACKEND_UNAVAILABLE,
        message: '远程 Terminal 执行后端尚未接入',
        retryable: true,
      },
    })
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        sessionId: 'terminal-3',
        message: '远程 Terminal 执行后端尚未接入',
      }),
    )
  })
})
