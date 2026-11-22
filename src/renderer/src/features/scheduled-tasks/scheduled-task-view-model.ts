import type { ScheduledTaskRun } from '@shared/scheduled-task/scheduled-task-types'
import type {
  ScheduledTaskSchedule,
  ScheduledTaskSnapshot,
} from '@shared/scheduled-task/scheduled-task-types'
import type { Tab } from '../../types'

interface ScheduledTaskTabDraft {
  type: 'scheduled-task'
  title: string
  icon: string
  workspaceRef: { kind: 'local'; path: string }
  scheduledTask: NonNullable<Tab['scheduledTask']>
  forceNew: boolean
}

export function createScheduledTaskTab(
  workspacePath: string,
  task?: ScheduledTaskSnapshot,
): ScheduledTaskTabDraft {
  return {
    type: 'scheduled-task',
    title: task?.definition.title ?? '新建定时任务',
    icon: '🕒',
    workspaceRef: { kind: 'local', path: workspacePath },
    scheduledTask: {
      taskId: task?.definition.id ?? null,
      draftKey: task?.definition.id ?? crypto.randomUUID(),
    },
    forceNew: !task,
  }
}

export function describeSchedule(schedule: ScheduledTaskSchedule): string {
  if (schedule.kind === 'once') {
    if (!Number.isFinite(schedule.runAt)) return '请选择有效的单次执行时间'
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: schedule.timezone,
    }).format(schedule.runAt)
  }
  if (schedule.kind === 'daily') return `每天 ${schedule.time}`
  if (schedule.kind === 'monthly') return `每月最后一天 ${schedule.time}`
  if (schedule.kind === 'yearly') return `每年 12 月 31 日 ${schedule.time}`
  if (schedule.kind === 'weekdays') return `工作日 ${schedule.time}`
  const labels = ['日', '一', '二', '三', '四', '五', '六']
  return `每周${schedule.weekdays.map((day) => labels[day]).join('、')} ${schedule.time}`
}

export function formatNextRun(nextRunAt: number | null): string {
  if (nextRunAt === null) return '无下次执行'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(nextRunAt)
}

export function formatRunStatus(status: ScheduledTaskRun['status']): string {
  const labels: Record<ScheduledTaskRun['status'], string> = {
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    interrupted: '已中断',
    missed: '已错过',
    skipped: '已跳过',
  }
  return labels[status]
}
