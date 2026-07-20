import { describe, expect, it, vi } from 'vitest'
import type { TerminalRuntimeRef } from '../../shared/terminal'
import { PtyExecutionAdapter, type PtySpawnInput } from './terminal-pty-execution-adapter'

function createRuntime(): TerminalRuntimeRef {
  return {
    location: 'local',
    transport: 'local',
    backend: 'local-shell',
    workspaceRef: { kind: 'local', path: '/tmp' },
    cwd: '/tmp',
  }
}

function createMockPty(pid = 1234) {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  return {
    pid,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (listener: (data: string) => void) => {
      dataListeners.add(listener)
      return { dispose: () => dataListeners.delete(listener) }
    },
    onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
      exitListeners.add(listener)
      return { dispose: () => exitListeners.delete(listener) }
    },
    emitData: (data: string) => {
      for (const listener of dataListeners) listener(data)
    },
    emitExit: (event: { exitCode: number; signal?: number }) => {
      for (const listener of exitListeners) listener(event)
    },
  }
}

describe('PtyExecutionAdapter', () => {
  it('starts a local PTY with normalized size and emits output', async () => {
    const mockPty = createMockPty()
    const spawnPty = vi.fn((_input: PtySpawnInput) => mockPty)
    const adapter = new PtyExecutionAdapter({
      now: () => 100,
      spawnPty,
      browserEnvironment: {
        BROWSER: '/tmp/cclink-browser',
        npm_config_browser: "'/tmp/cclink-browser'",
        PATH: '/tmp/cclink-bin:/usr/bin',
      },
    })
    const events: unknown[] = []
    adapter.onEvent((event) => events.push(event))

    const result = await adapter.start({
      sessionId: 'terminal-1',
      runtime: createRuntime(),
      size: { columns: 120.8, rows: 31.2 },
    })

    expect(result).toEqual({ sessionId: 'terminal-1', status: 'running', processId: 1234 })
    expect(spawnPty).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: 120,
        rows: 31,
        shell: expect.any(String),
        cwd: '/tmp',
        env: expect.objectContaining({
          CCLINK_STUDIO_TERMINAL_SESSION_ID: 'terminal-1',
          CCLINK_STUDIO_TERMINAL_RUNTIME: 'local',
          BROWSER: '/tmp/cclink-browser',
          npm_config_browser: "'/tmp/cclink-browser'",
          PATH: '/tmp/cclink-bin:/usr/bin',
        }),
      }),
    )
    if (process.platform !== 'win32') {
      expect(spawnPty.mock.calls[0]?.[0].args?.join(' ')).toContain(
        'CCLINK_STUDIO_TERMINAL_SESSION_ID',
      )
      expect(spawnPty.mock.calls[0]?.[0].args?.join(' ')).toContain('terminal-1')
    }
    expect(events).toContainEqual({
      kind: 'started',
      sessionId: 'terminal-1',
      processId: 1234,
      timestamp: 100,
    })

    mockPty.emitData('hello')
    expect(events).toContainEqual({
      kind: 'output',
      sessionId: 'terminal-1',
      data: 'hello',
      stream: 'stdout',
      timestamp: 100,
    })
  })

  it('writes, resizes, and terminates an existing PTY session', async () => {
    const mockPty = createMockPty()
    const adapter = new PtyExecutionAdapter({
      spawnPty: () => mockPty,
      wait: async () => undefined,
      terminateGraceMs: 0,
      terminateForceGraceMs: 0,
    })

    await adapter.start({ sessionId: 'terminal-1', runtime: createRuntime() })
    await adapter.write({ sessionId: 'terminal-1', data: 'pwd\r', actor: 'user' })
    await adapter.resize('terminal-1', { columns: 99, rows: 22 })
    await adapter.terminate('terminal-1')

    expect(mockPty.write).toHaveBeenCalledWith('pwd\r')
    expect(mockPty.resize).toHaveBeenCalledWith(99, 22)
    expect(mockPty.kill).toHaveBeenCalledWith(process.platform === 'win32' ? undefined : 'SIGHUP')
    expect(mockPty.kill).toHaveBeenCalledWith(process.platform === 'win32' ? undefined : 'SIGKILL')
  })
})
