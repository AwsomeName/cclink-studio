import { randomUUID } from 'node:crypto'
import type { BrowserWindow, Event } from 'electron'
import {
  parseWorkspaceStateFlushAcknowledgement,
  workspaceStateIpcEvents,
  type WorkspaceStateFlushAcknowledgement,
} from '../../shared/ipc/workspace-state'
import {
  registerTrustedIpcListener,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

const RENDERER_FLUSH_TIMEOUT_MS = 5_000

export type RendererWorkspaceFlushOutcome = 'flushed' | 'failed' | 'timeout' | 'unavailable'

/** 协调 renderer 队列与主进程退出生命周期，避免窗口销毁时丢掉最新快照。 */
export class RendererWorkspaceStateFlushCoordinator {
  private readonly pending = new Map<string, (outcome: RendererWorkspaceFlushOutcome) => void>()
  private closeAllowed = false
  private closeFlushPromise: Promise<RendererWorkspaceFlushOutcome> | null = null

  constructor(
    private readonly mainWindow: BrowserWindow,
    trustedRendererGuard: TrustedRendererGuard,
    private readonly timeoutMs = RENDERER_FLUSH_TIMEOUT_MS,
  ) {
    registerTrustedIpcListener(
      workspaceStateIpcEvents.flushAcknowledged,
      trustedRendererGuard,
      (_event, value: WorkspaceStateFlushAcknowledgement) => {
        const acknowledgement = parseWorkspaceStateFlushAcknowledgement(value)
        if (!acknowledgement) return
        this.pending.get(acknowledgement.requestId)?.(
          acknowledgement.success ? 'flushed' : 'failed',
        )
      },
    )
    this.mainWindow.on('close', this.handleWindowClose)
  }

  requestFlush(): Promise<RendererWorkspaceFlushOutcome> {
    if (this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed()) {
      return Promise.resolve('unavailable')
    }

    const requestId = randomUUID()
    return new Promise<RendererWorkspaceFlushOutcome>((resolve) => {
      let settled = false
      const finish = (outcome: RendererWorkspaceFlushOutcome): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.pending.delete(requestId)
        resolve(outcome)
      }
      const timeout = setTimeout(() => finish('timeout'), this.timeoutMs)
      this.pending.set(requestId, finish)
      this.mainWindow.webContents.send(workspaceStateIpcEvents.flushRequest, requestId)
    })
  }

  dispose(): void {
    this.mainWindow.removeListener('close', this.handleWindowClose)
    for (const finish of this.pending.values()) finish('unavailable')
    this.pending.clear()
  }

  private readonly handleWindowClose = (event: Event): void => {
    if (this.closeAllowed) return
    event.preventDefault()
    if (this.closeFlushPromise) return

    this.closeFlushPromise = this.requestFlush()
    void this.closeFlushPromise.finally(() => {
      this.closeAllowed = true
      if (!this.mainWindow.isDestroyed()) this.mainWindow.close()
    })
  }
}
