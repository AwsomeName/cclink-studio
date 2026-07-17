import type { AppSettings } from '@shared/ipc/settings'
import type { WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import type { WorkspaceRef } from '@shared/workspace-ref'
import {
  scopeWorkspaceAgentSnapshot,
  scopeWorkspaceBrowserSnapshot,
  scopeWorkspaceEditorDraftSnapshot,
  scopeWorkspaceTabSnapshot,
  workspaceRefFromKey,
} from '../utils/conversation-workspace'

export interface WorkspaceBootstrapDeps {
  getSettings: () => Promise<AppSettings | null>
  resolveWorkspacePath: (workspacePath: string) => Promise<string | null>
  getWorkspaceState: (workspacePath?: string | null) => Promise<WorkspaceStateSnapshot>
  setWorkspacePath: (workspacePath: string | null) => void
  beginRestore: () => void
  endRestore: () => void
  hydrateLayout: (value: unknown) => void
  hydrateBrowserTabs: (value: unknown) => void
  hydrateTabs: (value: unknown) => void
  hydrateEditorDrafts: (value: unknown) => void
  hydrateFileTree: (value: unknown) => void
  hydrateAgentConversations: (
    value: unknown,
    options?: { workspaceRef?: WorkspaceRef; merge?: boolean },
  ) => void
  initWorkspace: (
    workspacePath: string | null,
    settings: AppSettings | null,
  ) => Promise<string | null>
  refreshWorkspace: () => Promise<void>
  warn: (message: string, error: unknown) => void
}

export interface WorkspaceBootstrapResult {
  workspacePath: string | null
  canPersistRuntime: boolean
}

/** 恢复 main process 持久化的工作台状态；作为纯函数便于无 DOM 单测。 */
export async function restoreWorkspaceState(
  deps: WorkspaceBootstrapDeps,
): Promise<WorkspaceBootstrapResult> {
  let workspacePath: string | null = null
  let settings: AppSettings | null = null
  try {
    settings = await deps.getSettings().catch(() => null)
    const candidatePath = settings?.lastWorkspacePath || null
    const resolvedPath = candidatePath
      ? await deps.resolveWorkspacePath(candidatePath).catch(() => null)
      : null
    workspacePath = await deps.initWorkspace(resolvedPath, settings)
    deps.setWorkspacePath(workspacePath)
  } catch (error) {
    deps.warn('[WorkspaceBootstrap] 工作区确认失败:', error)
    workspacePath = null
    deps.setWorkspacePath(null)
  }

  let snapshot: WorkspaceStateSnapshot
  try {
    snapshot = await deps.getWorkspaceState(workspacePath)
  } catch (error) {
    deps.warn('[WorkspaceBootstrap] 工作台状态读取失败:', error)
    if (workspacePath) {
      try {
        await deps.refreshWorkspace()
      } catch (refreshError) {
        deps.warn('[WorkspaceBootstrap] 文件树现场恢复失败:', refreshError)
      }
    }
    return { workspacePath, canPersistRuntime: false }
  }

  let canPersistRuntime = true
  try {
    const sections = snapshot.sections
    const workspaceRef = workspaceRefFromKey(workspacePath)
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
    deps.beginRestore()
    deps.hydrateLayout(sections.layout)
    deps.hydrateBrowserTabs(
      scopeWorkspaceBrowserSnapshot(sections.browserTabs ?? { tabs: {} }, scopedTabsSnapshot),
    )
    deps.hydrateTabs(scopedTabsSnapshot)
    deps.hydrateEditorDrafts(
      scopeWorkspaceEditorDraftSnapshot(sections.editorDrafts ?? { files: {} }, workspaceRef),
    )
    deps.hydrateFileTree(sections.fileTree ?? { expandedPaths: [], selectedPath: null })
    deps.hydrateAgentConversations(scopedAgentSnapshot.value, {
      workspaceRef,
      merge: true,
    })
  } catch (error) {
    deps.warn('[WorkspaceBootstrap] 工作台状态应用失败:', error)
    canPersistRuntime = false
  } finally {
    deps.endRestore()
  }

  if (workspacePath) {
    try {
      await deps.refreshWorkspace()
    } catch (error) {
      deps.warn('[WorkspaceBootstrap] 文件树现场恢复失败:', error)
    }
  }

  return { workspacePath, canPersistRuntime }
}
