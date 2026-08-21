import { useEffect, useState } from 'react'
import {
  useAgentStore,
  useBrowserStore,
  useEditorStore,
  useFsStore,
  useTabStore,
  useUIStore,
} from '../stores'
import {
  beginWorkspaceStateRestore,
  endWorkspaceStateRestore,
  getWorkspaceStateOwnerKey,
  setWorkspaceStatePath,
} from '../utils/workspace-state'
import {
  restoreWorkspaceState,
  type WorkspaceBootstrapDeps,
  type WorkspaceBootstrapResult,
} from './workspace-bootstrap-core'
import {
  persistRuntimeSections,
  reconcileAgentRuntimeStatuses,
  reconcileTerminalRuntimeStatuses,
} from '../utils/workspace-runtime'
import { runOpenProjectsBootstrapOnce } from '../stores/open-projects-store'
import { restoreCclinkConnectionForOpenProjects } from '../features/cclink-remote/cclink-connection-policy'

export type { WorkspaceBootstrapDeps } from './workspace-bootstrap-core'
export { restoreWorkspaceState } from './workspace-bootstrap-core'

let workspaceBootstrapPromise: Promise<WorkspaceBootstrapResult> | null = null

export function createWorkspaceBootstrapDeps(): WorkspaceBootstrapDeps {
  return {
    getSettings: () => window.cclinkStudio.settings.getAll().catch(() => null),
    resolveWorkspacePath: async (workspacePath) => {
      const result = await window.cclinkStudio.workspaceState.resolveLocalWorkspace(workspacePath)
      return result.valid ? result.workspacePath : null
    },
    getWorkspaceState: (workspacePath) =>
      window.cclinkStudio.workspaceState.get(workspacePath, getWorkspaceStateOwnerKey()),
    setWorkspacePath: setWorkspaceStatePath,
    beginRestore: beginWorkspaceStateRestore,
    endRestore: endWorkspaceStateRestore,
    hydrateLayout: (value) => useUIStore.getState().hydrateFromWorkspaceState(value),
    hydrateBrowserTabs: (value) => useBrowserStore.getState().hydrateFromWorkspaceState(value),
    hydrateTabs: (value) => useTabStore.getState().hydrateFromWorkspaceState(value),
    hydrateEditorDrafts: (value) => useEditorStore.getState().hydrateFromWorkspaceState(value),
    hydrateFileTree: (value) => useFsStore.getState().hydrateFromWorkspaceState(value),
    hydrateAgentConversations: (value, options) =>
      useAgentStore.getState().hydrateFromWorkspaceState(value, options),
    getHydratedAgentConversations: () => {
      const state = useAgentStore.getState()
      return {
        conversations: state.conversations,
        conversationOrder: state.conversationOrder,
        activeConversationId: state.activeConversationId,
      }
    },
    initWorkspace: (workspacePath, settings) =>
      useFsStore.getState().initWorkspace(workspacePath, settings),
    refreshWorkspace: () => useFsStore.getState().refreshWorkspace(),
    warn: (message, error) => console.warn(message, error),
  }
}

export function runWorkspaceBootstrapOnce(
  depsFactory: () => WorkspaceBootstrapDeps = createWorkspaceBootstrapDeps,
): Promise<WorkspaceBootstrapResult> {
  if (!workspaceBootstrapPromise) {
    workspaceBootstrapPromise = restoreWorkspaceState(depsFactory()).catch((error: unknown) => {
      workspaceBootstrapPromise = null
      throw error
    })
  }
  return workspaceBootstrapPromise
}

export function resetWorkspaceBootstrapForTests(): void {
  workspaceBootstrapPromise = null
}

/** 启动时从 main process 恢复工作台状态，再挂载工作区 UI。 */
export function useWorkspaceBootstrap(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function bootstrap(): Promise<void> {
      const result = await runWorkspaceBootstrapOnce()
      if (result.canPersistRuntime) {
        await reconcileTerminalRuntimeStatuses(result.workspacePath)
        await reconcileAgentRuntimeStatuses(result.workspacePath)
        await persistRuntimeSections()
      }
      const fsState = useFsStore.getState()
      await runOpenProjectsBootstrapOnce(fsState.workspacePath, fsState.recentWorkspacePaths)
      if (!cancelled) {
        setReady(true)
        // 本地工作台先就绪；后台只为确实仍处于“打开”状态的远程项目恢复连接。
        void restoreCclinkConnectionForOpenProjects()
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  return ready
}
