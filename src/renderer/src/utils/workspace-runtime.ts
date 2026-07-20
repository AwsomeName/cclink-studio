import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import { buildAgentConversationWorkspaceSnapshot, useAgentStore } from '../stores/agent-store'
import { useBrowserStore } from '../stores/browser-store'
import { useEditorStore } from '../stores/editor-store'
import { useTabStore } from '../stores/tab-store'
import {
  beginWorkspaceStateRestore,
  endWorkspaceStateRestore,
  getWorkspaceStateKey,
  persistWorkspaceSectionNow,
} from './workspace-state'
import {
  scopeWorkspaceAgentSnapshot,
  scopeWorkspaceBrowserSnapshot,
  scopeWorkspaceEditorDraftSnapshot,
  scopeWorkspaceTabSnapshot,
  workspaceRefFromKey,
} from './conversation-workspace'
import { workspaceRefKey } from '@shared/workspace-ref'

function isWorkspaceTab(tab: ReturnType<typeof useTabStore.getState>['tabs'][number]): boolean {
  return tab.type !== 'settings'
}

export function hydrateRuntimeSections(snapshot: WorkspaceStateSnapshot | null): void {
  const sections = snapshot?.sections ?? {}
  const workspaceRef = workspaceRefFromKey(snapshot?.workspaceKey ?? snapshot?.workspacePath)
  const scopedAgentSnapshot = scopeWorkspaceAgentSnapshot(
    sections.agentConversations ?? {
      conversations: {},
      conversationOrder: [],
      activeConversationId: null,
    },
    workspaceRef,
  )
  const scopedTabsSnapshot = scopeWorkspaceTabSnapshot(
    sections.tabs ?? { tabs: [], activeTabId: null },
    scopedAgentSnapshot.conversationIdMap,
    workspaceRef,
  )
  beginWorkspaceStateRestore()
  try {
    useBrowserStore
      .getState()
      .hydrateFromWorkspaceState(
        scopeWorkspaceBrowserSnapshot(sections.browserTabs ?? { tabs: {} }, scopedTabsSnapshot),
      )
    useTabStore.getState().hydrateFromWorkspaceState(scopedTabsSnapshot)
    useEditorStore
      .getState()
      .hydrateFromWorkspaceState(
        scopeWorkspaceEditorDraftSnapshot(sections.editorDrafts ?? { files: {} }, workspaceRef),
      )
    useAgentStore.getState().hydrateFromWorkspaceState(scopedAgentSnapshot.value, {
      workspaceRef,
      merge: true,
    })
  } finally {
    endWorkspaceStateRestore()
  }
}

export async function persistRuntimeSections(workspaceKey?: string | null): Promise<void> {
  const targetWorkspaceKey = workspaceKey === undefined ? getWorkspaceStateKey() : workspaceKey
  const targetWorkspaceRef = workspaceRefFromKey(targetWorkspaceKey)
  const tabState = useTabStore.getState()
  const workspaceTabs = tabState.tabs.filter(
    (tab) =>
      isWorkspaceTab(tab) &&
      Boolean(tab.workspaceRef) &&
      workspaceRefKey(tab.workspaceRef!) === targetWorkspaceKey,
  )
  const browserTabIds = new Set(
    workspaceTabs.flatMap((tab) => (tab.type === 'browser' ? [tab.id] : [])),
  )
  const browserTabs = Object.fromEntries(
    Object.entries(useBrowserStore.getState().tabs).filter(([tabId]) => browserTabIds.has(tabId)),
  )
  const browserBookmarks = useBrowserStore.getState().bookmarks
  const editorDrafts = scopeWorkspaceEditorDraftSnapshot(
    { files: useEditorStore.getState().files },
    targetWorkspaceRef,
  )
  const activeTabId =
    tabState.activeTabId && workspaceTabs.some((tab) => tab.id === tabState.activeTabId)
      ? tabState.activeTabId
      : (workspaceTabs[0]?.id ?? null)

  const agentState = useAgentStore.getState()

  await Promise.all([
    persistWorkspaceSectionNow('tabs', { tabs: workspaceTabs, activeTabId }, targetWorkspaceKey),
    persistWorkspaceSectionNow(
      'browserTabs',
      { tabs: browserTabs, bookmarks: browserBookmarks },
      targetWorkspaceKey,
    ),
    persistWorkspaceSectionNow('editorDrafts', editorDrafts, targetWorkspaceKey),
    persistWorkspaceSectionNow(
      'agentConversations',
      buildAgentConversationWorkspaceSnapshot(agentState, targetWorkspaceKey),
      targetWorkspaceKey,
    ),
  ])
}

export async function reconcileAgentRuntimeStatuses(
  workspaceKey: string | null = getWorkspaceStateKey(),
): Promise<void> {
  const getStatus = window.cclinkStudio?.agent?.getStatus

  const state = useAgentStore.getState()
  const conversationIds = state.conversationOrder.filter((conversationId) => {
    const conversation = state.conversations[conversationId]
    if (!conversation || conversation.archivedAt) return false
    const conversationWorkspaceKey = conversation.runtime.workspaceRef
      ? workspaceRefKey(conversation.runtime.workspaceRef)
      : workspaceKey
    return conversationWorkspaceKey === workspaceKey
  })
  const statuses = getStatus
    ? await Promise.allSettled(
        conversationIds.map(async (conversationId) => {
          const conversation = useAgentStore.getState().conversations[conversationId]
          return {
            conversationId,
            observedRunId: conversation?.activeRunId ?? null,
            observedEventAt: conversation?.lastRunEventAt ?? null,
            status: await getStatus(conversationId),
          }
        }),
      )
    : conversationIds.map(() => ({ status: 'rejected' as const, reason: 'Agent IPC unavailable' }))
  if (getWorkspaceStateKey() !== workspaceKey) return

  for (const [index, result] of statuses.entries()) {
    const conversationId = conversationIds[index]
    if (result.status === 'fulfilled') {
      const current = useAgentStore.getState().conversations[conversationId]
      if (
        current?.activeRunId !== result.value.observedRunId ||
        current?.lastRunEventAt !== result.value.observedEventAt
      ) {
        continue
      }
      useAgentStore.getState().reconcileRuntimeStatus(result.value.status, conversationId)
      continue
    }
    const conversation = useAgentStore.getState().conversations[conversationId]
    useAgentStore.getState().reconcileRuntimeStatus(
      {
        connected: false,
        busy: false,
        runId: null,
        sessionId: conversation?.sessionId ?? null,
        ready: false,
      },
      conversationId,
    )
  }
}
