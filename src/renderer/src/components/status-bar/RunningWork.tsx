import { useEffect, useRef, useState } from 'react'
import { FloatingSurface } from '../common/FloatingSurface'
import { useAgentStore } from '../../stores/agent-store'
import { useTabStore } from '../../stores/tab-store'
import { openWorkspaceRef } from '../../features/workspace-open/workspace-open-controller'
import { openConversationInWorkbench } from '../../features/agent-conversations/conversation-workbench'
import { createScheduledTaskTab } from '../../features/scheduled-tasks/scheduled-task-view-model'
import { WEB_AFFAIR_STATUS_LABELS } from '../../features/web-affairs/web-affair-view-model'
import type { ScheduledTaskSnapshot } from '@shared/scheduled-task/scheduled-task-types'
import type { WebAffair } from '@shared/web-affairs/web-affair-types'

type Row = {
  path: string
  task?: ScheduledTaskSnapshot
  affair?: Pick<WebAffair, 'id' | 'title' | 'status'>
}
/** Read-only summary of the original domain states; never schedules or mutates work. */
export function RunningWork(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const anchor = useRef<HTMLButtonElement>(null)
  const conversations = useAgentStore((state) => state.conversations)
  const running = Object.values(conversations).filter(
    (item) =>
      !item.archivedAt &&
      (item.loading || ['starting', 'running', 'cancelling'].includes(item.runStatus ?? '')),
  )
  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError('')
    void (async () => {
      const projects = await window.cclinkStudio.workspaceState.listLocalWorkspaces()
      const failures: string[] = []
      const groups = await Promise.all(
        projects.map(async (project) => {
          const path = project.workspacePath
          const [tasks, affairs] = await Promise.allSettled([
            window.cclinkStudio.scheduledTasks.inspect(path),
            window.cclinkStudio.webAffairs.getSnapshot({ workspaceRef: { kind: 'local', path } }),
          ])
          const result: Row[] = []
          if (tasks.status === 'fulfilled' && tasks.value.success)
            result.push(
              ...tasks.value.tasks
                .filter(
                  (task) =>
                    task.activation.enabled ||
                    ['queued', 'running', 'interrupted', 'failed'].includes(
                      task.latestRun?.status ?? '',
                    ),
                )
                .map((task) => ({ path, task })),
            )
          else failures.push(path + '：定时任务状态不可用')
          if (affairs.status === 'fulfilled' && affairs.value.success)
            result.push(
              ...affairs.value.data.affairs
                .filter((affair) =>
                  ['active', 'needs-attention', 'waiting-external', 'paused', 'failed'].includes(
                    affair.status,
                  ),
                )
                .map((affair) => ({ path, affair })),
            )
          else failures.push(path + '：事务状态不可用')
          return result
        }),
      )
      if (alive) {
        setRows(groups.flat())
        setError(failures.join('；'))
      }
    })()
      .catch((error) => {
        if (alive) setError(String(error))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    const unsubscribe = window.cclinkStudio.scheduledTasks.onChanged(() =>
      setRevision((value) => value + 1),
    )
    const offAffair = window.cclinkStudio.webAffairs.onChanged(() =>
      setRevision((value) => value + 1),
    )
    return () => {
      alive = false
      unsubscribe()
      offAffair()
    }
  }, [open, revision])
  const visit = async (row: Row): Promise<void> => {
    try {
      const ref = await openWorkspaceRef({ kind: 'local', path: row.path })
      if (row.task) useTabStore.getState().openTab(createScheduledTaskTab(row.path, row.task))
      if (row.affair)
        useTabStore.getState().openTab({
          type: 'web-affair',
          title: row.affair.title,
          icon: '📋',
          workspaceRef: ref,
          webAffair: { affairId: row.affair.id },
        })
      setOpen(false)
    } catch (error) {
      setError(String(error))
    }
  }
  return (
    <>
      <button
        ref={anchor}
        className="status-bar-item"
        onClick={() => setOpen((value) => !value)}
        title="进行中的工作"
      >
        进行中的工作{running.length ? ` · ${running.length} 个会话` : ''}
      </button>
      <FloatingSurface
        anchorRef={anchor}
        open={open}
        onRequestClose={() => setOpen(false)}
        placement="top-start"
        role="dialog"
        className="workspace-settings-form"
        style={{
          width: 520,
          maxHeight: '70vh',
          overflow: 'auto',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-primary)',
          zIndex: 10080,
        }}
      >
        <h2>进行中的工作</h2>
        <p>
          切换项目或版面不改变原工作归属。停止操作请回到原任务。本机定时任务只在 Studio 运行时调度。
        </p>
        <button disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          刷新工作状态
        </button>
        {loading && <p role="status">正在读取原任务状态…</p>}
        {running.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              void (async () => {
                const ref = item.runtime.workspaceRef
                if (ref && ref.kind !== 'global') await openWorkspaceRef(ref)
                if (openConversationInWorkbench(item.id)) setOpen(false)
                else setError('原会话暂不可打开，请从原项目会话列表恢复')
              })().catch((error) => setError(String(error)))
            }}
          >
            {item.title} · {item.runStatus}
            <small>
              {item.runtime.workspaceRef?.kind === 'local'
                ? item.runtime.workspaceRef.path
                : '远程会话：连接状态以原会话为准'}
            </small>
          </button>
        ))}
        {rows.map((row) => (
          <button
            key={row.path + ':' + (row.task?.definition.id ?? row.affair!.id)}
            onClick={() => void visit(row)}
          >
            {row.task
              ? row.task.definition.title +
                ' · ' +
                (row.task.latestRun?.status ??
                  (row.task.activation.enabled ? '本机已启用，等待触发' : '未启用'))
              : row.affair!.title + ' · ' + WEB_AFFAIR_STATUS_LABELS[row.affair!.status]}
            <small>{row.path}</small>
          </button>
        ))}
        {!loading && !rows.length && !running.length && !error && (
          <p>已读取的本机项目没有进行中或待处理工作。</p>
        )}
        {error && <p role="alert">{error}</p>}
      </FloatingSurface>
    </>
  )
}
