import type { AppSettings } from '@shared/ipc/settings'
import type { DefaultWorkspaceResult, WorkspaceStateSnapshot } from '@shared/ipc/workspace-state'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { summarizeWorkspaceConversationSnapshot } from '@shared/workspace-conversation-diagnostics'
import {
  scopeWorkspaceAgentSnapshot,
  scopeWorkspaceBrowserSnapshot,
  scopeWorkspaceEditorDraftSnapshot,
  scopeWorkspaceTabSnapshot,
  workspaceRefFromKey,
} from '../utils/conversation-workspace'
import { recordRendererDiagnosticLog } from '../features/diagnostics/renderer-diagnostic-log'

export interface WorkspaceBootstrapDeps {
  getSettings: () => Promise<AppSettings | null>
  ensureDefaultWorkspace: () => Promise<DefaultWorkspaceResult>
  reportWorkspaceError?: (error: string) => void
  resolveWorkspacePath: (workspacePath: string) => Promise<string | null>
  getWorkspaceState: (workspacePath?: string | null) => Promise<WorkspaceStateSnapshot>
  setWorkspacePath: (workspacePath: string | null) => void
  beginRestore: () => void
  endRestore: () => void
  hydrateLayout: (value: unknown) => void
  createLayoutRestore?: () => {
    hydrate: (sections: Record<string, unknown>) => void
    complete: () => Promise<void>
  }
  hydrateBrowserTabs: (value: unknown) => void
  hydrateTabs: (value: unknown) => void
  hydrateEditorDrafts: (value: unknown) => void
  hydrateFileTree: (value: unknown) => void
  hydrateAgentConversations: (
    value: unknown,
    options?: { workspaceRef?: WorkspaceRef; merge?: boolean },
  ) => void
  getHydratedAgentConversations?: () => unknown
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
    if (!settings) throw new Error('无法读取启动设置，未创建或修改工作空间')
    let candidatePath = settings.lastWorkspacePath || null
    let startupError: string | null = null
    if (settings.startupWorkspaceTarget === 'unfiled') candidatePath = null
    else if (
      settings.startupWorkspaceTarget === 'default' ||
      (!candidatePath && settings.startupWorkspaceTarget !== 'resume')
    ) {
      const result = await deps.ensureDefaultWorkspace()
      candidatePath = result.success ? result.workspacePath : null
      if (!result.success)
        startupError = result.error || '默认工作空间不可用，请定位原目录或选择其他工作空间'
    }
    const resolvedPath = candidatePath
      ? await deps.resolveWorkspacePath(candidatePath).catch(() => null)
      : null
    if (candidatePath && !resolvedPath)
      startupError = '上次工作空间不可用，请定位原目录或选择其他工作空间；未创建空目录替代'
    workspacePath = await deps.initWorkspace(resolvedPath, settings)
    deps.setWorkspacePath(workspacePath)
    if (startupError) deps.reportWorkspaceError?.(startupError)
  } catch (error) {
    deps.warn('[WorkspaceBootstrap] 工作区确认失败:', error)
    workspacePath = null
    deps.setWorkspacePath(null)
    deps.reportWorkspaceError?.(error instanceof Error ? error.message : '工作空间恢复失败')
  }

  const layoutRestore = deps.createLayoutRestore?.()
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
    const storedConversationSummary = summarizeWorkspaceConversationSnapshot(
      sections.agentConversations,
    )
    const scopedAgentSnapshot = scopeWorkspaceAgentSnapshot(
      sections.agentConversations ?? {
        conversations: {},
        conversationOrder: [],
        activeConversationId: null,
      },
      workspaceRef,
    )
    const scopedConversationSummary = summarizeWorkspaceConversationSnapshot(
      scopedAgentSnapshot.value,
    )
    recordRendererDiagnosticLog('info', [
      '[ConversationRestore] snapshot-scoped',
      {
        workspaceKind: workspaceRef.kind,
        snapshotUpdatedAt: snapshot.updatedAt,
        stored: storedConversationSummary,
        scoped: scopedConversationSummary,
      },
    ])
    const scopedTabsSnapshot = scopeWorkspaceTabSnapshot(
      sections.tabs ?? { tabs: [], activeTabId: null },
      scopedAgentSnapshot.conversationIdMap,
      workspaceRef,
    )
    deps.beginRestore()
    if (layoutRestore) layoutRestore.hydrate(sections)
    else deps.hydrateLayout(sections.layout)
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
    const hydratedConversationSummary = summarizeWorkspaceConversationSnapshot(
      deps.getHydratedAgentConversations?.() ?? scopedAgentSnapshot.value,
    )
    recordRendererDiagnosticLog('info', [
      '[ConversationRestore] hydrate-applied',
      {
        workspaceKind: workspaceRef.kind,
        storedConversationCount: storedConversationSummary.storedConversationCount,
        scopedConversationCount: scopedConversationSummary.storedConversationCount,
        storedMessageCount: storedConversationSummary.messageCount,
        scopedMessageCount: scopedConversationSummary.messageCount,
        hydratedConversationCount: hydratedConversationSummary.storedConversationCount,
        hydratedMessageCount: hydratedConversationSummary.messageCount,
      },
    ])
  } catch (error) {
    recordRendererDiagnosticLog('error', ['[ConversationRestore] hydrate-failed', error])
    deps.warn('[WorkspaceBootstrap] 工作台状态应用失败:', error)
    canPersistRuntime = false
  } finally {
    deps.endRestore()
  }

  if (canPersistRuntime && layoutRestore) {
    await layoutRestore
      .complete()
      .catch((error: unknown) =>
        deps.warn('[WorkspaceBootstrap] 布局兼容迁移失败，保留旧值:', error),
      )
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
