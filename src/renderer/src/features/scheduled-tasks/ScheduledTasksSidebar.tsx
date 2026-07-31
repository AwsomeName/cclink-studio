import { useEffect, useMemo, useState } from 'react'
import type { ScheduledTaskSnapshot } from '@shared/scheduled-task/scheduled-task-types'
import { useTabStore } from '../../stores/tab-store'
import { IconClock, IconPlus } from '../../components/common/Icons'
import { useScheduledTaskStore } from './scheduled-task-store'
import { createScheduledTaskTab, formatNextRun } from './scheduled-task-view-model'
import './scheduled-tasks.css'

const EMPTY_TASKS: ScheduledTaskSnapshot[] = []

export function ScheduledTasksSidebar({
  workspacePath,
}: {
  workspacePath: string | null
}): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  const tasks = useScheduledTaskStore((state) =>
    workspacePath ? (state.tasksByWorkspace[workspacePath] ?? EMPTY_TASKS) : EMPTY_TASKS,
  )
  const loading = useScheduledTaskStore((state) =>
    workspacePath ? Boolean(state.loadingByWorkspace[workspacePath]) : false,
  )
  const error = useScheduledTaskStore((state) =>
    workspacePath ? (state.errorByWorkspace[workspacePath] ?? null) : null,
  )
  const load = useScheduledTaskStore((state) => state.load)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'paused'>('all')

  useEffect(() => {
    if (workspacePath) void load(workspacePath)
  }, [load, workspacePath])

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return tasks.filter((task) => {
      if (statusFilter === 'enabled' && !task.activation.enabled) return false
      if (statusFilter === 'paused' && task.activation.enabled) return false
      if (!normalizedQuery) return true
      return `${task.definition.title}\n${task.definition.instruction}`
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    })
  }, [query, statusFilter, tasks])

  useEffect(() => {
    if (!workspacePath) return
    return window.cclinkStudio.scheduledTasks.onChanged((changedWorkspacePath) => {
      if (changedWorkspacePath === workspacePath) void load(workspacePath)
    })
  }, [load, workspacePath])

  if (!workspacePath) {
    return (
      <div className="scheduled-task-sidebar-empty">
        <IconClock size={24} />
        <strong>请先打开本地工作空间</strong>
        <span>定时任务严格绑定工作空间，不会创建全局任务。</span>
      </div>
    )
  }

  const openNewTask = (): void => openTab(createScheduledTaskTab(workspacePath))

  if (loading && tasks.length === 0) {
    return <div className="scheduled-task-sidebar-message">正在读取定时任务…</div>
  }

  if (error && tasks.length === 0) {
    return (
      <div className="scheduled-task-sidebar-empty error">
        <strong>{error.message}</strong>
        <span>{error.recovery}</span>
        <button type="button" onClick={() => void load(workspacePath)}>
          重试
        </button>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="scheduled-task-sidebar-empty">
        <IconClock size={24} />
        <strong>这个工作空间还没有定时任务</strong>
        <span>创建后可立即运行；App 存活期间也会按计划自动执行。</span>
        <button type="button" onClick={openNewTask}>
          <IconPlus size={14} />
          新建定时任务
        </button>
      </div>
    )
  }

  const running = filteredTasks.filter((task) =>
    task.latestRun ? ['queued', 'running'].includes(task.latestRun.status) : false,
  )
  const attention = filteredTasks.filter((task) =>
    task.latestRun ? ['failed', 'interrupted', 'missed'].includes(task.latestRun.status) : false,
  )
  const claimed = new Set([...running, ...attention].map((task) => task.definition.id))
  const enabled = filteredTasks.filter(
    (task) => task.activation.enabled && !claimed.has(task.definition.id),
  )
  const paused = filteredTasks.filter(
    (task) => !task.activation.enabled && !claimed.has(task.definition.id),
  )
  return (
    <div className="scheduled-task-sidebar-list">
      {error && <div className="scheduled-task-inline-error">{error.message}</div>}
      <div className="scheduled-task-sidebar-tools">
        <input
          type="search"
          value={query}
          placeholder="搜索定时任务"
          aria-label="搜索定时任务"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={statusFilter}
          aria-label="筛选定时任务状态"
          onChange={(event) => setStatusFilter(event.target.value as 'all' | 'enabled' | 'paused')}
        >
          <option value="all">全部状态</option>
          <option value="enabled">已启用</option>
          <option value="paused">已暂停</option>
        </select>
      </div>
      <TaskGroup title="需要处理" tasks={attention} workspacePath={workspacePath} />
      <TaskGroup title="正在运行" tasks={running} workspacePath={workspacePath} />
      <TaskGroup title="已启用" tasks={enabled} workspacePath={workspacePath} />
      <TaskGroup title="已暂停" tasks={paused} workspacePath={workspacePath} />
      {filteredTasks.length === 0 && (
        <div className="scheduled-task-sidebar-message">没有符合条件的定时任务</div>
      )}
    </div>
  )
}

function TaskGroup({
  title,
  tasks,
  workspacePath,
}: {
  title: string
  tasks: ScheduledTaskSnapshot[]
  workspacePath: string
}): React.ReactElement | null {
  const openTab = useTabStore((state) => state.openTab)
  if (tasks.length === 0) return null
  return (
    <section className="scheduled-task-sidebar-group">
      <h3>{title}</h3>
      {tasks.map((task) => (
        <button
          type="button"
          className="scheduled-task-sidebar-item"
          key={task.definition.id}
          onClick={() => openTab(createScheduledTaskTab(workspacePath, task))}
        >
          <span
            className={`scheduled-task-state-dot ${task.activation.enabled ? 'enabled' : 'paused'}`}
          />
          <span className="scheduled-task-sidebar-copy">
            <strong>{task.definition.title}</strong>
            <span>{describeTaskRow(task)}</span>
          </span>
        </button>
      ))}
    </section>
  )
}

function describeTaskRow(task: ScheduledTaskSnapshot): string {
  const run = task.latestRun
  if (run?.status === 'queued' || run?.status === 'running') return run.currentStep
  if (run && ['failed', 'interrupted', 'missed'].includes(run.status)) {
    return run.error?.message ?? run.currentStep
  }
  return task.activation.enabled
    ? `下次：${formatNextRun(task.activation.nextRunAt)}`
    : '已在此设备暂停'
}
