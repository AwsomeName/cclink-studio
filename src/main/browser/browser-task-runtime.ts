import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { browserIpcEvents } from '../../shared/ipc/browser'
import type {
  BrowserActionLog,
  BrowserActionLogChangedPayload,
  BrowserTaskChangedPayload,
  BrowserTaskRun,
  BrowserTaskStatus,
  FailBrowserActionLogOptions,
  FailBrowserTaskOptions,
  StartBrowserActionLogOptions,
  StartBrowserTaskOptions,
  UpdateBrowserTaskCorrelationOptions,
} from './browser-task-types'

const FINAL_STATUSES = new Set<BrowserTaskStatus>(['completed', 'failed', 'cancelled'])

export interface BrowserAccountRecoveryLease {
  id: string
  accountId: string
  profileId: string
  affairId: string
  attemptId: string
  executionGeneration: number
  launchOperationId: string
  acquiredAt: number
}

type BrowserAccountLeaseOwner =
  | { kind: 'task'; taskRunId: string }
  | ({ kind: 'recovery' } & BrowserAccountRecoveryLease)

export class BrowserTaskRuntime {
  private readonly tasks = new Map<string, BrowserTaskRun>()
  private readonly activeTaskByTab = new Map<string, string>()
  /** Single main-owned authority for both recovery and Agent account ownership. */
  private readonly accountLeaseByAccount = new Map<string, BrowserAccountLeaseOwner>()
  private readonly actionLogs = new Map<string, BrowserActionLog[]>()
  private readonly actionLogById = new Map<string, BrowserActionLog>()
  private readonly taskListeners = new Set<(task: BrowserTaskRun) => void>()
  private readonly actionLogListeners = new Set<(log: BrowserActionLog) => void>()

  constructor(
    private readonly mainWindow: BrowserWindow,
    private readonly sendToTabOwner?: (tabId: string, channel: string, payload: unknown) => boolean,
  ) {}

  startTask(options: StartBrowserTaskOptions): BrowserTaskRun {
    const accountId = options.correlation?.accountId
    if (accountId) {
      const owner = this.getLiveAccountLeaseOwner(accountId)
      if (owner?.kind === 'recovery') {
        throw new Error('该账号正在恢复原网页事务，请等待恢复完成或取消后重试')
      }
      const leasedTask = owner?.kind === 'task' ? this.tasks.get(owner.taskRunId) : undefined
      if (leasedTask && !FINAL_STATUSES.has(leasedTask.status)) {
        const resumesSameAffairAttempt =
          leasedTask.status === 'paused' &&
          Boolean(options.correlation?.affairId) &&
          leasedTask.correlation?.affairId === options.correlation?.affairId &&
          leasedTask.correlation?.affairAttemptId === options.correlation?.affairAttemptId
        if (
          leasedTask.correlation?.conversationId !== options.correlation?.conversationId &&
          !resumesSameAffairAttempt
        ) {
          throw new Error('该账号正在由另一个 Agent 任务使用，请先完成或取消原任务')
        }
        this.cancelTask(leasedTask.id)
      }
    }
    const existing = this.getActiveTaskForTab(options.tabId)
    if (existing && !FINAL_STATUSES.has(existing.status)) {
      this.cancelTask(existing.id)
    }

    const task: BrowserTaskRun = {
      id: randomUUID(),
      tabId: options.tabId,
      goal: options.goal,
      correlation: options.correlation ? { ...options.correlation } : undefined,
      status: 'running',
      startedAt: Date.now(),
      downloadIds: [],
    }
    this.tasks.set(task.id, task)
    this.activeTaskByTab.set(task.tabId, task.id)
    if (accountId) this.accountLeaseByAccount.set(accountId, { kind: 'task', taskRunId: task.id })
    this.emitTaskChanged(task)
    return cloneTask(task)
  }

