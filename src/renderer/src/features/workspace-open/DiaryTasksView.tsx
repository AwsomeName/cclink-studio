import { useState } from 'react'
import type { FsDirEntry } from '@shared/ipc/fs'
import type { ScheduledTaskSnapshot } from '@shared/scheduled-task/scheduled-task-types'
import { describeSchedule } from '../scheduled-tasks/scheduled-task-view-model'
import { getWorkspaceStateOwnerKey } from '../../utils/workspace-state'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import {
  defaultBuiltInChoice,
  ensureBuiltInDiaryTasks,
  isDailyDraftTask,
  isWeeklyReviewTask,
} from './diary-builtin-tasks'

const runLabel: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '中断',
  missed: '错过',
  skipped: '跳过',
}

/** Tasks worth bringing over from an earlier project: diary drafts, reviews and plans. */
const diaryLike = (task: ScheduledTaskSnapshot): boolean =>
  isDailyDraftTask(task.definition) ||
  isWeeklyReviewTask(task.definition) ||
  /日记|简报|周计划|复盘|总结|计划/.test(task.definition.title)

/** Same name and cadence, or the same job: two daily drafts or two weekly reviews. */
const sameTask = (a: ScheduledTaskSnapshot, b: ScheduledTaskSnapshot): boolean =>
  (a.definition.title.trim() === b.definition.title.trim() &&
    a.definition.schedule.kind === b.definition.schedule.kind) ||
  (isDailyDraftTask(a.definition) && isDailyDraftTask(b.definition)) ||
  (isWeeklyReviewTask(a.definition) &&
    isWeeklyReviewTask(b.definition) &&
    a.definition.outputPolicy.directory === b.definition.outputPolicy.directory)

function nextInZone(value: number | null, timezone: string): string {
  if (value === null) return '未安排'
  const text = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
  return timezone === Intl.DateTimeFormat().resolvedOptions().timeZone
    ? text
    : `${text}（${timezone}）`
}

const enabledHere = (task: ScheduledTaskSnapshot): boolean =>
  task.activation.enabled &&
  (task.definition.source === 'local' ||
    task.activation.confirmedExecutionDigest === task.definition.executionDigest)

/**
 * 定时整理: this project's tasks only. Importing from an earlier project is one click; whatever
 * is found is copied here (disabled on this device), whatever already exists is skipped.
 */
