import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ScheduledTaskDefinitionIssue,
  ScheduledTaskSnapshot,
} from '@shared/scheduled-task/scheduled-task-types'
import { useTabStore } from '../../stores/tab-store'
import { IconClock, IconPlus, IconRefresh } from '../../components/common/Icons'
import { useToastStore } from '../../components/common/Toast'
import { scheduledTaskRunKey, useScheduledTaskStore } from './scheduled-task-store'
import { createScheduledTaskTab, formatNextRun } from './scheduled-task-view-model'
import './scheduled-tasks.css'

const EMPTY_TASKS: ScheduledTaskSnapshot[] = []
const EMPTY_ISSUES: ScheduledTaskDefinitionIssue[] = []

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
  const issues = useScheduledTaskStore((state) =>
    workspacePath ? (state.issuesByWorkspace[workspacePath] ?? EMPTY_ISSUES) : EMPTY_ISSUES,
  )
  const load = useScheduledTaskStore((state) => state.load)
  const runNow = useScheduledTaskStore((state) => state.runNow)
  const showToast = useToastStore((state) => state.show)
  // Keep request guards above the groups: a task moves groups when its run starts.
  const pendingRuns = useRef(new Set<string>())
  const [startingTaskKeys, setStartingTaskKeys] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'paused'>('all')

  useEffect(() => {
    if (workspacePath) void load(workspacePath)
  }, [load, workspacePath])

  useEffect(() => {
    if (!workspacePath) return
    const refreshOnFocus = (): void => void load(workspacePath)
    window.addEventListener('focus', refreshOnFocus)
    return () => window.removeEventListener('focus', refreshOnFocus)
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
  const handleRunNow = async (task: ScheduledTaskSnapshot): Promise<void> => {
    const key = scheduledTaskRunKey(workspacePath, task.definition.id)
    if (pendingRuns.current.has(key) || isTaskRunning(task)) return
    pendingRuns.current.add(key)
    setStartingTaskKeys(new Set(pendingRuns.current))
    try {
      await runNow(workspacePath, task.definition.id)
      // Keep the button disabled until the sidebar has refreshed the main-process facts.
      await load(workspacePath)
    } catch (error) {
      showToast(
        `“${task.definition.title}”启动失败：${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
    } finally {
      pendingRuns.current.delete(key)
      setStartingTaskKeys(new Set(pendingRuns.current))
    }
  }

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

  const running = filteredTasks.filter(isTaskRunning)
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
      {issues.map((issue) => (
        <div className="scheduled-task-inline-error" key={`${issue.relativePath}:${issue.kind}`}>
          {issue.message}：{issue.relativePath}
        </div>
      ))}
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
      {[
        { title: '需要处理', tasks: attention },
        { title: '正在运行', tasks: running },
        { title: '已启用', tasks: enabled },
        { title: '已暂停', tasks: paused },
      ].map((group) => (
        <TaskGroup
          key={group.title}
          {...group}
          workspacePath={workspacePath}
          startingTaskKeys={startingTaskKeys}
          onRun={handleRunNow}
        />
      ))}
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
  startingTaskKeys,
  onRun,
}: {
  title: string
  tasks: ScheduledTaskSnapshot[]
  workspacePath: string
  startingTaskKeys: ReadonlySet<string>
  onRun: (task: ScheduledTaskSnapshot) => Promise<void>
}): React.ReactElement | null {
  if (tasks.length === 0) return null
  return (
    <section className="scheduled-task-sidebar-group">
      <h3>{title}</h3>
      {tasks.map((task) => (
        <TaskRow
          key={task.definition.id}
          task={task}
          workspacePath={workspacePath}
          starting={startingTaskKeys.has(scheduledTaskRunKey(workspacePath, task.definition.id))}
          onRun={onRun}
        />
      ))}
    </section>
  )
}

function TaskRow({
  task,
  workspacePath,
  starting,
  onRun,
}: {
  task: ScheduledTaskSnapshot
  workspacePath: string
  starting: boolean
  onRun: (task: ScheduledTaskSnapshot) => Promise<void>
}): React.ReactElement {
  const openTab = useTabStore((state) => state.openTab)
  const hasUnsavedChanges = useTabStore((state) =>
    state.tabs.some(
      (tab) =>
        tab.type === 'scheduled-task' &&
        tab.workspaceRef?.kind === 'local' &&
        tab.workspaceRef.path === workspacePath &&
        tab.scheduledTask?.taskId === task.definition.id &&
        tab.dirty,
    ),
  )
  const running = isTaskRunning(task)
  const sharedNeedsConfirmation = task.definition.source === 'shared' && !task.activation.enabled
  const label = running
    ? task.latestRun?.status === 'queued'
      ? '排队中'
      : '运行中'
    : starting
      ? '启动中'
      : '立即运行'
  const disabledReason = running
    ? '任务已排队或正在运行，请等待本次运行结束'
    : starting
      ? '正在提交运行请求'
      : hasUnsavedChanges
        ? '请先保存修改'
        : sharedNeedsConfirmation
          ? '请先检查内容并在此设备启用'
          : null
  return (
    <div className="scheduled-task-sidebar-row">
      <button
        type="button"
        className="scheduled-task-sidebar-item"
        title={task.definition.title}
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
      <button
        type="button"
        className="scheduled-task-sidebar-run"
        disabled={disabledReason !== null}
        title={disabledReason ?? '立即运行已保存的任务'}
        aria-label={`${label}：${task.definition.title}`}
        onClick={() => {
          if (!disabledReason) void onRun(task)
        }}
      >
        {running || starting ? (
          <IconRefresh size={12} className="scheduled-task-sidebar-run-spinner" />
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 2.5 12.5 8 4 13.5Z" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        )}
        <span>{label}</span>
      </button>
    </div>
  )
}

function isTaskRunning(task: ScheduledTaskSnapshot): boolean {
  return task.latestRun?.status === 'queued' || task.latestRun?.status === 'running'
}

function describeTaskRow(task: ScheduledTaskSnapshot): string {
  const run = task.latestRun
  if (run?.status === 'queued' || run?.status === 'running') return run.currentStep
  if (run && ['failed', 'interrupted', 'missed'].includes(run.status)) {
    return run.error?.message ?? run.currentStep
  }
  if (task.activation.enabled) return `下次：${formatNextRun(task.activation.nextRunAt)}`
  if (task.definition.source === 'shared' && task.activation.suspensionReason) {
    return '来自项目 · 内容已变化，等待重新确认'
  }
  if (task.definition.source === 'shared') return '来自项目 · 等待在此设备确认'
  return '仅本机 · 已在此设备暂停'
}
