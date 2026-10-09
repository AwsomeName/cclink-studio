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

export type RendererWorkspaceFlushOutcome =
  | 'flushed'
  | 'agent_conversations_too_large'
  | 'failed'
  | 'timeout'
  | 'unavailable'

/** 协调 renderer 队列与主进程退出生命周期，避免窗口销毁时丢掉最新快照。 */
export class RendererWorkspaceStateFlushCoordinator {
  private readonly pending = new Map<string, (outcome: RendererWorkspaceFlushOutcome) => void>()
  private readonly installReadiness = new Map<
    string,
    (value: WorkspaceStateFlushAcknowledgement | null) => void
  >()
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
        this.installReadiness.get(acknowledgement.requestId)?.(acknowledgement)
        this.pending.get(acknowledgement.requestId)?.(
          acknowledgement.success
            ? 'flushed'
            : acknowledgement.failureCode === 'agent_conversations_too_large'
              ? 'agent_conversations_too_large'
              : 'failed',
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

  /** Reuse the trusted flush handshake, but inspect without saving until installation is confirmed. */
  requestInstallReadiness(): Promise<WorkspaceStateFlushAcknowledgement | null> {
    if (this.mainWindow.isDestroyed() || this.mainWindow.webContents.isDestroyed())
      return Promise.resolve(null)
    const requestId = `update-inspect:${randomUUID()}`
    return new Promise((resolve) => {
      const timeout = setTimeout(() => finish(null), this.timeoutMs)
      const finish = (value: WorkspaceStateFlushAcknowledgement | null): void => {
        clearTimeout(timeout)
        this.installReadiness.delete(requestId)
        resolve(value)
      }
      this.installReadiness.set(requestId, finish)
      this.mainWindow.webContents.send(workspaceStateIpcEvents.flushRequest, requestId)
    })
  }

  dispose(): void {
    for (const finish of this.installReadiness.values()) finish(null)
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