  acquireAccountRecoveryLease(
    input: Omit<BrowserAccountRecoveryLease, 'id' | 'acquiredAt'>,
  ): BrowserAccountRecoveryLease {
    const owner = this.getLiveAccountLeaseOwner(input.accountId)
    if (owner) {
      throw new Error(
        owner.kind === 'recovery'
          ? '该账号已有恢复任务正在核验原页面，请等待完成后重试'
          : '该账号正在由另一个 Agent 任务使用，请先完成或取消原任务',
      )
    }
    const lease: BrowserAccountRecoveryLease = {
      ...input,
      id: randomUUID(),
      acquiredAt: Date.now(),
    }
    this.accountLeaseByAccount.set(input.accountId, { kind: 'recovery', ...lease })
    return { ...lease }
  }

  releaseAccountRecoveryLease(leaseId: string): boolean {
    for (const [accountId, owner] of this.accountLeaseByAccount) {
      if (owner.kind !== 'recovery' || owner.id !== leaseId) continue
      this.accountLeaseByAccount.delete(accountId)
      return true
    }
    return false
  }

  transferAccountRecoveryLeaseToTask(
    leaseId: string,
    taskRunId: string,
    patch: UpdateBrowserTaskCorrelationOptions,
  ): BrowserTaskRun {
    const task = this.requireTask(taskRunId)
    if (FINAL_STATUSES.has(task.status) || !task.correlation) {
      throw new Error('恢复租约不能转交给已结束或无 Agent 身份的 BrowserTask')
    }
    const leaseEntry = [...this.accountLeaseByAccount.entries()].find(
      ([, owner]) => owner.kind === 'recovery' && owner.id === leaseId,
    )
    if (!leaseEntry || leaseEntry[1].kind !== 'recovery') {
      throw new Error('恢复租约已失效，拒绝把账号写入权交给 BrowserTask')
    }
    const [accountId, lease] = leaseEntry
    if (
      (patch.accountId && patch.accountId !== accountId) ||
      (task.correlation.accountId && task.correlation.accountId !== accountId)
    ) {
      throw new Error('BrowserTask 与恢复租约的账号或事务代次不匹配')
    }
    const nextCorrelation = { ...task.correlation, ...patch, accountId }
    const generation = nextCorrelation.affairExecutionGeneration
    const transfersCurrentRun =
      generation === lease.executionGeneration &&
      nextCorrelation.affairLaunchOperationId === lease.launchOperationId
    const transfersImmediateContinuation = generation === lease.executionGeneration + 1
    if (
      nextCorrelation.profileId !== lease.profileId ||
      nextCorrelation.affairId !== lease.affairId ||
      nextCorrelation.affairAttemptId !== lease.attemptId ||
      (!transfersCurrentRun && !transfersImmediateContinuation)
    ) {
      throw new Error('BrowserTask 与恢复租约的账号或事务代次不匹配')
    }

    // Correlation and owner change in one synchronous main-process operation, so another task
    // cannot acquire the account between recovery verification and Agent ownership.
    task.correlation = nextCorrelation
    this.accountLeaseByAccount.set(accountId, { kind: 'task', taskRunId: task.id })
    this.emitTaskChanged(task)
    return cloneTask(task)
  }

  listTasks(): BrowserTaskRun[] {
    return Array.from(this.tasks.values()).map(cloneTask)
  }

  onTaskChanged(listener: (task: BrowserTaskRun) => void): () => void {
    this.taskListeners.add(listener)
    return () => this.taskListeners.delete(listener)
  }

  onActionLogChanged(listener: (log: BrowserActionLog) => void): () => void {
    this.actionLogListeners.add(listener)
    return () => this.actionLogListeners.delete(listener)
  }

  getTask(taskRunId: string): BrowserTaskRun | null {
    const task = this.tasks.get(taskRunId)
    return task ? cloneTask(task) : null
  }

  getActiveTaskForTab(tabId: string): BrowserTaskRun | null {
    const taskId = this.activeTaskByTab.get(tabId)
    if (!taskId) return null
    const task = this.tasks.get(taskId)
    if (!task || FINAL_STATUSES.has(task.status)) return null
    return cloneTask(task)
  }

  getActiveTaskForConversation(
    conversationId: string,
    workspaceKey?: string | null,
  ): BrowserTaskRun | null {
    const candidates = Array.from(this.tasks.values()).reverse()
    const task = candidates.find(
      (candidate) =>
        !FINAL_STATUSES.has(candidate.status) &&
        candidate.correlation?.conversationId === conversationId &&
        (workspaceKey === undefined || candidate.correlation.workspaceKey === workspaceKey),
    )
    return task ? cloneTask(task) : null
  }

