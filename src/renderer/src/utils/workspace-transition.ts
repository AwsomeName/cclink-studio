import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import type { BrowserViewBinding } from '@shared/ipc/browser'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import { workspaceRefKey } from '../../../shared/workspace-ref'
import { useAgentStore } from '../stores/agent-store'
import { useBrowserTaskStore } from '../stores/browser-task-store'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { getWorkspaceStateKey, getWorkspaceStateOwnerKey } from './workspace-state'
import {
  applyTerminalRuntimeStatuses,
  hydrateRuntimeSections,
  persistRuntimeSections,
  readTerminalRuntimeStatuses,
  reconcileAgentRuntimeStatuses,
} from './workspace-runtime'

export interface WorkspaceRuntimeTransition {
  ref: WorkspaceRef
  key: string | null
  snapshot: WorkspaceStateSnapshot | null
  generation: number
  outgoingOwnership: WorkspaceRuntimeResourceOwnership
}

export interface WorkspaceRuntimeResourceOwnership {
  workspaceKey: string | null
  browserTabIds: string[]
  browserTaskIds: string[]
  activeBrowserTabId: string | null
  agentConversationIds: string[]
  activeAgentConversationId: string | null
  terminalSessionIds: string[]
}

let workspaceTransitionGeneration = 0
const OPTIONAL_RUNTIME_RECONCILIATION_TIMEOUT_MS = 1_500

async function waitForOptionalRuntime<T>(
  label: 'Browser' | 'Terminal',
  operation: Promise<T>,
): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  try {
    const result = await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true
          resolve(null)
        }, OPTIONAL_RUNTIME_RECONCILIATION_TIMEOUT_MS)
      }),
    ])
    if (timedOut) {
      console.warn(`[WorkspaceTransition] ${label} runtime reconciliation timed out`)
    }
    return result
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function beginWorkspaceRuntimeTransition(): number {
  workspaceTransitionGeneration += 1
  return workspaceTransitionGeneration
}

export function isWorkspaceRuntimeTransitionCurrent(generation: number): boolean {
  return generation === workspaceTransitionGeneration
}

export function collectWorkspaceRuntimeResourceOwnership(
  workspaceKey: string | null,
): WorkspaceRuntimeResourceOwnership {
  const tabState = useTabStore.getState()
  const workspaceTabs = tabState.tabs.filter(
    (tab) => tab.workspaceRef && workspaceRefKey(tab.workspaceRef) === workspaceKey,
  )
  const browserTabIds = workspaceTabs.flatMap((tab) => (tab.type === 'browser' ? [tab.id] : []))
  const terminalSessionIds = workspaceTabs.flatMap((tab) =>
    tab.type === 'terminal' && tab.terminal?.sessionId ? [tab.terminal.sessionId] : [],
  )
  const browserTaskIds = Object.values(useBrowserTaskStore.getState().tasks)
    .filter((task) => browserTabIds.includes(task.tabId))
    .map((task) => task.id)
  const agentState = useAgentStore.getState()
  const agentConversationIds = agentState.conversationOrder.filter((conversationId) => {
    const workspaceRef = agentState.conversations[conversationId]?.runtime.workspaceRef
    return workspaceRef ? workspaceRefKey(workspaceRef) === workspaceKey : false
  })

  return {
    workspaceKey,
    browserTabIds,
    browserTaskIds,
    activeBrowserTabId:
      tabState.activeTabId && browserTabIds.includes(tabState.activeTabId)
        ? tabState.activeTabId
        : null,
    agentConversationIds,
    activeAgentConversationId: agentConversationIds.includes(agentState.activeConversationId)
      ? agentState.activeConversationId
      : null,
    terminalSessionIds,
  }
}

function getIncomingBrowserViews(snapshot: WorkspaceStateSnapshot | null): BrowserViewBinding[] {
  const tabsSection = snapshot?.sections.tabs
  if (!tabsSection || typeof tabsSection !== 'object') return []
  const tabs = (tabsSection as { tabs?: unknown }).tabs
  if (!Array.isArray(tabs)) return []

  return tabs.flatMap((tab) => {
    if (!tab || typeof tab !== 'object') return []
    const candidate = tab as { id?: unknown; type?: unknown; browserProfile?: unknown }
    if (candidate.type !== 'browser' || typeof candidate.id !== 'string') return []
    if (
      candidate.browserProfile !== undefined &&
      candidate.browserProfile !== null &&
      typeof candidate.browserProfile !== 'string'
    ) {
      throw new Error(`浏览器 Tab ${candidate.id} 的 Profile 绑定无效`)
    }
    return [
      {
        tabId: candidate.id,
        profileId: candidate.browserProfile ?? null,
      },
    ]
  })
}

async function bindBrowserRuntimeToWorkspace(
  workspaceKey: string | null,
  snapshot: WorkspaceStateSnapshot | null,
): Promise<void> {
  const reconcileViews = window.cclinkStudio?.browser?.reconcileViews
  if (!reconcileViews) return

  try {
    await reconcileViews({
      workspaceKey,
      views: getIncomingBrowserViews(snapshot),
      activeTabId: null,
    })
  } catch (error) {
    console.warn('[WorkspaceTransition] Browser runtime ownership update failed:', error)
  }
}

export async function prepareWorkspaceRuntimeTransition(
  ref: WorkspaceRef,
  options: { persistCurrent?: boolean; generation?: number } = {},
): Promise<WorkspaceRuntimeTransition> {
  const generation = options.generation ?? beginWorkspaceRuntimeTransition()
  const key = workspaceRefKey(ref)
  const currentKey = getWorkspaceStateKey()
  const currentRef = useWorkspaceStore.getState().activeWorkspaceRef
  const outgoingOwnership = collectWorkspaceRuntimeResourceOwnership(currentKey)

  if (options.persistCurrent !== false && key !== currentKey) {
    // 单个恢复快照写入失败不能让用户失去打开其他项目的能力。失败会由
    // persistRuntimeSections 写入框架日志，当前内存态仍保留并可继续重试。
    await persistRuntimeSections(currentKey, currentRef)
  }

  const snapshot = await window.cclinkStudio.workspaceState.get(key, getWorkspaceStateOwnerKey())

  return { ref, key, snapshot, generation, outgoingOwnership }
}

export async function applyWorkspaceRuntimeTransition(
  transition: WorkspaceRuntimeTransition,
  options: { hydrate?: boolean; flush?: boolean; commitProjection?: () => void } = {},
): Promise<boolean> {
  if (!isWorkspaceRuntimeTransitionCurrent(transition.generation)) return false
  const [, terminalSessions] = await Promise.all([
    waitForOptionalRuntime(
      'Browser',
      bindBrowserRuntimeToWorkspace(transition.key, transition.snapshot),
    ),
    waitForOptionalRuntime('Terminal', readTerminalRuntimeStatuses()),
  ])
  if (!isWorkspaceRuntimeTransitionCurrent(transition.generation)) return false
  options.commitProjection?.()
  useWorkspaceStore.getState().commitActiveWorkspace(transition.ref)

  if (options.hydrate !== false) {
    hydrateRuntimeSections(transition.snapshot, transition.ref)
    if (terminalSessions) applyTerminalRuntimeStatuses(terminalSessions, transition.key)
    void reconcileAgentRuntimeStatuses(transition.key)
  }

  if (options.flush !== false) {
    void persistRuntimeSections(transition.key, transition.ref)
  }
  return true
}
