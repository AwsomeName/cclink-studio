import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceStateFlushAcknowledgement } from '../../shared/ipc/workspace-state'

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
  it('waits for a successful renderer acknowledgement before closing the window', async () => {
    const window = createWindow()
    new RendererWorkspaceStateFlushCoordinator(window.value as never, {} as never, 100)

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
      100,
    )

    const pending = coordinator.requestFlush()
    ipcRegistration.listener?.({}, { requestId: window.lastRequestId(), success: false })

    await expect(pending).resolves.toBe('failed')
  })

  it('times out instead of blocking application shutdown forever', async () => {
    const window = createWindow()
    const coordinator = new RendererWorkspaceStateFlushCoordinator(
      window.value as never,
      {} as never,
      5,
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
      webContents: {
        isDestroyed: () => false,
        send,
      },
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
