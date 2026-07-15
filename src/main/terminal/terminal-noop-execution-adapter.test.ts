import { describe, expect, it, vi } from 'vitest'
import type { TerminalRuntimeRef } from '../../shared/terminal'
import {
  NoopTerminalExecutionAdapter,
  TerminalExecutionAdapterUnavailableError,
} from './terminal-noop-execution-adapter'

const localRuntime: TerminalRuntimeRef = {
  location: 'local',
  transport: 'local',
  backend: 'local-shell',
  workspaceRef: {
    kind: 'local',
    path: '/Users/apple/Desktop/DeepInk',
  },
  cwd: '/Users/apple/Desktop/DeepInk',
}

describe('NoopTerminalExecutionAdapter', () => {
  it('emits a structured error and rejects when starting a session', async () => {
    const adapter = new NoopTerminalExecutionAdapter({
      backend: 'local-shell',
      now: () => 123,
    })
    const listener = vi.fn()
    adapter.onEvent(listener)

    await expect(adapter.start({ sessionId: 'terminal-1', runtime: localRuntime })).rejects.toThrow(
      TerminalExecutionAdapterUnavailableError,
    )

    expect(listener).toHaveBeenCalledWith({
      kind: 'error',
      sessionId: 'terminal-1',
      message: 'Terminal 执行适配器尚未接入真实 shell',
      executionError: {
        layer: 'execution-backend',
        code: 'EXECUTION_BACKEND_UNAVAILABLE',
        message: 'Terminal 执行适配器尚未接入真实 shell',
        retryable: false,
        context: {
          backend: 'local-shell',
          operation: 'terminal.start',
          sessionId: 'terminal-1',
        },
      },
      timestamp: 123,
    })
  })

  it('preserves the execution error on rejected operations', async () => {
    const adapter = new NoopTerminalExecutionAdapter({ backend: 'remote-shell' })

    await expect(adapter.write({ sessionId: 'terminal-2', data: 'pwd', actor: 'user' })).rejects.toMatchObject({
      executionError: {
        layer: 'execution-backend',
        code: 'EXECUTION_BACKEND_UNAVAILABLE',
        retryable: false,
        context: {
          backend: 'remote-shell',
          operation: 'terminal.write',
          sessionId: 'terminal-2',
        },
      },
    })
  })

  it('uses operation-specific errors for resize and terminate', async () => {
    const adapter = new NoopTerminalExecutionAdapter()

    await expect(adapter.resize('terminal-3', { columns: 120, rows: 32 })).rejects.toMatchObject({
      executionError: {
        context: {
          backend: 'custom',
          operation: 'terminal.resize',
          sessionId: 'terminal-3',
        },
      },
    })
    await expect(adapter.terminate('terminal-3')).rejects.toMatchObject({
      executionError: {
        context: {
          backend: 'custom',
          operation: 'terminal.terminate',
          sessionId: 'terminal-3',
        },
      },
    })
  })

  it('supports unsubscribing execution event listeners', async () => {
    const adapter = new NoopTerminalExecutionAdapter({ now: () => 456 })
    const listener = vi.fn()
    const unsubscribe = adapter.onEvent(listener)

    unsubscribe()

    await expect(adapter.start({ sessionId: 'terminal-4', runtime: localRuntime })).rejects.toThrow(
      TerminalExecutionAdapterUnavailableError,
    )
    expect(listener).not.toHaveBeenCalled()
  })
})
