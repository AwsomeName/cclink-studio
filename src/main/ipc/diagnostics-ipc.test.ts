import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recordMainDiagnosticLog,
  resetMainDiagnosticLogForTest,
} from '../diagnostics/main-diagnostic-log'
import { registerDiagnosticsIpc } from './diagnostics-ipc'
import { probeCodexRuntime } from '../agent/codex-runtime-diagnostics'

vi.mock('../agent/codex-runtime-diagnostics', () => ({ probeCodexRuntime: vi.fn() }))

const mockIpcMain = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    mockIpcMain.handlers.set(channel, handler)
  }),
}))

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
}))

describe('registerDiagnosticsIpc', () => {
  const trustedRendererGuard = {
    assert: vi.fn(),
    isTrusted: vi.fn(() => true),
  }

  beforeEach(() => {
    mockIpcMain.handlers.clear()
    mockIpcMain.handle.mockClear()
    trustedRendererGuard.assert.mockClear()
    resetMainDiagnosticLogForTest()
  })

  it('registers a trusted, read-only snapshot endpoint', () => {
    recordMainDiagnosticLog('warn', ['render retry'])
    registerDiagnosticsIpc(trustedRendererGuard)

    const snapshot = mockIpcMain.handlers.get('diagnostics:getMainLogSnapshot')?.({
      sender: 'trusted',
    })

    expect(trustedRendererGuard.assert).toHaveBeenCalledOnce()
    expect(snapshot).toMatchObject({
      droppedCount: 0,
      entries: [{ level: 'warn', source: 'main', message: 'render retry' }],
    })
  })

  it('guards the Codex probe, rejects arguments and shares an in-flight check', async () => {
    let finish!: (value: never) => void
    vi.mocked(probeCodexRuntime).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    registerDiagnosticsIpc(trustedRendererGuard)
    const handler = mockIpcMain.handlers.get('diagnostics:probeCodex')!
    expect(() => handler({}, 'unexpected')).toThrow()
    const first = handler({})
    const second = handler({})
    expect(probeCodexRuntime).toHaveBeenCalledOnce()
    finish({ state: 'not-found' } as never)
    expect(await first).toEqual(await second)
    expect(trustedRendererGuard.assert).toHaveBeenCalled()
  })
})
