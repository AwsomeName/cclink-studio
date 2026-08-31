import type { BrowserTaskRun } from '@shared/ipc/browser'

function isFinalBrowserTaskStatus(status: BrowserTaskRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function pickCurrentTask(tasks: BrowserTaskRun[]): BrowserTaskRun | null {
  const ordered = [...tasks].sort((left, right) => right.startedAt - left.startedAt)
  return ordered.find((task) => !isFinalBrowserTaskStatus(task.status)) ?? ordered[0] ?? null
}

/** Resolves the BrowserTask owned by one Agent conversation, independent of UI scope. */
export function selectConversationBrowserTask(input: {
  tasks: BrowserTaskRun[]
  conversationId: string
  workspaceKey: string | null
}): BrowserTaskRun | null {
  return pickCurrentTask(
    input.tasks.filter(
      (task) =>
        task.correlation?.conversationId === input.conversationId &&
        task.correlation.workspaceKey === input.workspaceKey,
    ),
  )
}

/** Resolves which Agent conversation owns the selected visible Browser Tab. */
export function selectBrowserTabConversationTask(input: {
  tasks: BrowserTaskRun[]
  tabId: string
  workspaceKey: string | null
}): BrowserTaskRun | null {
  return pickCurrentTask(
    input.tasks.filter(
      (task) =>
        task.tabId === input.tabId &&
        Boolean(task.correlation?.conversationId) &&
        Boolean(task.correlation?.affairId) &&
        task.correlation?.workspaceKey === input.workspaceKey,
    ),
  )
}
