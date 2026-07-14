import { ipcMain, type WebContents } from 'electron'
import type {
  TerminalAuditListFilter,
  TerminalLifecycleAuditInput,
  TerminalLifecycleAuditKind,
  TerminalSessionSnapshot,
  TerminalSubmitCommandInput,
} from '../../shared/ipc/terminal'
import type {
  TerminalCommandActor,
  TerminalExecutionEvent,
  TerminalPermissionMode,
  TerminalPermissionPolicy,
  TerminalPermissionRisk,
  TerminalRuntimeRef,
} from '../../shared/terminal'
import type { TerminalAuditStore } from '../terminal/terminal-audit-store'
import type { TerminalCommandOrchestrator } from '../terminal/terminal-command-orchestrator'
import type { TerminalConfirmationService } from '../terminal/terminal-confirmation-service'
import type { TerminalExecutionAdapter } from '../terminal/terminal-execution-adapter'
import type { TerminalSessionRegistry } from '../terminal/terminal-session-registry'
import { canTransitionTerminalStatus } from '../terminal/terminal-session-state'

export function registerTerminalIpc(
  terminalConfirmationService: TerminalConfirmationService,
  terminalAuditStore?: TerminalAuditStore,
  terminalSessionRegistry?: TerminalSessionRegistry,
  terminalCommandOrchestrator?: TerminalCommandOrchestrator,
  terminalExecutionAdapter?: TerminalExecutionAdapter,
  webContents?: WebContents,
): void {
  if (terminalExecutionAdapter) {
    terminalExecutionAdapter.onEvent((event) => {
      webContents?.send('terminal:executionEvent', event)
      void syncTerminalExecutionEvent(event, terminalSessionRegistry, terminalAuditStore)
    })
  }

  ipcMain.handle(
    'terminal:resolveCommandConfirmation',
    (_event, id: string, approved: boolean) => {
      return {
        success: terminalConfirmationService.resolveConfirmation(id, approved),
      }
    },
  )

  ipcMain.handle('terminal:recordLifecycleEvent', async (_event, input?: TerminalLifecycleAuditInput) => {
    if (!terminalAuditStore) return { success: false, error: 'Terminal 审计存储未就绪' }
    const normalized = normalizeLifecycleAuditInput(input)
    if (!normalized) {
      return { success: false, error: 'Terminal 生命周期审计事件无效' }
    }
    const registryResult = await syncTerminalSessionRegistry(
      input,
      terminalSessionRegistry,
      terminalExecutionAdapter,
    )
    if (!registryResult.success) return registryResult
    await terminalAuditStore.recordEvent(normalized)
    return { success: true }
  })

  ipcMain.handle('terminal:listAuditEvents', async (_event, filter?: TerminalAuditListFilter) => {
    if (!terminalAuditStore) return []
    return terminalAuditStore.listEvents(normalizeAuditFilter(filter))
  })

  ipcMain.handle('terminal:listSessions', async () => {
    if (!terminalSessionRegistry) return []
    return terminalSessionRegistry.list().map(toTerminalSessionSnapshot)
  })

  ipcMain.handle('terminal:submitCommand', async (_event, input?: TerminalSubmitCommandInput) => {
    if (!terminalCommandOrchestrator) {
      return {
        success: false,
        status: 'rejected',
        error: 'Terminal 命令编排器未就绪',
      }
    }
    const normalized = normalizeSubmitCommandInput(input)
    if (!normalized) {
      return {
        success: false,
        status: 'rejected',
        error: 'Terminal 命令提交参数无效',
      }
    }
    return terminalCommandOrchestrator.submitCommand(normalized)
  })

  ipcMain.handle('terminal:clearAuditSession', async (_event, terminalSessionId: string) => {
    if (!terminalAuditStore) return { success: false, error: 'Terminal 审计存储未就绪' }
    if (!terminalSessionId || typeof terminalSessionId !== 'string') {
      return { success: false, error: 'terminalSessionId 不能为空' }
    }
    await terminalAuditStore.clearSession(terminalSessionId)
    return { success: true }
  })

  ipcMain.handle('terminal:clearAuditEvents', async () => {
    if (!terminalAuditStore) return { success: false, error: 'Terminal 审计存储未就绪' }
    await terminalAuditStore.clearAll()
    return { success: true }
  })
}

