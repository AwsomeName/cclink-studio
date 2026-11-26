import { formatRunStatus } from './scheduled-task-view-model'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ScheduledTaskResourceRef,
  ScheduledTaskDefinitionSource,
  ScheduledTaskSchedule,
  ScheduledTaskSnapshot,
  ScheduledTaskRun,
} from '@shared/scheduled-task/scheduled-task-types'
import { calculateNextRunAt } from '@shared/scheduled-task/schedule-calculator'
import { renderScheduledTaskFileName } from '@shared/scheduled-task/scheduled-task-file-name'
import type { Tab } from '../../types'
import { useTabStore } from '../../stores/tab-store'
import { IconClock } from '../../components/common/Icons'
import { scheduledTaskRunKey, useScheduledTaskStore } from './scheduled-task-store'
import { useEditorStore } from '../../stores/editor-store'
import { useCommandStore } from '../../stores/command-store'
import { useToastStore } from '../../components/common/Toast'
import { copyTextToClipboard } from '../../utils/clipboard'
import { describeSchedule, formatNextRun } from './scheduled-task-view-model'
import { normalizeWorkspaceRelativePath } from './scheduled-task-paths'
import { registerScheduledTaskDraft } from './scheduled-task-draft-registry'
import {
  collectScheduledTaskRunDiagnosticReport,
  shouldOfferScheduledTaskRunLog,
} from './scheduled-task-run-diagnostic-report'
import { recordRendererDiagnosticLog } from '../diagnostics/renderer-diagnostic-log'
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
  resultMode: 'history' | 'workspace-file'
  outputDirectory: string
  fileNameTemplate: string
  failureTemplate: string
  definitionSource: ScheduledTaskDefinitionSource
}

const HISTORY_OUTPUT_DIRECTORY = '.cclink-studio/scheduled-task-results'
const HISTORY_FILE_NAME_TEMPLATE = 'task-{taskId}-{date}-{time}-{runId}.md'