export function DiaryTasksView({
  workspacePath,
  directory,
  timezone,
  tasks,
  onChanged,
  openTask,
  openFile,
}: {
  workspacePath: string
  directory: string
  timezone: string
  tasks: ScheduledTaskSnapshot[]
  onChanged: () => void
  openTask: (task: ScheduledTaskSnapshot) => void
  openFile: (file: Pick<FsDirEntry, 'path' | 'name'>) => void
}): React.ReactElement {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const api = window.cclinkStudio.scheduledTasks
  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setError('')
    setNotice('')
    void action()
      .catch((e) => setError(String(e).replace(/^Error: /, '')))
      .finally(() => {
        setBusy(false)
        onChanged()
      })
  }

  const importFromEarlierProjects = async (): Promise<void> => {
    // Every local project this device knows: registered (either owner scope), open or recent.
    const ws = window.cclinkStudio.workspaceState
    const registered = [
      ...(await ws.listLocalWorkspaces().catch(() => [])),
      ...(await ws.listLocalWorkspaces(getWorkspaceStateOwnerKey()).catch(() => [])),
    ].map((item) => item.workspacePath)
    const strip = useOpenProjectsStore.getState()
    const recent = strip.recentWorkspaceRefs.flatMap((ref) =>
      ref.kind === 'local' ? [ref.path] : [],
    )
    const projects = [...new Set([...registered, ...strip.openProjectPaths, ...recent])]
      .filter((path) => path !== workspacePath)
      .map((workspacePath) => ({ workspacePath }))
    const here = [...tasks]
    const imported: string[] = []
    let skipped = 0
    for (const project of projects) {
      const found = await api.inspect(project.workspacePath).catch(() => null)
      if (!found?.success) continue
      const fresh = found.tasks.filter((task) => {
        if (!diaryLike(task)) return false
        const exists = here.some(
          (mine) => mine.definition.id === task.definition.id || sameTask(mine, task),
        )
        if (exists) skipped++
        return !exists
      })
      if (!fresh.length) continue
      const bundle = await api.exportBundle(
        project.workspacePath,
        fresh.map((task) => task.definition.id),
      )
      if (!bundle.success || !bundle.bundle) continue
      const result = await api.importBundle(workspacePath, bundle.bundle)
      if (!result.success) throw Error(result.error?.message || '导入失败')
      imported.push(...fresh.map((task) => task.definition.title))
      here.push(...fresh)
    }
    setNotice(
      imported.length
        ? `已导入 ${imported.length} 个：${imported.join('、')}。在这台电脑默认未启用，点开任务检查后启用。` +
            (skipped ? `另有 ${skipped} 个已存在，已跳过。` : '')
        : skipped
          ? '原项目的定时任务已经都在这里了。'
          : '其他项目里没有找到日记相关的定时任务。',
    )
  }

  // Same name and cadence twice (e.g. a local copy and one brought by Git) is one task too many.
  const duplicates = tasks.filter((task, index) =>
    tasks.some((other, j) => j < index && sameTask(other, task)),
  )
  const cleanDuplicates = async (): Promise<void> => {
    const groups: ScheduledTaskSnapshot[][] = []
    for (const task of tasks) {
      const group = groups.find((items) => items.some((item) => sameTask(item, task)))
      if (group) group.push(task)
      else groups.push([task])
    }
    const remove: ScheduledTaskSnapshot[] = []
    for (const group of groups) {
      if (group.length < 2) continue
      // Keep the one that runs on this device, else the most recently updated.
      const keep =
        group.find(enabledHere) ??
        [...group].sort((a, b) => b.definition.updatedAt - a.definition.updatedAt)[0]
      remove.push(...group.filter((task) => task !== keep))
    }
    if (
      !window.confirm(
        `将删除 ${remove.length} 个重复任务：\n${remove
          .map(
            (task) =>
              `· ${task.definition.title}（${describeSchedule(task.definition.schedule)}，${task.definition.source === 'shared' ? '随项目共享' : '本机'}）`,
          )
          .join(
            '\n',
          )}\n每组保留在这台电脑已启用、或最近更新的一份。删除共享任务会在 Git 中形成删除变更。继续吗？`,
      )
    )
      return
    for (const task of remove) {
      const result = await api.delete({
        workspacePath,
        taskId: task.definition.id,
        expectedRevision: task.definition.revision,
      })
      if (!result.success) throw Error(result.error?.message || '删除失败')
    }
    setNotice(`已删除 ${remove.length} 个重复任务。`)
  }

  const hasDaily = tasks.some((task) => isDailyDraftTask(task.definition))
  const hasWeekly = tasks.some((task) => isWeeklyReviewTask(task.definition))
  return (
    <div className="diary-tasks">
      <div className="diary-actions">
        <button disabled={busy} onClick={() => run(importFromEarlierProjects)}>
          {busy ? '正在处理…' : '导入原项目的定时任务'}
        </button>
        {(!hasDaily || !hasWeekly) && (
          <button
            disabled={busy}
            onClick={() =>
              run(() =>
                ensureBuiltInDiaryTasks(workspacePath, directory, timezone, defaultBuiltInChoice),
              )
            }
          >
            {tasks.length ? '补齐每日起草与周期计划' : '创建每日起草与周期计划'}
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {duplicates.length > 0 && (
        <div className="diary-card" role="status">
          <b>
            有重复任务：{[...new Set(duplicates.map((task) => task.definition.title))].join('、')}
          </b>
          <p className="muted">同名、同周期的任务出现了不止一份，可能同时运行并产生重复内容。</p>
          <button disabled={busy} onClick={() => run(cleanDuplicates)}>
            清理重复
          </button>
        </div>
      )}
      {!tasks.length && <p className="muted">还没有定时整理任务。</p>}
      {tasks.map((task) => (
        <button
          className="workspace-home-record diary-task-row"
          key={task.definition.id}
          onClick={() => openTask(task)}
          title="打开任务，查看内容、运行历史和产物"
        >
          <span>
            <b>{task.definition.title}</b>
            {task.definition.source === 'local' && <span className="diary-tag">仅本机</span>}
          </span>
          <span>
            {describeSchedule(task.definition.schedule)} ·{' '}
            {enabledHere(task)
              ? `已启用 · 下次 ${nextInZone(task.activation.nextRunAt, task.definition.schedule.timezone)}`
              : task.activation.enabled
                ? '内容已更新，待重新确认'
                : '未启用'}
          </span>
        </button>
      ))}
      {tasks.some((task) => task.latestRun) && <h3>最近运行</h3>}
      {tasks
        .filter((task) => task.latestRun)
        .sort((a, b) => b.latestRun!.createdAt - a.latestRun!.createdAt)
        .map((task) => {
          const latest = task.latestRun!
          return (
            <div className="workspace-home-record" key={latest.id}>
              <span>
                {task.definition.title} · {runLabel[latest.status] ?? latest.status}
                {latest.status === 'skipped' || latest.status === 'missed'
                  ? ` · ${latest.currentStep}`
                  : ''}
                {latest.status === 'failed' && latest.error ? ` · ${latest.error.message}` : ''}
              </span>
              {latest.artifact && (
                <button
                  onClick={() =>
                    openFile({
                      name: latest.artifact!.relativePath.split('/').pop()!,
                      path: `${workspacePath}/${latest.artifact!.relativePath}`,
                    })
                  }
                >
                  打开 {latest.artifact.relativePath.split('/').pop()}
                </button>
              )}
            </div>
          )
        })}
    </div>
  )
}