  getTaskForAgentRun(conversationId: string, agentRunId: string): BrowserTaskRun | null {
    const task = Array.from(this.tasks.values())
      .reverse()
      .find(
        (candidate) =>
          candidate.correlation?.conversationId === conversationId &&
          candidate.correlation.agentRunId === agentRunId,
      )
    return task ? cloneTask(task) : null
  }

  assertCanRunAction(tabId: string): BrowserTaskRun | null {
    const taskId = this.activeTaskByTab.get(tabId)
    if (!taskId) return null
    const task = this.tasks.get(taskId)
    if (!task) return null

    if (task.status === 'paused') {
      throw new Error('Browser task is paused')
    }
    if (task.status === 'cancelled') {
      throw new Error('Browser task is cancelled')
    }
    if (task.status === 'failed') {
      throw new Error('Browser task has failed')
    }

    return cloneTask(task)
  }

  pauseTask(taskRunId: string): BrowserTaskRun {
    return this.transition(taskRunId, 'paused', { reobservationRequired: true })
  }

  pauseForTakeover(taskRunId: string, reason: string): BrowserTaskRun {
    return this.transition(taskRunId, 'paused', {
      reobservationRequired: true,
      takeoverReason: reason,
    })
  }

  resumeTask(taskRunId: string, userConfirmedUrl?: string): BrowserTaskRun {
    const task = this.requireTask(taskRunId)
    if (task.correlation?.accountId && !task.correlation.affairId && userConfirmedUrl) {
      try {
        const parsed = new URL(userConfirmedUrl)
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          const allowedOrigins = new Set(task.correlation.allowedOrigins ?? [])
          allowedOrigins.add(parsed.origin)
          task.correlation = { ...task.correlation, allowedOrigins: [...allowedOrigins] }
        }
      } catch {
        // 非网页 URL 不扩张账号边界，仍可恢复到原 Origin 后继续。
      }
    }
    return this.transition(taskRunId, 'running')
  }

  markReobserved(taskRunId: string): BrowserTaskRun {
    const task = this.requireTask(taskRunId)
    if (!task.reobservationRequired) return cloneTask(task)
    task.reobservationRequired = false
    task.actionResultUnknown = false
    task.takeoverReason = undefined
    this.emitTaskChanged(task)
    return cloneTask(task)
  }

  markActionResultUnknown(taskRunId: string, errorMessage?: string): BrowserTaskRun {
    const task = this.requireTask(taskRunId)
    if (FINAL_STATUSES.has(task.status)) return cloneTask(task)
    task.reobservationRequired = true
    task.actionResultUnknown = true
    task.errorMessage = errorMessage
    this.emitTaskChanged(task)
    return cloneTask(task)
  }

  cancelTaskForConversation(conversationId: string): void {
    const task = this.getActiveTaskForConversation(conversationId)
    if (task) this.cancelTask(task.id)
  }

  finishTask(taskRunId: string): BrowserTaskRun {
    return this.transition(taskRunId, 'completed', { endedAt: Date.now() })
  }

  cancelTask(taskRunId: string): BrowserTaskRun {
    return this.transition(taskRunId, 'cancelled', {
      endedAt: Date.now(),
      failureReason: 'user_interrupted',
    })
  }

  failTask(taskRunId: string, options: FailBrowserTaskOptions): BrowserTaskRun {
    return this.transition(taskRunId, 'failed', {
      endedAt: Date.now(),
      failureReason: options.reason,
      errorMessage: options.errorMessage,
    })
  }

  cancelTasksForTab(tabId: string, reason: 'tab_closed' | 'user_interrupted' = 'tab_closed'): void {
    const taskId = this.activeTaskByTab.get(tabId)
    if (!taskId) return
    const task = this.tasks.get(taskId)
    if (!task || FINAL_STATUSES.has(task.status)) return
    this.transition(taskId, 'cancelled', {
      endedAt: Date.now(),
      failureReason: reason,
      errorMessage: reason === 'tab_closed' ? '浏览器标签页已关闭' : undefined,
    })
  }

  addDownload(taskRunId: string, downloadId: string): BrowserTaskRun {
    const task = this.requireTask(taskRunId)
    if (!task.downloadIds.includes(downloadId)) {
      task.downloadIds.push(downloadId)
    }
    this.emitTaskChanged(task)
    return cloneTask(task)
  }

  updateCorrelation(taskRunId: string, patch: UpdateBrowserTaskCorrelationOptions): BrowserTaskRun {
    const task = this.requireTask(taskRunId)
    if (!task.correlation) return cloneTask(task)
    const nextCorrelation = { ...task.correlation, ...patch }
    const changed = Object.entries(patch).some(
      ([key, value]) => task.correlation?.[key as keyof typeof task.correlation] !== value,
    )
    if (!changed) return cloneTask(task)
    const previousAccountId = task.correlation.accountId
    const nextAccountId = nextCorrelation.accountId
    if (nextAccountId && nextAccountId !== previousAccountId) {
      const owner = this.getLiveAccountLeaseOwner(nextAccountId)
      if (owner?.kind === 'recovery') {
        throw new Error('该账号正在恢复原网页事务，普通 BrowserTask 不能取得写入权')
      }
      if (owner?.kind === 'task' && owner.taskRunId !== task.id) {
        throw new Error('该账号正在由另一个 Agent 任务使用，请先完成或取消原任务')
      }
    }
    task.correlation = nextCorrelation
    if (
      previousAccountId &&
      previousAccountId !== nextAccountId &&
      this.isTaskAccountLeaseOwner(previousAccountId, task.id)
    ) {
      this.accountLeaseByAccount.delete(previousAccountId)
    }
    if (nextAccountId) {
      this.accountLeaseByAccount.set(nextAccountId, { kind: 'task', taskRunId: task.id })
    }
    this.emitTaskChanged(task)
    return cloneTask(task)
  }

  startActionLog(options: StartBrowserActionLogOptions): BrowserActionLog {
    this.requireTask(options.taskRunId)
    const log: BrowserActionLog = {
      id: randomUUID(),
      taskRunId: options.taskRunId,
      tabId: options.tabId,
      action: options.action,
      paramsSummary: options.paramsSummary,
      status: 'started',
      startedAt: Date.now(),
    }

    const logs = this.actionLogs.get(options.taskRunId) ?? []
    logs.push(log)
    this.actionLogs.set(options.taskRunId, logs)
    this.actionLogById.set(log.id, log)
    this.emitActionLogChanged(log)
    return { ...log }
  }

  succeedActionLog(logId: string): BrowserActionLog {
    const log = this.requireActionLog(logId)
    if (log.status !== 'started') return { ...log }
    log.status = 'succeeded'
    log.endedAt = Date.now()
    this.emitActionLogChanged(log)
    return { ...log }
  }

  failActionLog(logId: string, options: FailBrowserActionLogOptions): BrowserActionLog {
    const log = this.requireActionLog(logId)
    if (log.status !== 'started') return { ...log }
    log.status = 'failed'
    log.endedAt = Date.now()
    log.failureReason = options.reason
    log.errorMessage = options.errorMessage
    this.emitActionLogChanged(log)
    return { ...log }
  }

  listActionLogs(taskRunId: string): BrowserActionLog[] {
    return (this.actionLogs.get(taskRunId) ?? []).map((log) => ({ ...log }))
  }

  private transition(
    taskRunId: string,
    status: BrowserTaskStatus,
    patch: Partial<BrowserTaskRun> = {},
  ): BrowserTaskRun {
    const task = this.requireTask(taskRunId)
    if (FINAL_STATUSES.has(task.status)) {
      return cloneTask(task)
    }

    Object.assign(task, patch, { status })
    if (status === 'completed') {
      this.activeTaskByTab.delete(task.tabId)
    } else {
      this.activeTaskByTab.set(task.tabId, task.id)
    }
    if (FINAL_STATUSES.has(status)) {
      const accountId = task.correlation?.accountId
      if (accountId && this.isTaskAccountLeaseOwner(accountId, task.id)) {
        this.accountLeaseByAccount.delete(accountId)
      }
    }
    this.emitTaskChanged(task)
    return cloneTask(task)
  }

  private requireTask(taskRunId: string): BrowserTaskRun {
    const task = this.tasks.get(taskRunId)
    if (!task) throw new Error(`浏览器任务不存在: ${taskRunId}`)
    return task
  }

  private requireActionLog(logId: string): BrowserActionLog {
    const log = this.actionLogById.get(logId)
    if (!log) throw new Error(`浏览器动作日志不存在: ${logId}`)
    return log
  }

  private getLiveAccountLeaseOwner(accountId: string): BrowserAccountLeaseOwner | null {
    const owner = this.accountLeaseByAccount.get(accountId)
    if (!owner || owner.kind === 'recovery') return owner ?? null
    const task = this.tasks.get(owner.taskRunId)
    if (task && !FINAL_STATUSES.has(task.status)) return owner
    this.accountLeaseByAccount.delete(accountId)
    return null
  }

  private isTaskAccountLeaseOwner(accountId: string, taskRunId: string): boolean {
    const owner = this.accountLeaseByAccount.get(accountId)
    return owner?.kind === 'task' && owner.taskRunId === taskRunId
  }

  private emitTaskChanged(task: BrowserTaskRun): void {
    const snapshot = cloneTask(task)
    for (const listener of this.taskListeners) {
      try {
        listener(snapshot)
      } catch (error) {
        console.warn('[BrowserTaskRuntime] task listener 失败:', error)
      }
    }
    if (this.mainWindow.isDestroyed()) return
    const payload: BrowserTaskChangedPayload = {
      task: snapshot,
    }
    if (this.sendToTabOwner?.(task.tabId, browserIpcEvents.taskChanged, payload)) return
    this.mainWindow.webContents.send(browserIpcEvents.taskChanged, payload)
  }

  private emitActionLogChanged(log: BrowserActionLog): void {
    const snapshot = { ...log }
    for (const listener of this.actionLogListeners) {
      try {
        listener(snapshot)
      } catch (error) {
        console.warn('[BrowserTaskRuntime] action listener 失败:', error)
      }
    }
    if (this.mainWindow.isDestroyed()) return
    const payload: BrowserActionLogChangedPayload = {
      log: snapshot,
    }
    if (this.sendToTabOwner?.(log.tabId, browserIpcEvents.actionLogChanged, payload)) return
    this.mainWindow.webContents.send(browserIpcEvents.actionLogChanged, payload)
  }
}

