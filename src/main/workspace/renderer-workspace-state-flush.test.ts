import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateFlushAcknowledgement } from '../../shared/ipc/workspace-state'
import { dialog } from 'electron'

vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
}))

const ipcRegistration = vi.hoisted(() => ({
  listener: null as null | ((event: unknown, value: WorkspaceStateFlushAcknowledgement) => void),
}))

vi.mock('../ipc/trusted-renderer-guard', () => ({
  registerTrustedIpcListener: vi.fn(
    (
      _channel: string,
      _guard: unknown,
      listener: (event: unknown, value: WorkspaceStateFlushAcknowledgement) => void,
    ) => {
      ipcRegistration.listener = listener
    },
  ),
}))

import { RendererWorkspaceStateFlushCoordinator } from './renderer-workspace-state-flush'

describe('RendererWorkspaceStateFlushCoordinator', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['timeout', 'failed'])(
    'keeps the debug workbench open without a dialog on %s and allows a retry',
    async (outcome) => {
      const window = createWindow()
      new RendererWorkspaceStateFlushCoordinator(window.value as never, {} as never, {
        isDev: true,
        timeoutMs: 10,
      })
      const warning = vi.spyOn(console, 'warn')
      try {
        // A successful reload must not inherit the previous document's preload failure.
        window.value.webContents.emit('preload-error')
        window.value.webContents.emit('did-start-navigation', {
          isMainFrame: true,
          isSameDocument: false,
        })
        window.emitClose({ preventDefault: vi.fn() })
        if (outcome === 'failed') {
          ipcRegistration.listener?.({}, { requestId: window.lastRequestId(), success: false })
        }
        await vi.waitFor(() => expect(warning).toHaveBeenCalledWith(expect.any(String), outcome))
        expect(dialog.showMessageBox).not.toHaveBeenCalled()
        expect(window.close).not.toHaveBeenCalled()
        window.emitClose({ preventDefault: vi.fn() })
        ipcRegistration.listener?.({}, { requestId: window.lastRequestId(), success: true })
        await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce())
      } finally {
        warning.mockRestore()
      }
    },
  )

  it('closes a debug window with a failed preload after attempting to save, without a dialog', async () => {
    const window = createWindow()
    new RendererWorkspaceStateFlushCoordinator(window.value as never, {} as never, {
      isDev: true,
      timeoutMs: 5,
    })
    window.value.webContents.emit('preload-error')
    window.emitClose({ preventDefault: vi.fn() })
    expect(window.lastRequestId()).toBeTruthy()
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce())
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('keeps the window open after a failed write and permits a later successful retry', async () => {
    const window = createWindow()
    new RendererWorkspaceStateFlushCoordinator(window.value as never, {} as never, {
      timeoutMs: 100,
    })
    window.emitClose({ preventDefault: vi.fn() })
    ipcRegistration.listener?.({}, { requestId: window.lastRequestId(), success: false })
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalled())
    expect(window.close).not.toHaveBeenCalled()
    await Promise.resolve()
    window.emitClose({ preventDefault: vi.fn() })
    ipcRegistration.listener?.({}, { requestId: window.lastRequestId(), success: true })
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce())
  })

  it('requires an explicit discard decision to close after a timeout', async () => {
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 2, checkboxChecked: false })
    const window = createWindow()
    new RendererWorkspaceStateFlushCoordinator(window.value as never, {} as never, { timeoutMs: 5 })
    window.emitClose({ preventDefault: vi.fn() })
    expect(window.close).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce())
  })
  it('uses an inspection request and returns actual installation blockers without a persistence flush', async () => {
    const window = createWindow()
    const coordinator = new RendererWorkspaceStateFlushCoordinator(
      window.value as never,
      {} as never,
      { timeoutMs: 100 },
    )
    const pending = coordinator.requestInstallReadiness()
    const requestId = window.lastRequestId()
    expect(requestId).toMatch(/^update-inspect:/)
    const updateInstallImpacts = [
      { kind: 'editor' as const, severity: 'blocked' as const, label: 'draft', detail: '未保存' },
    ]
    ipcRegistration.listener?.({}, { requestId, success: true, updateInstallImpacts })
    await expect(pending).resolves.toMatchObject({ success: true, updateInstallImpacts })
    expect(window.close).not.toHaveBeenCalled()
  })
  it('waits for a successful renderer acknowledgement before closing the window', async () => {
    const window = createWindow()
    new RendererWorkspaceStateFlushCoordinator(window.value as never, {} as never, {
      timeoutMs: 100,
    })

    const event = { preventDefault: vi.fn() }
    window.emitClose(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(window.close).not.toHaveBeenCalled()
    const requestId = window.lastRequestId()
    ipcRegistration.listener?.({}, { requestId, success: true })
    await vi.waitFor(() => expect(window.close).toHaveBeenCalledOnce())
  })

  it('reports a renderer persistence failure instead of treating it as flushed', async () => {
    const window = createWindow()
    const coordinator = new RendererWorkspaceStateFlushCoordinator(
      window.value as never,
      {} as never,
      { timeoutMs: 100 },
    )

    const pending = coordinator.requestFlush()
    ipcRegistration.listener?.({}, { requestId: window.lastRequestId(), success: false })

    await expect(pending).resolves.toBe('failed')
  })

  it('preserves the bounded oversized-conversation failure classification', async () => {
    const window = createWindow()
    const coordinator = new RendererWorkspaceStateFlushCoordinator(
      window.value as never,
      {} as never,
      { timeoutMs: 100 },
    )

    const pending = coordinator.requestFlush()
    ipcRegistration.listener?.(
      {},
      {
        requestId: window.lastRequestId(),
        success: false,
        failureCode: 'agent_conversations_too_large',
      },
    )

    await expect(pending).resolves.toBe('agent_conversations_too_large')
  })

  it('times out instead of blocking application shutdown forever', async () => {
    const window = createWindow()
    const coordinator = new RendererWorkspaceStateFlushCoordinator(
      window.value as never,
      {} as never,
      { timeoutMs: 5 },
    )

    await expect(coordinator.requestFlush()).resolves.toBe('timeout')
  })
})

function createWindow() {
  const closeListeners = new Set<(event: { preventDefault: () => void }) => void>()
  const send = vi.fn()
  const close = vi.fn()
  return {
    value: {
      isDestroyed: () => false,
      webContents: Object.assign(new EventEmitter(), { isDestroyed: () => false, send }),
      on: (event: string, listener: (event: { preventDefault: () => void }) => void) => {
        if (event === 'close') closeListeners.add(listener)
      },
      removeListener: (
        event: string,
        listener: (event: { preventDefault: () => void }) => void,
      ) => {
        if (event === 'close') closeListeners.delete(listener)
      },
      close,
    },
    close,
    emitClose: (event: { preventDefault: () => void }) => {
      for (const listener of closeListeners) listener(event)
    },
    lastRequestId: (): string => {
      const requestId = send.mock.lastCall?.[1]
      if (typeof requestId !== 'string') throw new Error('flush request was not sent')
      return requestId
    },
  }
}
