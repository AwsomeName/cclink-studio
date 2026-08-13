import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ScheduledTaskResourceRef,
  ScheduledTaskSchedule,
  ScheduledTaskSnapshot,
  ScheduledTaskRun,
} from '@shared/scheduled-task/scheduled-task-types'
import type { Tab } from '../../types'
import { useTabStore } from '../../stores/tab-store'
import { IconClock } from '../../components/common/Icons'
import { scheduledTaskRunKey, useScheduledTaskStore } from './scheduled-task-store'
import { useEditorStore } from '../../stores/editor-store'
import { describeSchedule, formatNextRun } from './scheduled-task-view-model'
import { normalizeWorkspaceRelativePath } from './scheduled-task-paths'
import './scheduled-tasks.css'

interface TaskForm {
  title: string
  instruction: string
  scheduleKind: ScheduledTaskSchedule['kind']
  time: string
  onceAt: string
  weekdays: number[]
  timezone: string
  resourcePaths: string
  outputDirectory: string
  fileNameTemplate: string
}

const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
]

const EMPTY_TASKS: ScheduledTaskSnapshot[] = []

export function ScheduledTaskTab({ tab }: { tab: Tab }): React.ReactElement {
  const workspacePath = tab.workspaceRef?.kind === 'local' ? tab.workspaceRef.path : null
  const taskId = tab.scheduledTask?.taskId ?? null
  const tasks = useScheduledTaskStore((state) =>
    workspacePath ? (state.tasksByWorkspace[workspacePath] ?? EMPTY_TASKS) : EMPTY_TASKS,
  )
  const loading = useScheduledTaskStore((state) =>
    workspacePath ? Boolean(state.loadingByWorkspace[workspacePath]) : false,
  )
  const storeError = useScheduledTaskStore((state) =>
    workspacePath ? (state.errorByWorkspace[workspacePath] ?? null) : null,
  )
  const load = useScheduledTaskStore((state) => state.load)
  const save = useScheduledTaskStore((state) => state.save)
  const setEnabled = useScheduledTaskStore((state) => state.setEnabled)
  const loadRuns = useScheduledTaskStore((state) => state.loadRuns)
  const runNow = useScheduledTaskStore((state) => state.runNow)
  const cancelRun = useScheduledTaskStore((state) => state.cancelRun)
  const runs = useScheduledTaskStore((state) =>
    workspacePath && taskId
      ? (state.runsByTask[scheduledTaskRunKey(workspacePath, taskId)] ?? EMPTY_RUNS)
      : EMPTY_RUNS,
  )
  const updateTabTitle = useTabStore((state) => state.updateTabTitle)
  const updateTabDirty = useTabStore((state) => state.updateTabDirty)
  const updateTabScheduledTask = useTabStore((state) => state.updateTabScheduledTask)
  const task = tasks.find((candidate) => candidate.definition.id === taskId)
  const [form, setForm] = useState<TaskForm>(() => createDefaultForm())
  const [baseSignature, setBaseSignature] = useState(() => formSignature(createDefaultForm()))
  const [saving, setSaving] = useState(false)
  const [runningAction, setRunningAction] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const initializedFrom = useRef<string | null>(null)

  useEffect(() => {
    if (workspacePath) void load(workspacePath)
  }, [load, workspacePath])

  useEffect(() => {
    if (!workspacePath || !taskId) return
    void loadRuns(workspacePath, taskId)
    return window.cclinkStudio.scheduledTasks.onChanged((changedWorkspacePath) => {
      if (changedWorkspacePath !== workspacePath) return
      void load(workspacePath)
      void loadRuns(workspacePath, taskId)
    })
  }, [load, loadRuns, taskId, workspacePath])

  useEffect(() => {
    const sourceKey = task
      ? `${task.definition.id}:${task.definition.revision}`
      : taskId
        ? null
        : `draft:${tab.scheduledTask?.draftKey ?? tab.id}`
    if (!sourceKey || initializedFrom.current === sourceKey) return
    const next = task ? formFromTask(task) : createDefaultForm()
    setForm(next)
    setBaseSignature(formSignature(next))
    updateTabDirty(tab.id, false)
    initializedFrom.current = sourceKey
  }, [tab.id, tab.scheduledTask?.draftKey, task, taskId, updateTabDirty])

  const currentSignature = useMemo(() => formSignature(form), [form])
  useEffect(() => {
    if (!initializedFrom.current) return
    updateTabDirty(tab.id, currentSignature !== baseSignature)
  }, [baseSignature, currentSignature, tab.id, updateTabDirty])

  if (!workspacePath) {
    return <TaskUnavailable message="这个 Tab 没有绑定本地工作空间" />
  }
  if (taskId && loading && !task) {
    return <TaskUnavailable message="正在读取定时任务…" />
  }
  if (taskId && !task) {
    return (
      <TaskUnavailable
        message={storeError?.message ?? '定时任务不存在或已无法读取'}
        detail={storeError?.recovery}
      />
    )
  }

  const activation = task?.activation
  const hasUnsavedChanges = currentSignature !== baseSignature
  const activeRun = runs.find((run) => run.status === 'queued' || run.status === 'running')

  const handleSave = async (enable: boolean): Promise<void> => {
    setSaving(true)
    setActionError(null)
    try {
      const snapshot = await save({
        workspacePath,
        taskId: task?.definition.id,
        expectedRevision: task?.definition.revision,
        title: form.title,
        instruction: form.instruction,
        schedule: scheduleFromForm(form),
        resources: resourcesFromForm(form, workspacePath),
        outputPolicy: {
          directory: normalizeWorkspaceRelativePath(
            form.outputDirectory,
            workspacePath,
            '输出目录',
          ),
          fileNameTemplate: form.fileNameTemplate,
          mode: 'create-only',
        },
        enable,
      })
      const nextForm = formFromTask(snapshot)
      const nextSignature = formSignature(nextForm)
      setForm(nextForm)
      setBaseSignature(nextSignature)
      initializedFrom.current = `${snapshot.definition.id}:${snapshot.definition.revision}`
      updateTabScheduledTask(tab.id, {
        taskId: snapshot.definition.id,
        draftKey: snapshot.definition.id,
      })
      updateTabTitle(tab.id, snapshot.definition.title)
      updateTabDirty(tab.id, false)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = async (): Promise<void> => {
    if (!task) return
    setSaving(true)
    setActionError(null)
    try {
      await setEnabled(workspacePath, task.definition.id, !task.activation.enabled)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const handleRunNow = async (): Promise<void> => {
    if (!task) return
    setRunningAction(true)
    setActionError(null)
    try {
      await runNow(workspacePath, task.definition.id)
      await loadRuns(workspacePath, task.definition.id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunningAction(false)
    }
  }

  const handleCancelRun = async (): Promise<void> => {
    if (!activeRun) return
    setRunningAction(true)
    setActionError(null)
    try {
      await cancelRun(workspacePath, activeRun.id)
      if (task) await loadRuns(workspacePath, task.definition.id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setRunningAction(false)
    }
  }

  const handleOpenArtifact = async (run: ScheduledTaskRun): Promise<void> => {
    if (!run.artifact) return
    const separator = workspacePath.endsWith('/') ? '' : '/'
    const filePath = `${workspacePath}${separator}${run.artifact.relativePath}`
    useTabStore.getState().openTab({
      type: 'editor',
      title: run.artifact.relativePath.split('/').at(-1) ?? '定时任务产物.md',
      icon: '📄',
      workspaceRef: { kind: 'local', path: workspacePath },
      filePath,
    })
    await useEditorStore.getState().openFile(filePath)
  }

  return (
    <div className="scheduled-task-tab">
      <header className="scheduled-task-tab-header">
        <div className="scheduled-task-tab-heading">
          <IconClock size={24} />
          <div>
            <h1>{task?.definition.title ?? '新建定时任务'}</h1>
            <p>
              {activation?.enabled
                ? `已在此设备启用 · 下次 ${formatNextRun(activation.nextRunAt)}`
                : task
                  ? '已保存 · 此设备已暂停'
                  : '尚未保存 · 绑定当前工作空间'}
            </p>
          </div>
        </div>
        <div className="scheduled-task-tab-actions">
          {task && !activeRun && (
            <button
              type="button"
              disabled={saving || runningAction || hasUnsavedChanges}
              title={hasUnsavedChanges ? '请先保存修改' : undefined}
              onClick={() => void handleRunNow()}
            >
              立即运行
            </button>
          )}
          {activeRun && (
            <button type="button" disabled={runningAction} onClick={() => void handleCancelRun()}>
              取消运行
            </button>
          )}
          {task && (
            <button type="button" disabled={saving} onClick={() => void handleToggleEnabled()}>
              {task.activation.enabled ? '暂停' : '启用'}
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave(task?.activation.enabled ?? false)}
          >
            保存
          </button>
          {!activation?.enabled && (
            <button
              className="primary"
              type="button"
              disabled={saving}
              onClick={() => void handleSave(true)}
            >
              保存并在此设备启用
            </button>
          )}
        </div>
      </header>

      <div className="scheduled-task-stage-note">
        任务仅在 CCLink Studio 主进程存活时调度；完全退出后不会由系统唤醒，也不会留下 计划任务或后台
        Helper。
      </div>
      {actionError && <div className="scheduled-task-form-error">{actionError}</div>}

      <main className="scheduled-task-editor">
        <TaskSection title="任务">
          <label>
            <span>任务名称</span>
            <input
              value={form.title}
              maxLength={120}
              placeholder="例如：每周工作总结"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>
          <label>
            <span>任务内容</span>
            <textarea
              value={form.instruction}
              rows={7}
              placeholder="说明需要读取什么、整理什么，以及期望生成什么。"
              onChange={(event) => setForm({ ...form, instruction: event.target.value })}
            />
          </label>
        </TaskSection>

        <TaskSection title="执行时间">
          <div className="scheduled-task-form-grid">
            <label>
              <span>周期</span>
              <select
                value={form.scheduleKind}
                onChange={(event) =>
                  setForm({
                    ...form,
                    scheduleKind: event.target.value as ScheduledTaskSchedule['kind'],
                  })
                }
              >
                <option value="once">单次</option>
                <option value="daily">每天</option>
                <option value="weekdays">工作日</option>
                <option value="weekly">每周</option>
              </select>
            </label>
            {form.scheduleKind === 'once' ? (
              <label>
                <span>日期与时间</span>
                <input
                  type="datetime-local"
                  value={form.onceAt}
                  onChange={(event) => setForm({ ...form, onceAt: event.target.value })}
                />
              </label>
            ) : (
              <label>
                <span>执行时刻</span>
                <input
                  type="time"
                  value={form.time}
                  onChange={(event) => setForm({ ...form, time: event.target.value })}
                />
              </label>
            )}
            <label>
              <span>时区</span>
              <input
                value={form.timezone}
                onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              />
            </label>
          </div>
          {form.scheduleKind === 'weekly' && (
            <div className="scheduled-task-weekdays" aria-label="每周执行日">
              {WEEKDAYS.map((weekday) => (
                <label key={weekday.value}>
                  <input
                    type="checkbox"
                    checked={form.weekdays.includes(weekday.value)}
                    onChange={() =>
                      setForm({
                        ...form,
                        weekdays: form.weekdays.includes(weekday.value)
                          ? form.weekdays.filter((value) => value !== weekday.value)
                          : [...form.weekdays, weekday.value],
                      })
                    }
                  />
                  {weekday.label}
                </label>
              ))}
            </div>
          )}
          <p className="scheduled-task-summary">
            {describeSchedule(scheduleFromForm(form))} · {form.timezone}
          </p>
        </TaskSection>

        <TaskSection title="绑定资源">
          <label>
            <span>工作空间内路径（支持相对路径或绝对路径，每行一个，可留空）</span>
            <textarea
              value={form.resourcePaths}
              rows={4}
              placeholder={'docs/发布记录.md\nmaterials/'}
              onChange={(event) => setForm({ ...form, resourcePaths: event.target.value })}
            />
          </label>
          <p className="scheduled-task-help">当前工作空间始终绑定，不能切换为全局资源。</p>
        </TaskSection>

        <TaskSection title="输出">
          <div className="scheduled-task-form-grid">
            <label>
              <span>工作空间内目录</span>
              <input
                value={form.outputDirectory}
                placeholder="docs/周报"
                onChange={(event) => setForm({ ...form, outputDirectory: event.target.value })}
              />
            </label>
            <label>
              <span>文件名模板</span>
              <input
                value={form.fileNameTemplate}
                placeholder="report-{date}.md"
                onChange={(event) => setForm({ ...form, fileNameTemplate: event.target.value })}
              />
            </label>
          </div>
          <p className="scheduled-task-help">首版固定为 create-only，不覆盖已有文件。</p>
        </TaskSection>

        {task && (
          <TaskSection title="运行历史">
            {runs.length === 0 ? (
              <p className="scheduled-task-help">尚无运行记录。</p>
            ) : (
              <div className="scheduled-task-run-list">
                {runs.map((run) => (
                  <article className={`scheduled-task-run ${run.status}`} key={run.id}>
                    <div>
                      <strong>{formatRunStatus(run.status)}</strong>
                      <span>
                        {formatRunTrigger(run)} · revision {run.taskRevision} ·{' '}
                        {new Date(run.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p>{run.currentStep}</p>
                    {run.error && <p className="scheduled-task-run-error">{run.error.message}</p>}
                    {run.artifact && (
                      <button type="button" onClick={() => void handleOpenArtifact(run)}>
                        打开 {run.artifact.relativePath}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </TaskSection>
        )}
      </main>
    </div>
  )
}

const EMPTY_RUNS: ScheduledTaskRun[] = []

function formatRunStatus(status: ScheduledTaskRun['status']): string {
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

function formatRunTrigger(run: ScheduledTaskRun): string {
  if (run.trigger === 'manual') return '立即运行'
  if (run.trigger === 'catch-up') return '补执行'
  return '计划触发'
}

function TaskSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="scheduled-task-section">
      <h2>{title}</h2>
      <div className="scheduled-task-section-body">{children}</div>
    </section>
  )
}

function TaskUnavailable({
  message,
  detail,
}: {
  message: string
  detail?: string
}): React.ReactElement {
  return (
    <div className="scheduled-task-unavailable">
      <IconClock size={28} />
      <strong>{message}</strong>
      {detail && <span>{detail}</span>}
    </div>
  )
}

function createDefaultForm(): TaskForm {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const once = new Date(Date.now() + 60 * 60 * 1000)
  once.setSeconds(0, 0)
  return {
    title: '',
    instruction: '',
    scheduleKind: 'weekdays',
    time: '09:00',
    onceAt: toLocalDateTimeInput(once),
    weekdays: [1],
    timezone,
    resourcePaths: '',
    outputDirectory: 'docs/定时任务',
    fileNameTemplate: 'report-{date}.md',
  }
}

function formFromTask(task: ScheduledTaskSnapshot): TaskForm {
  const schedule = task.definition.schedule
  return {
    title: task.definition.title,
    instruction: task.definition.instruction,
    scheduleKind: schedule.kind,
    time: schedule.kind === 'once' ? '09:00' : schedule.time,
    onceAt:
      schedule.kind === 'once'
        ? toLocalDateTimeInput(new Date(schedule.runAt))
        : toLocalDateTimeInput(new Date(Date.now() + 60 * 60 * 1000)),
    weekdays: schedule.kind === 'weekly' ? schedule.weekdays : [1],
    timezone: schedule.timezone,
    resourcePaths: task.definition.resources
      .filter(
        (resource): resource is Extract<ScheduledTaskResourceRef, { path: string }> =>
          resource.kind !== 'workspace',
      )
      .map((resource) => resource.path)
      .join('\n'),
    outputDirectory: task.definition.outputPolicy.directory,
    fileNameTemplate: task.definition.outputPolicy.fileNameTemplate,
  }
}

function scheduleFromForm(form: TaskForm): ScheduledTaskSchedule {
  if (form.scheduleKind === 'once') {
    return {
      kind: 'once',
      runAt: new Date(form.onceAt).getTime(),
      timezone: form.timezone,
    }
  }
  if (form.scheduleKind === 'weekly') {
    return {
      kind: 'weekly',
      time: form.time,
      weekdays: form.weekdays,
      timezone: form.timezone,
    }
  }
  return { kind: form.scheduleKind, time: form.time, timezone: form.timezone }
}

function resourcesFromForm(form: TaskForm, workspacePath: string): ScheduledTaskResourceRef[] {
  const paths = form.resourcePaths
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => ({
      isDirectory: path.endsWith('/') || path.endsWith('\\'),
      path: normalizeWorkspaceRelativePath(path, workspacePath, '绑定资源'),
    }))
    .filter(({ path }) => path !== '.')
  return [
    { kind: 'workspace' },
    ...paths.map(
      ({ path, isDirectory }): ScheduledTaskResourceRef => ({
        kind: isDirectory ? 'directory' : 'file',
        path,
      }),
    ),
  ]
}

function formSignature(form: TaskForm): string {
  return JSON.stringify(form)
}

function toLocalDateTimeInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
