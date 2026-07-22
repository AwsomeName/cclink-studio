import { randomUUID } from 'node:crypto'
import type {
  TerminalExecutionErrorInfo,
  TerminalPermissionRisk,
  TerminalStatus,
} from '../../shared/terminal'
import type {
  TerminalSubmitCommandInput,
  TerminalSubmitCommandResult,
} from '../../shared/ipc/terminal'
import { workspaceRefKey } from '../../shared/workspace-ref'
import type { TerminalAuditStore } from './terminal-audit-store'
import type { TerminalConfirmationService } from './terminal-confirmation-service'
import type { TerminalExecutionAdapter } from './terminal-execution-adapter'
import { evaluateTerminalPermission } from './terminal-permission'
import type { TerminalSessionRegistry } from './terminal-session-registry'
import type { TerminalSessionState } from './terminal-session-state'

export interface TerminalCommandOrchestratorOptions {
  sessionRegistry: Pick<TerminalSessionRegistry, 'get' | 'transition'>
  confirmationService: Pick<TerminalConfirmationService, 'requestConfirmation'>
  executionAdapter?: Pick<TerminalExecutionAdapter, 'start' | 'write'>
  auditStore?: Pick<TerminalAuditStore, 'recordEvent'>
  now?: () => number
  idFactory?: () => string
}

const SUBMITTABLE_STATUSES = new Set<TerminalStatus>(['idle', 'running'])

export class TerminalCommandOrchestrator {
  private readonly sessionRegistry: Pick<TerminalSessionRegistry, 'get' | 'transition'>
  private readonly confirmationService: Pick<TerminalConfirmationService, 'requestConfirmation'>
  private readonly executionAdapter?: Pick<TerminalExecutionAdapter, 'start' | 'write'>
  private readonly auditStore?: Pick<TerminalAuditStore, 'recordEvent'>
  private readonly now: () => number
  private readonly idFactory: () => string

  constructor(options: TerminalCommandOrchestratorOptions) {
    this.sessionRegistry = options.sessionRegistry
    this.confirmationService = options.confirmationService
    this.executionAdapter = options.executionAdapter
    this.auditStore = options.auditStore
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
  }

  async submitCommand(input: TerminalSubmitCommandInput): Promise<TerminalSubmitCommandResult> {
    const session = this.sessionRegistry.get(input.terminalSessionId)
    if (!session) {
      return {
        success: false,
        status: 'rejected',
        error: `Terminal session 不存在：${input.terminalSessionId}`,
      }
    }

    if (!SUBMITTABLE_STATUSES.has(session.status)) {
      return {
        success: false,
        status: 'rejected',
        error: `Terminal session 当前状态不可提交命令：${session.status}`,
      }
    }

    if (session.status === 'running' && input.actor !== 'user') {
      return {
        success: false,
        status: 'rejected',
        error:
          'Terminal 正在运行交互式进程，无法安全注入自动命令；请等待前台命令结束，或在新 Terminal 中执行',
      }
    }

    const decision = evaluateTerminalPermission(input.command, input.permissionPolicy)
    if (decision.action === 'deny') {
      await this.recordCommandAudit('command-denied', input, session, decision.risk, {
        approved: false,
        message: decision.reason,
      })
      return {
        success: false,
        status: 'denied',
        risk: decision.risk,
        error: decision.reason,
      }
    }

    if (decision.action === 'confirm') {
      const previousStatus = session.status
      this.sessionRegistry.transition(input.terminalSessionId, 'blocked', {
        lastCommand: input.command,
        now: this.now(),
      })

      const approved = await this.confirmationService.requestConfirmation({
        terminalSessionId: input.terminalSessionId,
        workspaceKey: this.resolveWorkspaceKey(input, session),
        command: input.command,
        actor: input.actor,
        risk: decision.risk,
        reason: decision.reason,
        cwd: session.runtime.cwd,
        runtime: session.runtime,
      })

      this.restoreAfterConfirmation(input.terminalSessionId, previousStatus, input.command)

      if (!approved) {
        return {
          success: false,
          status: 'denied',
          risk: decision.risk,
          error: 'Terminal 命令未获确认，真实执行未启动',
        }
      }
    }

    this.sessionRegistry.transition(input.terminalSessionId, session.status, {
      lastCommand: input.command,
      now: this.now(),
    })
    await this.recordCommandAudit('command-submitted', input, session, decision.risk, {
      approved: true,
      message: 'Terminal 命令已通过权限检查；真实执行尚未接入',
    })
    const executionStarted = await this.dispatchToExecutionAdapter(
      input,
      this.sessionRegistry.get(input.terminalSessionId) ?? session,
    )

    return {
      success: true,
      status: 'accepted',
      risk: decision.risk,
      execution: executionStarted ? 'started' : 'not-started',
      message: executionStarted
        ? 'Terminal 命令已通过权限检查并提交到执行后端'
        : 'Terminal 命令已通过权限检查；真实执行尚未接入',
    }
  }

