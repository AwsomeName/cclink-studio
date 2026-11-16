import { workspaceRefKey, type WorkspaceRef } from '@shared/workspace-ref'
import { useTabStore } from '../../stores/tab-store'
import { useUIStore, type AgentPanelModeSource } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

/** Reveal the requested landing page without discarding the workspace's restored tabs. */
export function showWorkspaceHome(
  ref: WorkspaceRef,
  source: AgentPanelModeSource = 'user',
): boolean {
  if (
    ref.kind === 'global' ||
    workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef) !== workspaceRefKey(ref)
  )
    return false
  useUIStore.getState().showPanel('workspace-home')
  if (useUIStore.getState().agentPanelMode === 'center')
    useUIStore.getState().setAgentPanelMode('right', source)
  useTabStore
    .getState()
    .openTab({ type: 'workspace-home', title: '工作台', icon: '⌂', workspaceRef: ref })
  return true
}