function normalizeAuditFilter(filter?: TerminalAuditListFilter): TerminalAuditListFilter {
  if (!filter || typeof filter !== 'object') return {}
  const normalized: TerminalAuditListFilter = {}
  if (typeof filter.terminalSessionId === 'string' && filter.terminalSessionId) {
    normalized.terminalSessionId = filter.terminalSessionId
  }
  if ('workspaceKey' in filter) {
    normalized.workspaceKey = typeof filter.workspaceKey === 'string' ? filter.workspaceKey : null
  }
  if (typeof filter.limit === 'number' && Number.isFinite(filter.limit)) {
    normalized.limit = Math.max(0, Math.floor(filter.limit))
  }
  return normalized
}

const TERMINAL_LIFECYCLE_KINDS = new Set<TerminalLifecycleAuditKind>([
  'created',
  'closed',
  'terminated',
])

const TERMINAL_ACTORS = new Set<TerminalCommandActor>(['user', 'agent', 'system'])
const TERMINAL_PERMISSION_MODES = new Set<TerminalPermissionMode>([
  'read-only',
  'ask-every-command',
  'ask-risky-command',
  'trusted-session',
])
const TERMINAL_PERMISSION_RISKS = new Set<TerminalPermissionRisk>([
  'read',
  'write',
  'network',
  'destructive',
  'privileged',
  'unknown',
])

function normalizeLifecycleAuditInput(
  input?: TerminalLifecycleAuditInput,
): TerminalLifecycleAuditInput | null {
  if (!input || typeof input !== 'object') return null
  if (typeof input.terminalSessionId !== 'string' || !input.terminalSessionId) return null
  if (!TERMINAL_LIFECYCLE_KINDS.has(input.kind)) return null

  return {
    terminalSessionId: input.terminalSessionId,
    workspaceKey: typeof input.workspaceKey === 'string' ? input.workspaceKey : null,
    kind: input.kind,
    message: typeof input.message === 'string' ? input.message.slice(0, 500) : undefined,
  }
}

function normalizeSubmitCommandInput(
  input?: TerminalSubmitCommandInput,
): TerminalSubmitCommandInput | null {
  if (!input || typeof input !== 'object') return null
  if (typeof input.terminalSessionId !== 'string' || !input.terminalSessionId.trim()) return null
  if (typeof input.command !== 'string' || !input.command.trim()) return null
  if (!TERMINAL_ACTORS.has(input.actor)) return null

  const permissionPolicy = normalizePermissionPolicy(input.permissionPolicy)
  if (!permissionPolicy) return null

  return {
    terminalSessionId: input.terminalSessionId.trim(),
    command: input.command.trim().slice(0, 4000),
    actor: input.actor,
    permissionPolicy,
    workspaceKey: typeof input.workspaceKey === 'string' ? input.workspaceKey : null,
  }
}

function normalizePermissionPolicy(policy?: TerminalPermissionPolicy): TerminalPermissionPolicy | null {
  if (!policy || typeof policy !== 'object') return null
  if (!TERMINAL_PERMISSION_MODES.has(policy.mode)) return null

  return {
    mode: policy.mode,
    requireConfirmationFor: normalizeRisks(policy.requireConfirmationFor),
    allowlist: normalizeStringRules(policy.allowlist),
    denylist: normalizeStringRules(policy.denylist),
  }
}

function normalizeRisks(risks?: TerminalPermissionRisk[]): TerminalPermissionRisk[] {
  if (!Array.isArray(risks)) return []
  return [...new Set(risks.filter((risk) => TERMINAL_PERMISSION_RISKS.has(risk)))].slice(0, 16)
}

function normalizeStringRules(rules?: string[]): string[] | undefined {
  if (!Array.isArray(rules)) return undefined
  const normalized = rules
    .filter((rule): rule is string => typeof rule === 'string')
    .map((rule) => rule.trim().replace(/\s+/g, ' ').slice(0, 300))
    .filter(Boolean)
  return normalized.length > 0 ? [...new Set(normalized)].slice(0, 50) : undefined
}

async function syncTerminalSessionRegistry(
  input: TerminalLifecycleAuditInput | undefined,
  terminalSessionRegistry?: TerminalSessionRegistry,
  terminalExecutionAdapter?: TerminalExecutionAdapter,
): Promise<{ success: true } | { success: false; error: string }> {
  if (!terminalSessionRegistry || !input) return { success: true }

  try {
    if (input.kind === 'created') {
      if (!isTerminalRuntimeRef(input.runtime)) return { success: true }
      if (!terminalSessionRegistry.get(input.terminalSessionId)) {
        terminalSessionRegistry.register({
          sessionId: input.terminalSessionId,
          runtime: input.runtime,
        })
      }
      return { success: true }
    }

    if (input.kind === 'closed') {
      terminalSessionRegistry.remove(input.terminalSessionId)
      return { success: true }
    }

    if (input.kind === 'terminated') {
      await terminalExecutionAdapter?.terminate(input.terminalSessionId).catch(() => undefined)
      const session = terminalSessionRegistry.get(input.terminalSessionId)
      if (session && canTransitionTerminalStatus(session.status, 'exited')) {
        terminalSessionRegistry.transition(input.terminalSessionId, 'exited', {
          exitCode: undefined,
          errorMessage: 'Terminal 关闭时请求结束进程',
        })
      }
      terminalSessionRegistry.remove(input.terminalSessionId)
      return { success: true }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: `Terminal session 生命周期同步失败：${(error as Error).message}`,
    }
  }
}

