import type { ScheduledTaskSnapshot } from '@shared/scheduled-task/scheduled-task-types'
import type { WebAffair } from '@shared/web-affairs/web-affair-types'
import type { TerminalSessionSnapshot } from '@shared/ipc/terminal'

export type WorkspaceWork = {
  tasks: ScheduledTaskSnapshot[]
  affairs: Pick<WebAffair, 'id' | 'title' | 'status'>[]
  terminals: TerminalSessionSnapshot[]
  errors: string[]
}
/** Fresh read projections from the original owners; never silently treats failures as idle. */
export async function inspectWorkspaceWork(path: string): Promise<WorkspaceWork> {
  const result: WorkspaceWork = { tasks: [], affairs: [], terminals: [], errors: [] }
  const [tasks, affairs, terminals] = await Promise.allSettled([
    window.cclinkStudio.scheduledTasks.inspect(path),
    window.cclinkStudio.webAffairs.getSnapshot({ workspaceRef: { kind: 'local', path } }),
    window.cclinkStudio.terminal.listSessions(),
  ])
  if (tasks.status === 'fulfilled' && tasks.value.success) {
    result.tasks = tasks.value.tasks.filter(
      (task) =>
        task.activation.enabled ||
        ['queued', 'running', 'interrupted', 'failed'].includes(task.latestRun?.status ?? ''),
    )
  } else result.errors.push('定时任务状态读取失败')
  if (affairs.status === 'fulfilled' && affairs.value.success) {
    result.affairs = affairs.value.data.affairs.filter((affair) =>
      ['active', 'needs-attention', 'waiting-external', 'paused', 'failed'].includes(affair.status),
    )
  } else result.errors.push('网页事务状态读取失败')
  if (terminals.status === 'fulfilled') {
    result.terminals = terminals.value.filter(
      (session) =>
        session.runtime.workspaceRef.kind === 'local' &&
        session.runtime.workspaceRef.path === path &&
        ['starting', 'running', 'blocked', 'error'].includes(session.status),
    )
  } else result.errors.push('终端状态读取失败')
  return result
}
