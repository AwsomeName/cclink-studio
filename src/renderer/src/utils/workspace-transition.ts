import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import type { WorkspaceRef } from '../../../shared/workspace-ref'
import { workspaceRefKey } from '../../../shared/workspace-ref'
import { useAgentStore } from '../stores/agent-store'
import { useBrowserTaskStore } from '../stores/browser-task-store'
import { useTabStore } from '../stores/tab-store'
import {
  getWorkspaceStateKey,
  getWorkspaceStateOwnerKey,
  setWorkspaceStateRef,
} from './workspace-state'
import {
  hydrateRuntimeSections,
  persistRuntimeSections,
  reconcileAgentRuntimeStatuses,
  reconcileTerminalRuntimeStatuses,
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

function getIncomingBrowserTabIds(snapshot: WorkspaceStateSnapshot | null): string[] {
  const tabsSection = snapshot?.sections.tabs
  if (!tabsSection || typeof tabsSection !== 'object') return []
  const tabs = (tabsSection as { tabs?: unknown }).tabs
  if (!Array.isArray(tabs)) return []

  return tabs.flatMap((tab) => {
    if (!tab || typeof tab !== 'object') return []
    const candidate = tab as { id?: unknown; type?: unknown }
    return candidate.type === 'browser' && typeof candidate.id === 'string' ? [candidate.id] : []
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
      validTabIds: getIncomingBrowserTabIds(snapshot),
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
  const outgoingOwnership = collectWorkspaceRuntimeResourceOwnership(currentKey)

  if (options.persistCurrent !== false && key !== currentKey) {
    await persistRuntimeSections(currentKey)
  }

  const snapshot = await window.cclinkStudio.workspaceState.get(key, getWorkspaceStateOwnerKey())

  return { ref, key, snapshot, generation, outgoingOwnership }
}

export async function applyWorkspaceRuntimeTransition(
  transition: WorkspaceRuntimeTransition,
  options: { hydrate?: boolean; flush?: boolean } = {},
): Promise<boolean> {
  if (!isWorkspaceRuntimeTransitionCurrent(transition.generation)) return false
  await bindBrowserRuntimeToWorkspace(transition.key, transition.snapshot)
  if (!isWorkspaceRuntimeTransitionCurrent(transition.generation)) return false
  setWorkspaceStateRef(transition.ref)

  if (options.hydrate !== false) {
    hydrateRuntimeSections(transition.snapshot)
    await reconcileTerminalRuntimeStatuses(transition.key)
    if (!isWorkspaceRuntimeTransitionCurrent(transition.generation)) return false
    void reconcileAgentRuntimeStatuses(transition.key)
  }

  if (options.flush !== false) {
    void persistRuntimeSections(transition.key)
  }
  return true
}