function cloneTask(task: BrowserTaskRun): BrowserTaskRun {
  return {
    ...task,
    correlation: task.correlation
      ? {
          ...task.correlation,
          allowedOrigins: task.correlation.allowedOrigins
            ? [...task.correlation.allowedOrigins]
            : undefined,
        }
      : undefined,
    downloadIds: [...task.downloadIds],
  }
}

const SENSITIVE_KEY_RE = /(password|passwd|pwd|token|secret|cookie|authorization|api[-_]?key)/i

export function summarizeBrowserActionParams(
  action: string,
  params: Record<string, unknown>,
): string {
  const summary: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(params)) {
    if (key === 'type') continue
    if (SENSITIVE_KEY_RE.test(key)) {
      summary[key] = '[redacted]'
      continue
    }
    if (action === 'fill' && key === 'value') {
      summary[key] = typeof value === 'string' ? `[redacted:${value.length} chars]` : '[redacted]'
      continue
    }
    if (action === 'evaluate' && key === 'expression') {
      summary[key] =
        typeof value === 'string' ? `[javascript:${value.length} chars]` : '[javascript]'
      continue
    }
    if (action === 'setCookie' && key === 'value') {
      summary[key] = '[redacted]'
      continue
    }
    if (Array.isArray(value)) {
      summary[key] = value.map((item) => (typeof item === 'string' ? item.split('/').pop() : item))
      continue
    }
    summary[key] = value
  }

  const serialized = JSON.stringify(summary)
  return serialized.length > 500 ? `${serialized.slice(0, 497)}...` : serialized
}
