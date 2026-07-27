import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recordMainDiagnosticLog,
  resetMainDiagnosticLogForTest,
} from '../diagnostics/main-diagnostic-log'
import { registerDiagnosticsIpc } from './diagnostics-ipc'

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
})