const DAILY_LOG_TEMPLATE = `今日体重：
昨日睡眠：
昨日花销：
AI剩余额度：
昨日办公地点：
昨日运动：
昨日收入：

## 昨日总结

进度：

遗留问题：

## 今日待做

## 强调事项

长期目标：

07:00–23:00 生活作息：

## 今日打卡

示例：07:00｜事项｜详细说明（仅格式示例，非实际记录）
`

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
  const deleteTask = useScheduledTaskStore((state) => state.delete)
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
  const executeCommand = useCommandStore((state) => state.executeCommand)
  const showToast = useToastStore((state) => state.show)
  const task = tasks.find((candidate) => candidate.definition.id === taskId)
  const [form, setForm] = useState<TaskForm>(() => createDefaultForm())
  const baseSignatureRef = useRef(formSignature(form))
  const loadedRevisionRef = useRef<number | undefined>(undefined)
  const loadedDigestRef = useRef<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [runningAction, setRunningAction] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null)
  const [gitSharingHint, setGitSharingHint] = useState<string | null>(null)
  const [externalUpdatePending, setExternalUpdatePending] = useState(false)
  const initializedFrom = useRef<string | null>(null)
  const currentSignature = useMemo(() => formSignature(form), [form])
  const hasUnsavedChanges = currentSignature !== baseSignatureRef.current

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
    if (!workspacePath || !task || task.definition.source !== 'shared') {
      setGitSharingHint(null)
      return
    }
    let active = true
    void window.cclinkStudio.git.getSnapshot(workspacePath).then((snapshot) => {
      if (!active) return
      if (snapshot.availability !== 'available') return setGitSharingHint(null)
      const relativePath = `.cclink-studio/shared/scheduled-tasks/${task.definition.id}.json`
      const ignored = snapshot.ignoredSharedTaskDefinitions?.find(
        (candidate) => candidate.path === relativePath,
      )
      setGitSharingHint(ignored ? `该任务被 Git 忽略规则排除（${ignored.rule}），不会同步。` : null)
    })
    return () => {
      active = false
    }
  }, [task, workspacePath])

  useEffect(() => {
    const sourceKey = task
      ? `${task.definition.id}:${task.definition.revision}:${task.definition.executionDigest}`
      : taskId
        ? null
        : `draft:${tab.scheduledTask?.draftKey ?? tab.id}`
    if (!sourceKey || initializedFrom.current === sourceKey) return
    if (task && initializedFrom.current && hasUnsavedChanges) {
      setExternalUpdatePending(true)
      return
    }
    const next = task ? formFromTask(task) : createDefaultForm()
    setForm(next)
    baseSignatureRef.current = formSignature(next)
    updateTabDirty(tab.id, false)
    initializedFrom.current = sourceKey
    loadedRevisionRef.current = task?.definition.revision
    loadedDigestRef.current = task?.definition.executionDigest
    setExternalUpdatePending(false)
  }, [hasUnsavedChanges, tab.id, tab.scheduledTask?.draftKey, task, taskId, updateTabDirty])
  const fileNamePreview = useMemo(
    () => createFileNamePreview(form, task?.definition.id ?? 'task-id'),
    [form, task?.definition.id],
  )
  useEffect(() => {
    if (!initializedFrom.current) return
    updateTabDirty(tab.id, currentSignature !== baseSignatureRef.current)
  }, [currentSignature, tab.id, updateTabDirty])

  useEffect(() => {
    if (hasUnsavedChanges) setSaveFeedback(null)
  }, [hasUnsavedChanges])

  const handleSave = useCallback(
    async (enable: boolean): Promise<boolean> => {
      if (!workspacePath || saving) return false
      setSaving(true)
      setActionError(null)
      setSaveFeedback(null)
      try {
        if (
          form.definitionSource === 'shared' &&
          enable &&
          !task?.activation.enabled &&
          !confirmScheduledTaskAction(
            'save-and-enable',
            task?.definition.id,
            '在此设备启用这个任务？其他设备需各自启用。',
          )
        ) {
          return false
        }
        const snapshot = await save({
          workspacePath,
          taskId: task?.definition.id,
          expectedRevision: task ? loadedRevisionRef.current : undefined,
          expectedExecutionDigest: task ? loadedDigestRef.current : undefined,
          title: form.title,
          instruction: form.instruction,
          schedule: scheduleFromForm(form),
          resources: resourcesFromForm(form, workspacePath),
          outputPolicy: outputPolicyFromForm(form, workspacePath),
          definitionSource: form.definitionSource,
          enable,
        })
        const nextForm = formFromTask(snapshot)
        const nextSignature = formSignature(nextForm)
        baseSignatureRef.current = nextSignature
        setForm(nextForm)
        initializedFrom.current = `${snapshot.definition.id}:${snapshot.definition.revision}:${snapshot.definition.executionDigest}`
        loadedRevisionRef.current = snapshot.definition.revision
        loadedDigestRef.current = snapshot.definition.executionDigest
        setExternalUpdatePending(false)
        updateTabScheduledTask(tab.id, {
          taskId: snapshot.definition.id,
          draftKey: snapshot.definition.id,
        })
        updateTabTitle(tab.id, snapshot.definition.title)
        updateTabDirty(tab.id, false)
        setSaveFeedback(snapshot.activation.enabled ? '已保存并启用' : '已保存 · 已暂停')
        await load(workspacePath)
        return true
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setSaving(false)
      }
    },
    [
      form,
      load,
      save,
      saving,
      tab.id,
      task,
      updateTabDirty,
      updateTabScheduledTask,
      updateTabTitle,
      workspacePath,
    ],
  )

  useEffect(() => {
    if (!workspacePath || (taskId && !task)) return
    return registerScheduledTaskDraft(tab.id, {
      save: () => handleSave(draftSaveKeepsEnabled(task)),
    })
  }, [handleSave, tab.id, task, taskId, workspacePath])

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
  const sharedNeedsConfirmation = Boolean(
    task && task.definition.source === 'shared' && !task.activation.enabled,
  )
  const activeRun = runs.find((run) => run.status === 'queued' || run.status === 'running')

  const handleToggleEnabled = async (): Promise<void> => {
    if (!task) return
    if (
      task.definition.source === 'shared' &&
      !task.activation.enabled &&
      !confirmScheduledTaskAction(
        'enable-on-device',
        task.definition.id,
        `在此设备启用“${task.definition.title}”？`,
      )
    ) {
      return
    }
    setSaving(true)
    setActionError(null)
    setSaveFeedback(null)
    try {
      const snapshot = await setEnabled(workspacePath, task.definition.id, !task.activation.enabled)
      setSaveFeedback(snapshot.activation.enabled ? '已启用' : '已暂停')
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

  const handleDelete = async (): Promise<void> => {
    if (!task) return
    const sharedWarning = task.definition.source === 'shared' ? '同步后其他设备也会删除。' : ''
    if (
      !confirmScheduledTaskAction(
        'delete',
        task.definition.id,
        `删除“${task.definition.title}”？${sharedWarning}运行历史会保留。`,
      )
    ) {
      return
    }
    setSaving(true)
    setActionError(null)
    try {
      await deleteTask(workspacePath, task.definition.id, task.definition.revision)
      useTabStore.getState().closeTab(tab.id)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
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

  const handleCopyRunLog = async (run: ScheduledTaskRun): Promise<void> => {
    if (!task) return
    try {
      const report = await collectScheduledTaskRunDiagnosticReport(task, run)
      await copyTextToClipboard(report)
      showToast('定时任务运行日志已复制', 'success')
    } catch (error) {
      showToast(
        `复制定时任务运行日志失败：${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
    }
  }

  return (
    <div className="scheduled-task-tab">
      <header className="scheduled-task-tab-header">
        <div className="scheduled-task-tab-heading">
          <IconClock size={24} />
          <div>
            <h1>{task?.definition.title ?? '新建定时任务'}</h1>
            <p>
              <span
                className="scheduled-task-save-status"
                data-tone={
                  actionError
                    ? 'error'
                    : saving
                      ? 'working'
                      : hasUnsavedChanges
                        ? 'dirty'
                        : activation?.enabled
                          ? 'enabled'
                          : task
                            ? 'paused'
                            : 'draft'
                }
                role="status"
                aria-live="polite"
              >
                {actionError
                  ? `操作失败：${actionError}`
                  : saving
                    ? '正在保存…'
                    : hasUnsavedChanges
                      ? task
                        ? '有未保存修改'
                        : '尚未保存'
                      : activation?.enabled
                        ? `${saveFeedback ?? '已启用'} · 下次 ${formatNextRun(activation.nextRunAt)}`
                        : task
                          ? (saveFeedback ?? '已暂停')
                          : '尚未保存'}
              </span>
            </p>
          </div>
        </div>
        <div className="scheduled-task-tab-actions">
          {task && !activeRun && (
            <button
              type="button"
              disabled={saving || runningAction || hasUnsavedChanges || sharedNeedsConfirmation}
              title={
                hasUnsavedChanges
                  ? '请先保存修改'
                  : sharedNeedsConfirmation
                    ? '请先启用'
                    : undefined
              }
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
              {task.activation.enabled
                ? '暂停'
                : task.definition.source === 'shared'
                  ? '在此设备启用'
                  : '启用'}
            </button>
          )}
          {task && (
            <button
              type="button"
              disabled={saving || runningAction}
              onClick={() => void handleDelete()}
            >
              删除
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => void executeCommand('workbench.save', { source: 'toolbar' })}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {!activation?.enabled && (
            <button
              className="primary"
              type="button"
              disabled={saving}
              onClick={() => void handleSave(true)}
            >
              {saving ? '保存中…' : '保存并启用'}
            </button>
          )}
        </div>
      </header>

      {actionError && <div className="scheduled-task-form-error">{actionError}</div>}
      {task && <SharedTaskActivationNote task={task} />}
      {gitSharingHint && <div className="scheduled-task-git-note">{gitSharingHint}</div>}
      {externalUpdatePending && task && (
        <div className="scheduled-task-confirmation-note">
          <strong>任务已在别处更新</strong>
          <span>你的修改未保存，需要先载入新版本。</span>
          <button
            type="button"
            onClick={() => {
              const next = formFromTask(task)
              setForm(next)
              baseSignatureRef.current = formSignature(next)
              initializedFrom.current = `${task.definition.id}:${task.definition.revision}:${task.definition.executionDigest}`
              loadedRevisionRef.current = task.definition.revision
              loadedDigestRef.current = task.definition.executionDigest
              setExternalUpdatePending(false)
              updateTabDirty(tab.id, false)
            }}
          >
            载入新版本
          </button>
        </div>
      )}

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

        <TaskSection title="共享范围">
          <div className="scheduled-task-source-options">
            <label>
              <input
                type="radio"
                name={`scheduled-task-source-${tab.id}`}
                checked={form.definitionSource === 'local'}
                onChange={() => {
                  if (
                    task?.definition.source !== 'shared' ||
                    confirmScheduledTaskAction(
                      'switch-to-local',
                      task?.definition.id,
                      '改为仅本机后，其他设备同步后将不再有这个任务。继续吗？',
                    )
                  ) {
                    setForm({ ...form, definitionSource: 'local' })
                  }
                }}
              />
              <span>
                <strong>仅本机</strong>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name={`scheduled-task-source-${tab.id}`}
                checked={form.definitionSource === 'shared'}
                onChange={() => {
                  if (
                    confirmScheduledTaskAction(
                      'switch-to-shared',
                      task?.definition.id,
                      '任务内容会随项目同步到其他设备，请勿写入密码或 Token。继续吗？',
                    )
                  ) {
                    setForm({ ...form, definitionSource: 'shared' })
                  }
                }}
              />
              <span>
                <strong>随项目共享</strong>
                <small>其他设备需各自启用</small>
              </span>
            </label>
          </div>
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
                <option value="monthly">每月最后一天</option>
                <option value="yearly">每年 12 月 31 日</option>
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
            {describeSchedule(scheduleFromForm(form))} · {form.timezone} · Studio 运行时执行
          </p>
        </TaskSection>

        <TaskSection title="额外读取">
          <label>
            <span>文件或目录，每行一个（可留空）</span>
            <textarea
              value={form.resourcePaths}
              rows={4}
              placeholder={'docs/发布记录.md\nmaterials/'}
              onChange={(event) => setForm({ ...form, resourcePaths: event.target.value })}
            />
          </label>
        </TaskSection>

        <TaskSection title="运行结果">
          <label>
            <span>结果保存到</span>
            <select
              value={form.resultMode}
              onChange={(event) =>
                setForm({
                  ...form,
                  resultMode: event.target.value as TaskForm['resultMode'],
                })
              }
            >
              <option value="history">运行历史</option>
              <option value="workspace-file">Markdown 文件</option>
            </select>
          </label>
          {form.resultMode === 'workspace-file' && (
            <>
              <div className="scheduled-task-form-grid scheduled-task-output-grid">
                <label>
                  <span>目录</span>
                  <input
                    value={form.outputDirectory}
                    placeholder="docs/周报"
                    onChange={(event) => setForm({ ...form, outputDirectory: event.target.value })}
                  />
                </label>
                <label>
                  <span>文件名</span>
                  <input
                    value={form.fileNameTemplate}
                    placeholder="report-{date}.md"
                    onChange={(event) => setForm({ ...form, fileNameTemplate: event.target.value })}
                  />
                </label>
              </div>
              <p className="scheduled-task-help">
                {fileNamePreview ? (
                  <>
                    下次生成 <code>{fileNamePreview}</code> ·{' '}
                  </>
                ) : null}
                不覆盖已有文件
              </p>
            </>
          )}
        </TaskSection>

        <TaskSection title="AI 失败时">
          <label>
            <span>改为写入此模板（可选）</span>
            <textarea
              value={form.failureTemplate}
              rows={10}
              maxLength={32_000}
              placeholder="未配置时，AI 失败不会创建文件。"
              onChange={(event) => setForm({ ...form, failureTemplate: event.target.value })}
            />
          </label>
          <button
            type="button"
            onClick={() => setForm({ ...form, failureTemplate: DAILY_LOG_TEMPLATE })}
          >
            填入每日日志模板
          </button>
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
                        {formatRunTrigger(run)} · {new Date(run.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p>{run.currentStep}</p>
                    {run.error && <p className="scheduled-task-run-error">{run.error.message}</p>}
                    {run.error?.recovery && (
                      <p className="scheduled-task-run-error">建议：{run.error.recovery}</p>
                    )}
                    <ScheduledTaskRunActions
                      run={run}
                      onCopyLog={handleCopyRunLog}
                      onOpenArtifact={handleOpenArtifact}
                    />
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

/** A person needs well over half a second to read and answer a native confirm dialog. */
const UNSEEN_CONFIRM_THRESHOLD_MS = 500

/**
 * Runs a native confirm and records the outcome to the framework log, so a dialog that something
 * dismissed before it was ever shown (e.g. CDP automation) is visible in diagnostics instead of
 * looking like a button that does nothing. Logs the action and task id prefix only, never content.
 */
export function confirmScheduledTaskAction(
  action: string,
  taskId: string | undefined,
  message: string,
  confirm: (message: string) => boolean = (text) => window.confirm(text),
  now: () => number = () => performance.now(),
): boolean {
  const startedAt = now()
  const confirmed = confirm(message)
  const elapsedMs = Math.round(now() - startedAt)
  const suspectedUnseen = !confirmed && elapsedMs < UNSEEN_CONFIRM_THRESHOLD_MS
  recordRendererDiagnosticLog(suspectedUnseen ? 'warn' : 'info', [
    suspectedUnseen ? '[ScheduledTask] 确认框疑似未显示就被取消' : '[ScheduledTask] 确认框已作答',
    { action, taskId: taskId?.slice(0, 8) ?? null, confirmed, elapsedMs },
  ])
  return confirmed
}

/**
 * Plain save (toolbar / Cmd+S) keeps this device's activation as it is. Saving an enabled shared
 * task here re-binds the confirmation to the version this device just wrote; only definitions
 * changed elsewhere need a fresh confirmation.
 */
export function draftSaveKeepsEnabled(task: ScheduledTaskSnapshot | undefined): boolean {
  return task?.activation.enabled ?? false
}

const sharedSuspensionMessages: Record<
  NonNullable<ScheduledTaskSnapshot['activation']['suspensionReason']>,
  string
> = {
  'definition-changed':
    '任务内容在别处被修改（其他设备同步或直接改了任务文件），本机已暂停。检查新内容后点“在此设备启用”。',
  'definition-removed': '任务定义已从项目删除，本机启用已失效。',
  'definition-conflict': '任务定义存在冲突，本机已暂停。解决冲突后再点“在此设备启用”。',
  'migration-conflict': '任务迁移存在冲突，本机已暂停。解决冲突后再点“在此设备启用”。',
}

export function SharedTaskActivationNote({
  task,
}: {
  task: ScheduledTaskSnapshot
}): React.ReactElement | null {
  if (task.definition.source !== 'shared' || task.activation.enabled) return null
  const reason = task.activation.suspensionReason
  return (
    <div className="scheduled-task-confirmation-note">
      <strong>{reason ? '本机已暂停' : '本机未启用'}</strong>
      <span>
        {reason
          ? sharedSuspensionMessages[reason]
          : '随项目共享的任务需在每台设备分别启用，检查内容后点“在此设备启用”。'}
      </span>
    </div>
  )
}

export function ScheduledTaskRunActions({
  run,
  onCopyLog,
  onOpenArtifact,
}: {
  run: ScheduledTaskRun
  onCopyLog: (run: ScheduledTaskRun) => Promise<void>
  onOpenArtifact: (run: ScheduledTaskRun) => Promise<void>
}): React.ReactElement | null {
  if (!shouldOfferScheduledTaskRunLog(run) && !run.artifact) return null
  return (
    <div className="scheduled-task-run-actions">
      {shouldOfferScheduledTaskRunLog(run) && (
        <button type="button" onClick={() => void onCopyLog(run)}>
          复制日志
        </button>
      )}
      {run.artifact && (
        <button type="button" onClick={() => void onOpenArtifact(run)}>
          {isHistoryResultPath(run.artifact.relativePath)
            ? '查看运行结果'
            : `打开 ${run.artifact.relativePath}`}
        </button>
      )}
    </div>
  )
}

const EMPTY_RUNS: ScheduledTaskRun[] = []

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
    resultMode: 'history',
    outputDirectory: 'docs/定时任务',
    fileNameTemplate: 'report-{date}.md',
    failureTemplate: '',
    definitionSource: 'local',
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
    resultMode: isHistoryOutputPolicy(task.definition.outputPolicy) ? 'history' : 'workspace-file',
    outputDirectory: task.definition.outputPolicy.directory,
    fileNameTemplate: task.definition.outputPolicy.fileNameTemplate,
    failureTemplate: task.definition.outputPolicy.failureTemplate ?? '',
    definitionSource: task.definition.source,
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

function outputPolicyFromForm(
  form: TaskForm,
  workspacePath: string,
): ScheduledTaskSnapshot['definition']['outputPolicy'] {
  if (form.resultMode === 'history') {
    return {
      directory: HISTORY_OUTPUT_DIRECTORY,
      fileNameTemplate: HISTORY_FILE_NAME_TEMPLATE,
      mode: 'create-only',
      ...(form.failureTemplate.trim() ? { failureTemplate: form.failureTemplate } : {}),
    }
  }
  return {
    directory: normalizeWorkspaceRelativePath(form.outputDirectory, workspacePath, '输出目录'),
    fileNameTemplate: form.fileNameTemplate,
    mode: 'create-only',
    ...(form.failureTemplate.trim() ? { failureTemplate: form.failureTemplate } : {}),
  }
}

function createFileNamePreview(form: TaskForm, taskId: string): string | null {
  if (form.resultMode !== 'workspace-file' || !form.fileNameTemplate.trim()) return null
  try {
    const schedule = scheduleFromForm(form)
    const nextRunAt = calculateNextRunAt(schedule)
    const timestamp =
      nextRunAt ??
      (schedule.kind === 'once' && Number.isFinite(schedule.runAt) ? schedule.runAt : Date.now())
    return renderScheduledTaskFileName({
      template: form.fileNameTemplate,
      timestamp,
      timezone: schedule.timezone,
      taskId,
      runId: 'run-id',
    })
  } catch {
    return null
  }
}

function isHistoryOutputPolicy(
  policy: ScheduledTaskSnapshot['definition']['outputPolicy'],
): boolean {
  return (
    policy.directory === HISTORY_OUTPUT_DIRECTORY &&
    policy.fileNameTemplate === HISTORY_FILE_NAME_TEMPLATE
  )
}

function isHistoryResultPath(relativePath: string): boolean {
  return relativePath.startsWith(`${HISTORY_OUTPUT_DIRECTORY}/`)
}

function formSignature(form: TaskForm): string {
  return JSON.stringify(form)
}

function toLocalDateTimeInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
