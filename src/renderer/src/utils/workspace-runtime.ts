import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import type { TerminalSessionSnapshot } from '@shared/ipc/terminal'
import { buildAgentConversationWorkspaceSnapshot, useAgentStore } from '../stores/agent-store'
import { useBrowserStore } from '../stores/browser-store'
import { useEditorStore } from '../stores/editor-store'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { isDetachedFromMain, useWorkbenchWindowStore } from '../stores/workbench-window-store'
import {
  beginWorkspaceStateRestore,
  endWorkspaceStateRestore,
  getWorkspaceStateKey,
  getWorkspaceStateOwnerKey,
  persistWorkspaceSectionNow,
} from './workspace-state'
import {
  scopeWorkspaceAgentSnapshot,
  scopeWorkspaceBrowserSnapshot,
  scopeWorkspaceEditorDraftSnapshot,
  scopeWorkspaceTabSnapshot,
  workspaceRefFromKey,
} from './conversation-workspace'
import { workspaceRefKey, type WorkspaceRef } from '@shared/workspace-ref'
import { syncWorkbenchTabProjectionNow } from './workbench-tab-model'
import { syncWorkbenchBookmarksNow, syncWorkbenchBrowserStateNow } from './workbench-browser-state'

function isWorkspaceTab(tab: ReturnType<typeof useTabStore.getState>['tabs'][number]): boolean {
  return tab.type !== 'settings'
}

export function hydrateRuntimeSections(
  snapshot: WorkspaceStateSnapshot | null,
  workspaceRefOverride?: WorkspaceRef,
): void {
  const sections = snapshot?.sections ?? {}
  const workspaceRef =
    workspaceRefOverride ?? workspaceRefFromKey(snapshot?.workspaceKey ?? snapshot?.workspacePath)
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
    const browserTabsSection =
      sections.browserTabs && typeof sections.browserTabs === 'object'
        ? sections.browserTabs
        : { tabs: {} }
    const browserBookmarksSection =
      sections.browserBookmarks && typeof sections.browserBookmarks === 'object'
        ? sections.browserBookmarks
        : null
    useBrowserStore.getState().hydrateFromWorkspaceState(
      scopeWorkspaceBrowserSnapshot(
        {
          ...browserTabsSection,
          ...(browserBookmarksSection ?? {}),
        },
        scopedTabsSnapshot,
      ),
    )
    const placements = useWorkbenchWindowStore.getState().placements
    const preserveTabIds = Object.values(placements)
      .filter(isDetachedFromMain)
      .map((placement) => placement.tabId)
    useTabStore.getState().hydrateFromWorkspaceState(scopedTabsSnapshot, { preserveTabIds })
    useEditorStore
      .getState()
      .hydrateFromWorkspaceState(
        scopeWorkspaceEditorDraftSnapshot(sections.editorDrafts ?? { files: {} }, workspaceRef),
      )
    if (workspaceRef?.kind !== 'remote') {
      useAgentStore.getState().hydrateFromWorkspaceState(scopedAgentSnapshot.value, {
        workspaceRef,
        merge: true,
      })
    }
  } finally {
    endWorkspaceStateRestore()
  }
}

export interface WorkspaceRuntimePersistenceFailure {
  section: 'tabs' | 'browserTabs' | 'browserBookmarks' | 'editorDrafts' | 'agentConversations'
  message: string
}

export interface WorkspaceRuntimePersistenceResult {
  success: boolean
  failures: WorkspaceRuntimePersistenceFailure[]
}

export async function persistRuntimeSections(
  workspaceKey?: string | null,
  workspaceRefOverride?: WorkspaceRef,
): Promise<WorkspaceRuntimePersistenceResult> {
  const targetWorkspaceKey = workspaceKey === undefined ? getWorkspaceStateKey() : workspaceKey
  const activeWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
  const targetWorkspaceRef =
    workspaceRefOverride ??
    (workspaceRefKey(activeWorkspaceRef) === targetWorkspaceKey
      ? activeWorkspaceRef
      : workspaceRefFromKey(targetWorkspaceKey))
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

  const writes = [
    {
      section: 'tabs' as const,
      promise: syncWorkbenchTabProjectionNow({
        workspaceKey: targetWorkspaceKey,
        ownerKey: getWorkspaceStateOwnerKey(),
        tabs: workspaceTabs,
        activeTabId,
      }),
    },
    {
      section: 'browserTabs' as const,
      promise: syncWorkbenchBrowserStateNow({
        workspaceKey: targetWorkspaceKey,
        ownerKey: getWorkspaceStateOwnerKey(),
        tabs: browserTabs,
      }),
    },
    {
      section: 'browserBookmarks' as const,
      promise: syncWorkbenchBookmarksNow({
        workspaceKey: targetWorkspaceKey,
        ownerKey: getWorkspaceStateOwnerKey(),
        bookmarks: browserBookmarks,
      }),
    },
    {
      section: 'editorDrafts' as const,
      promise: persistWorkspaceSectionNow('editorDrafts', editorDrafts, targetWorkspaceKey),
    },
    ...(targetWorkspaceRef?.kind === 'remote'
      ? []
      : [
          {
            section: 'agentConversations' as const,
            promise: persistWorkspaceSectionNow(
              'agentConversations',
              buildAgentConversationWorkspaceSnapshot(agentState, targetWorkspaceKey),
              targetWorkspaceKey,
            ),
          },
        ]),
  ]
  const settled = await Promise.allSettled(writes.map((write) => write.promise))
  const failures = settled.flatMap((result, index): WorkspaceRuntimePersistenceFailure[] => {
    if (result.status === 'fulfilled') return []
    const failure = {
      section: writes[index]!.section,
      message: result.reason instanceof Error ? result.reason.message : String(result.reason),
    }
    console.error('[WorkspaceRuntime] 工作台状态分区保存失败，项目切换继续:', {
      workspaceKey: targetWorkspaceKey,
      ...failure,
    })
    return [failure]
  })
  return { success: failures.length === 0, failures }
}

export async function reconcileAgentRuntimeStatuses(
  workspaceKey: string | null = getWorkspaceStateKey(),
): Promise<void> {
  if (useWorkspaceStore.getState().activeWorkspaceRef?.kind === 'remote') return
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

export async function reconcileTerminalRuntimeStatuses(
  workspaceKey: string | null = getWorkspaceStateKey(),
): Promise<void> {
  const sessions = await readTerminalRuntimeStatuses()
  if (!sessions) return
  applyTerminalRuntimeStatuses(sessions, workspaceKey)
}

export async function readTerminalRuntimeStatuses(): Promise<TerminalSessionSnapshot[] | null> {
  const listSessions = window.cclinkStudio?.terminal?.listSessions
  if (!listSessions) return null

  try {
    return await listSessions()
  } catch (error) {
    console.warn('[WorkspaceRuntime] Terminal session reconciliation failed:', error)
    return null
  }
}

export function applyTerminalRuntimeStatuses(
  sessions: TerminalSessionSnapshot[],
  workspaceKey: string | null = getWorkspaceStateKey(),
): void {
  if (getWorkspaceStateKey() !== workspaceKey) return

  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]))
  const tabStore = useTabStore.getState()
  for (const tab of tabStore.tabs) {
    if (
      tab.type !== 'terminal' ||
      !tab.terminal?.sessionId ||
      !tab.workspaceRef ||
      workspaceRefKey(tab.workspaceRef) !== workspaceKey
    ) {
      continue
    }
    const session = sessionsById.get(tab.terminal.sessionId)
    if (session) tabStore.reconcileTerminalSession(session)
  }
}