  private async dispatchToExecutionAdapter(
    input: TerminalSubmitCommandInput,
    session: TerminalSessionState,
  ): Promise<boolean> {
    if (!this.executionAdapter) return false

    try {
      if (session.status === 'idle') {
        this.sessionRegistry.transition(input.terminalSessionId, 'starting', {
          lastCommand: input.command,
          now: this.now(),
        })
        await this.executionAdapter.start({
          sessionId: input.terminalSessionId,
          runtime: session.runtime,
        })
      }

      await this.executionAdapter.write({
        sessionId: input.terminalSessionId,
        data: `${input.command}\n`,
        actor: input.actor,
      })
      return true
    } catch (error) {
      await this.recordExecutionErrorAudit(input, session, error)
      this.transitionSessionToError(input.terminalSessionId, input.command, error)
      return false
    }
  }

  private restoreAfterConfirmation(
    terminalSessionId: string,
    previousStatus: TerminalStatus,
    command: string,
  ): void {
    if (!SUBMITTABLE_STATUSES.has(previousStatus)) return
    this.sessionRegistry.transition(terminalSessionId, previousStatus, {
      lastCommand: command,
      now: this.now(),
    })
  }

  private async recordCommandAudit(
    kind: 'command-submitted' | 'command-denied',
    input: TerminalSubmitCommandInput,
    session: TerminalSessionState,
    risk: TerminalPermissionRisk,
    options: { approved: boolean; message: string },
  ): Promise<void> {
    if (!this.auditStore) return

    await this.auditStore.recordEvent({
      id: this.idFactory(),
      terminalSessionId: input.terminalSessionId,
      workspaceKey: this.resolveWorkspaceKey(input, session),
      timestamp: this.now(),
      kind,
      actor: input.actor,
      command: input.command,
      risk,
      approved: options.approved,
      message: options.message,
    })
  }

  private async recordExecutionErrorAudit(
    input: TerminalSubmitCommandInput,
    session: TerminalSessionState,
    error: unknown,
  ): Promise<void> {
    if (!this.auditStore) return

    const executionError = getExecutionErrorFromUnknown(error)
    const message = executionError?.message ?? getErrorMessage(error)

    await this.auditStore.recordEvent({
      id: this.idFactory(),
      terminalSessionId: input.terminalSessionId,
      workspaceKey: this.resolveWorkspaceKey(input, session),
      timestamp: this.now(),
      kind: 'error',
      actor: input.actor,
      command: input.command,
      message,
      executionError,
    })
  }

  private transitionSessionToError(
    terminalSessionId: string,
    command: string,
    error: unknown,
  ): void {
    const current = this.sessionRegistry.get(terminalSessionId)
    if (!current || current.status === 'exited' || current.status === 'error') return
    this.sessionRegistry.transition(terminalSessionId, 'error', {
      lastCommand: command,
      errorMessage: getErrorMessage(error),
      now: this.now(),
    })
  }

  private resolveWorkspaceKey(
    input: TerminalSubmitCommandInput,
    session: TerminalSessionState,
  ): string | null {
    return input.workspaceKey ?? workspaceRefKey(session.runtime.workspaceRef)
  }
}

function getExecutionErrorFromUnknown(error: unknown): TerminalExecutionErrorInfo | undefined {
  if (!error || typeof error !== 'object' || !('executionError' in error)) return undefined
  const executionError = (error as { executionError?: unknown }).executionError
  if (!executionError || typeof executionError !== 'object') return undefined
  const candidate = executionError as Partial<TerminalExecutionErrorInfo>
  if (
    typeof candidate.layer !== 'string' ||
    typeof candidate.code !== 'string' ||
    typeof candidate.message !== 'string' ||
    typeof candidate.retryable !== 'boolean'
  ) {
    return undefined
  }
  return candidate as TerminalExecutionErrorInfo
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Terminal 执行适配器调用失败'
}