async function syncTerminalExecutionEvent(
  event: TerminalExecutionEvent,
  terminalSessionRegistry?: TerminalSessionRegistry,
  terminalAuditStore?: TerminalAuditStore,
): Promise<void> {
  try {
    syncTerminalExecutionRegistry(event, terminalSessionRegistry)
    await recordTerminalExecutionAudit(event, terminalAuditStore)
  } catch (error) {
    console.warn('[TerminalIPC] 执行事件同步失败:', (error as Error).message)
  }
}

function syncTerminalExecutionRegistry(
  event: TerminalExecutionEvent,
  terminalSessionRegistry?: TerminalSessionRegistry,
): void {
  if (!terminalSessionRegistry) return
  const session = terminalSessionRegistry.get(event.sessionId)
  if (!session) return

  if (event.kind === 'started') {
    if (session.status === 'idle' && canTransitionTerminalStatus('idle', 'starting')) {
      terminalSessionRegistry.transition(event.sessionId, 'starting', { now: event.timestamp })
    }
    const current = terminalSessionRegistry.get(event.sessionId)
    if (current && canTransitionTerminalStatus(current.status, 'running')) {
      terminalSessionRegistry.transition(event.sessionId, 'running', {
        now: event.timestamp,
        processId: event.processId,
      })
    }
    return
  }

  if (event.kind === 'exit' && canTransitionTerminalStatus(session.status, 'exited')) {
    terminalSessionRegistry.transition(event.sessionId, 'exited', {
      now: event.timestamp,
      exitCode: event.exitCode,
      errorMessage: event.signal ? `signal: ${event.signal}` : undefined,
    })
    return
  }

  if (event.kind === 'error' && canTransitionTerminalStatus(session.status, 'error')) {
    terminalSessionRegistry.transition(event.sessionId, 'error', {
      now: event.timestamp,
      errorMessage: event.message,
    })
  }
}

async function recordTerminalExecutionAudit(
  event: TerminalExecutionEvent,
  terminalAuditStore?: TerminalAuditStore,
): Promise<void> {
  if (!terminalAuditStore) return
  if (event.kind === 'started') {
    await terminalAuditStore.recordEvent({
      terminalSessionId: event.sessionId,
      timestamp: event.timestamp,
      kind: 'output',
      message: `Terminal 进程已启动${event.processId ? `：${event.processId}` : ''}`,
    })
    return
  }
  if (event.kind === 'output') {
    await terminalAuditStore.recordEvent({
      terminalSessionId: event.sessionId,
      timestamp: event.timestamp,
      kind: 'output',
      message: event.data.slice(0, 4000),
    })
    return
  }
  if (event.kind === 'exit') {
    await terminalAuditStore.recordEvent({
      terminalSessionId: event.sessionId,
      timestamp: event.timestamp,
      kind: 'exit',
      exitCode: event.exitCode,
      message: event.signal ? `Terminal 进程退出：${event.signal}` : 'Terminal 进程已退出',
    })
    return
  }
  if (event.kind === 'error') {
    await terminalAuditStore.recordEvent({
      terminalSessionId: event.sessionId,
      timestamp: event.timestamp,
      kind: 'error',
      message: event.message,
      remoteError: event.remoteError,
    })
  }
}

function isTerminalRuntimeRef(runtime: unknown): runtime is TerminalRuntimeRef {
  if (!runtime || typeof runtime !== 'object') return false
  const candidate = runtime as TerminalRuntimeRef
  if (candidate.location !== 'local' && candidate.location !== 'remote') return false
  if (!candidate.transport || typeof candidate.transport !== 'string') return false
  if (!candidate.backend || typeof candidate.backend !== 'string') return false
  if (!candidate.workspaceRef || typeof candidate.workspaceRef !== 'object') return false
  return true
}

function toTerminalSessionSnapshot(session: TerminalSessionSnapshot): TerminalSessionSnapshot {
  return {
    sessionId: session.sessionId,
    runtime: session.runtime,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    processId: session.processId,
    exitCode: session.exitCode,
    errorMessage: session.errorMessage,
    lastCommand: session.lastCommand,
  }
}
