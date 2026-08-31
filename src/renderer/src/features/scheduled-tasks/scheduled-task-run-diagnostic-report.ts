import type { DiagnosticLogSnapshot } from '@shared/diagnostics'
import { sanitizeDiagnosticText } from '@shared/diagnostics'
import type {
  ScheduledTaskRun,
  ScheduledTaskRuntimeStatus,
  ScheduledTaskSnapshot,
} from '@shared/scheduled-task/scheduled-task-types'

interface ScheduledTaskRunDiagnosticInput {
  task: ScheduledTaskSnapshot
  run: ScheduledTaskRun
  runtimeStatus?: ScheduledTaskRuntimeStatus
  runtimeStatusError?: string
  mainLogSnapshot?: DiagnosticLogSnapshot
  mainLogError?: string
  generatedAt?: number
}

const MAX_RELATED_LOG_ENTRIES = 100
const LOG_WINDOW_PADDING_MS = 5 * 60 * 1000

export function shouldOfferScheduledTaskRunLog(run: ScheduledTaskRun): boolean {
  return (
    Boolean(run.error) ||
    run.status === 'failed' ||
    run.status === 'interrupted' ||
    run.status === 'missed' ||
    run.status === 'skipped'
  )
}

export async function collectScheduledTaskRunDiagnosticReport(
  task: ScheduledTaskSnapshot,
  run: ScheduledTaskRun,
): Promise<string> {
  const [runtimeResult, mainLogResult] = await Promise.allSettled([
    window.cclinkStudio.scheduledTasks.getRuntimeStatus(),
    window.cclinkStudio.diagnostics.getMainLogSnapshot(),
  ])

  return buildScheduledTaskRunDiagnosticReport({
    task,
    run,
    ...(runtimeResult.status === 'fulfilled'
      ? { runtimeStatus: runtimeResult.value }
      : { runtimeStatusError: formatError(runtimeResult.reason) }),
    ...(mainLogResult.status === 'fulfilled'
      ? { mainLogSnapshot: mainLogResult.value }
      : { mainLogError: formatError(mainLogResult.reason) }),
  })
}

export function buildScheduledTaskRunDiagnosticReport(
  input: ScheduledTaskRunDiagnosticInput,
): string {
  const { task, run } = input
  const duration =
    run.startedAt === null
      ? '未开始'
      : run.finishedAt === null
        ? '仍在运行'
        : `${Math.max(0, run.finishedAt - run.startedAt)} ms`
  const lines = [
    '# CCLink Studio 定时任务运行日志',
    '',
    `- 生成时间：${formatTimestamp(input.generatedAt ?? Date.now())}`,
    '- 隐私：报告经过统一诊断脱敏，不包含任务指令或工作空间文件正文。',
    '',
    '## 运行',
    `- 任务：${task.definition.title}`,
    `- 任务 ID：${run.taskId}`,
    `- 工作空间 ID：${run.workspaceId}`,
    `- 定义来源：${task.definition.source}`,
    `- 任务 revision：${run.taskRevision}`,
    `- 运行绑定 digest：${run.taskExecutionDigest}`,
    `- 当前定义 digest：${task.definition.executionDigest}`,
    `- 本机确认 revision：${task.activation.confirmedTaskRevision ?? '无'}`,
    `- 本机确认 digest：${task.activation.confirmedExecutionDigest ?? '无'}`,
    `- 暂停原因：${task.activation.suspensionReason ?? '无'}`,
    `- 运行 ID：${run.id}`,
    `- Agent 会话 ID：${run.conversationId || '无（未启动 Agent）'}`,
    `- 状态：${run.status}`,
    `- 触发方式：${run.trigger}`,
    `- 计划时间：${formatTimestamp(run.scheduledFor)}`,
    `- 创建时间：${formatTimestamp(run.createdAt)}`,
    `- 开始时间：${formatTimestamp(run.startedAt)}`,
    `- 结束时间：${formatTimestamp(run.finishedAt)}`,
    `- 执行耗时：${duration}`,
    `- 当前步骤：${run.currentStep}`,
  ]

  if (run.error) {
    lines.push(
      '',
      '## 失败',
      `- 错误码：${run.error.code}`,
      `- 原因：${run.error.message}`,
      `- 建议：${run.error.recovery ?? '无'}`,
    )
  }

  lines.push('', '## 调度器')
  if (input.runtimeStatus) {
    lines.push(
      `- 状态：${input.runtimeStatus.state}`,
      `- 启动时间：${formatTimestamp(input.runtimeStatus.startedAt)}`,
      `- 下一次 timer：${formatTimestamp(input.runtimeStatus.timerDueAt)}`,
      `- 排队数量：${input.runtimeStatus.queuedCount}`,
      `- 当前运行 ID：${input.runtimeStatus.runningRunId ?? '无'}`,
      `- 已启用任务：${input.runtimeStatus.enabledCount}`,
      `- 系统调度：${input.runtimeStatus.systemScheduler}`,
    )
    if (input.runtimeStatus.lastError) {
      lines.push(
        `- 最近调度错误：${input.runtimeStatus.lastError.code} · ${input.runtimeStatus.lastError.message}`,
      )
    }
  } else {
    lines.push(`- 状态采集失败：${input.runtimeStatusError ?? '未知错误'}`)
  }

  lines.push('', '## 运行时段内的主进程日志')
  if (input.mainLogSnapshot) {
    const relatedEntries = selectRelatedLogEntries(input.mainLogSnapshot, run)
    lines.push(
      `- 日志截止时间：${input.mainLogSnapshot.capturedAt}`,
      `- 已丢弃旧记录：${input.mainLogSnapshot.droppedCount}`,
    )
    if (relatedEntries.length === 0) {
      lines.push('- 当前缓冲区没有保留该运行时段的主进程日志；上面的运行与失败记录仍是持久化事实。')
    } else {
      for (const entry of relatedEntries) {
        lines.push(`- ${entry.timestamp} · ${entry.level} · ${entry.message.replace(/\s+/g, ' ')}`)
      }
    }
  } else {
    lines.push(`- 日志采集失败：${input.mainLogError ?? '未知错误'}`)
  }

  return sanitizeDiagnosticText(lines.join('\n'), 100_000)
}

function selectRelatedLogEntries(
  snapshot: DiagnosticLogSnapshot,
  run: ScheduledTaskRun,
): DiagnosticLogSnapshot['entries'] {
  const start = run.createdAt - LOG_WINDOW_PADDING_MS
  const end = (run.finishedAt ?? Date.now()) + LOG_WINDOW_PADDING_MS
  const correlationTokens = [run.id, run.conversationId].filter(Boolean)
  return snapshot.entries
    .filter((entry) => {
      const timestamp = Date.parse(entry.timestamp)
      const scheduledTaskEntry = /\[ScheduledTask(?:Service|AgentRunner)\]/.test(entry.message)
      const correlatedEntry = correlationTokens.some((token) => entry.message.includes(token))
      return (
        Number.isFinite(timestamp) &&
        timestamp >= start &&
        timestamp <= end &&
        (scheduledTaskEntry || correlatedEntry)
      )
    })
    .slice(-MAX_RELATED_LOG_ENTRIES)
}

function formatTimestamp(timestamp: number | null): string {
  return timestamp === null ? '无' : new Date(timestamp).toISOString()
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
