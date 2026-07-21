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

export class BrowserTaskRuntime {
  private readonly tasks = new Map<string, BrowserTaskRun>()
  private readonly activeTaskByTab = new Map<string, string>()
  private readonly actionLogs = new Map<string, BrowserActionLog[]>()
  private readonly actionLogById = new Map<string, BrowserActionLog>()

  constructor(private readonly mainWindow: BrowserWindow) {}

  startTask(options: StartBrowserTaskOptions): BrowserTaskRun {
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
    this.emitTaskChanged(task)
    return cloneTask(task)
  }

  listTasks(): BrowserTaskRun[] {
    return Array.from(this.tasks.values()).map(cloneTask)
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
    return this.transition(taskRunId, 'paused')
  }

  resumeTask(taskRunId: string): BrowserTaskRun {
    return this.transition(taskRunId, 'running')
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
    task.correlation = nextCorrelation
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

  private emitTaskChanged(task: BrowserTaskRun): void {
    if (this.mainWindow.isDestroyed()) return
    const payload: BrowserTaskChangedPayload = {
      task: cloneTask(task),
    }
    this.mainWindow.webContents.send(browserIpcEvents.taskChanged, payload)
  }

  private emitActionLogChanged(log: BrowserActionLog): void {
    if (this.mainWindow.isDestroyed()) return
    const payload: BrowserActionLogChangedPayload = {
      log: { ...log },
    }
    this.mainWindow.webContents.send(browserIpcEvents.actionLogChanged, payload)
  }
}

function cloneTask(task: BrowserTaskRun): BrowserTaskRun {
  return {
    ...task,
    correlation: task.correlation ? { ...task.correlation } : undefined,
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
