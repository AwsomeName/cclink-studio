import { useEffect, useState } from 'react'
import { useAgentStore, useBrowserStore, useEditorStore, useFsStore, useTabStore, useUIStore } from '../stores'
import { getWorkspaceStateOwnerKey, setWorkspaceStatePath } from '../utils/workspace-state'
import { restoreWorkspaceState, type WorkspaceBootstrapDeps } from './workspace-bootstrap-core'

export type { WorkspaceBootstrapDeps } from './workspace-bootstrap-core'
export { restoreWorkspaceState } from './workspace-bootstrap-core'

export function createWorkspaceBootstrapDeps(): WorkspaceBootstrapDeps {
  return {
    getSettings: () => window.deepink.settings.getAll().catch(() => null),
    getWorkspaceState: (workspacePath) =>
      window.deepink.workspaceState.get(workspacePath, getWorkspaceStateOwnerKey()),
    setWorkspacePath: setWorkspaceStatePath,
    hydrateLayout: (value) => useUIStore.getState().hydrateFromWorkspaceState(value),
    hydrateBrowserTabs: (value) => useBrowserStore.getState().hydrateFromWorkspaceState(value),
    hydrateTabs: (value) => useTabStore.getState().hydrateFromWorkspaceState(value),
    hydrateEditorDrafts: (value) => useEditorStore.getState().hydrateFromWorkspaceState(value),
    hydrateAgentConversations: (value) => useAgentStore.getState().hydrateFromWorkspaceState(value),
    initWorkspace: () => useFsStore.getState().initWorkspace(),
    warn: (message, error) => console.warn(message, error),
  }
}

/** 启动时从 main process 恢复工作台状态，再挂载工作区 UI。 */
export function useWorkspaceBootstrap(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function bootstrap(): Promise<void> {
      await restoreWorkspaceState(createWorkspaceBootstrapDeps())
      if (!cancelled) setReady(true)
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  return ready
}
