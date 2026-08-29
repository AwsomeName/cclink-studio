import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type {
  TerminalAuditEventKind,
  TerminalCommandConfirmationRequest,
} from '../../shared/terminal'
import { terminalIpcEvents } from '../../shared/ipc/terminal'
import type { TerminalAuditStore } from './terminal-audit-store'

export const TERMINAL_CONFIRMATION_CHANNEL = terminalIpcEvents.requestCommandConfirmation

export const DEFAULT_TERMINAL_CONFIRMATION_TIMEOUT_MS = 60_000

type TerminalCommandConfirmationInput = Omit<
  TerminalCommandConfirmationRequest,
  'id' | 'createdAt' | 'expiresAt'
>

interface PendingTerminalConfirmation {
  request: TerminalCommandConfirmationRequest
  resolve: (approved: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

export interface TerminalConfirmationServiceOptions {
  timeoutMs?: number
  now?: () => number
  idFactory?: () => string
  auditStore?: Pick<TerminalAuditStore, 'recordEvent'>
}

export class TerminalConfirmationService {
  private mainWindow: BrowserWindow | null
  private pending = new Map<string, PendingTerminalConfirmation>()
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly auditStore?: Pick<TerminalAuditStore, 'recordEvent'>
  private auditQueue: Promise<void> = Promise.resolve()

  constructor(mainWindow: BrowserWindow, options: TerminalConfirmationServiceOptions = {}) {
    this.mainWindow = mainWindow
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TERMINAL_CONFIRMATION_TIMEOUT_MS
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    this.auditStore = options.auditStore
  }

  requestConfirmation(input: TerminalCommandConfirmationInput): Promise<boolean> {
    return new Promise((resolve) => {
      const request = this.buildRequest(input)
      const timeout = setTimeout(() => {
        this.rejectPendingByTimeout(request.id)
      }, this.timeoutMs)

      this.pending.set(request.id, { request, resolve, timeout })
      this.recordAudit(request, 'command-confirmation-requested', {
        message: 'Terminal 命令请求用户确认',
      })

      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        this.rejectPending(request.id, 'Terminal 确认窗口不可用，已拒绝')
        return
      }

      try {
        this.mainWindow.webContents.send(terminalIpcEvents.requestCommandConfirmation, request)
      } catch {
        this.rejectPending(request.id, 'Terminal 确认请求发送失败，已拒绝')
      }
    })
  }

  resolveConfirmation(id: string, approved: boolean): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false

    clearTimeout(pending.timeout)
    this.pending.delete(id)
    this.recordAudit(pending.request, approved ? 'command-approved' : 'command-denied', {
      approved,
      message: approved ? '用户允许 Terminal 命令' : '用户拒绝 Terminal 命令',
    })
    pending.resolve(approved)
    return true
  }

  getPendingRequests(): TerminalCommandConfirmationRequest[] {
    return [...this.pending.values()].map((pending) => pending.request)
  }

  destroy(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      this.recordAudit(pending.request, 'command-denied', {
        approved: false,
        message: 'Terminal 确认服务销毁，待确认命令已拒绝',
      })
      pending.resolve(false)
    }
    this.pending.clear()
    this.mainWindow = null
  }

  private buildRequest(
    input: TerminalCommandConfirmationInput,
  ): TerminalCommandConfirmationRequest {
    const createdAt = this.now()
    return {
      id: this.idFactory(),
      createdAt,
      expiresAt: createdAt + this.timeoutMs,
      ...input,
    }
  }

  async flushAudit(): Promise<void> {
    await this.auditQueue
  }

  private rejectPending(id: string, message: string): void {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timeout)
    this.pending.delete(id)
    this.recordAudit(pending.request, 'command-denied', {
      approved: false,
      message,
    })
    pending.resolve(false)
  }

  private rejectPendingByTimeout(id: string): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    this.recordAudit(pending.request, 'command-confirmation-timeout', {
      approved: false,
      message: 'Terminal 命令确认超时，已拒绝',
    })
    pending.resolve(false)
  }

  private recordAudit(
    request: TerminalCommandConfirmationRequest,
    kind: TerminalAuditEventKind,
    options: { approved?: boolean; message?: string } = {},
  ): void {
    if (!this.auditStore) return
    this.auditQueue = this.auditQueue
      .then(() =>
        this.auditStore!.recordEvent({
          id: `${request.id}:${kind}`,
          terminalSessionId: request.terminalSessionId,
          workspaceKey: request.workspaceKey,
          timestamp: this.now(),
          kind,
          actor: request.actor,
          command: request.command,
          risk: request.risk,
          approved: options.approved,
          message: options.message,
        }),
      )
      .then(
        () => undefined,
        (error) => {
          console.warn('[TerminalConfirmationService] 写入审计失败:', (error as Error).message)
        },
      )
  }
}
