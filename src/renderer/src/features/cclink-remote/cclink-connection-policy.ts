import type { RemoteWorkspaceRef, WorkspaceRef } from '@shared/workspace-ref'
import { useCclinkStore } from '../../stores/cclink-store'
import { useOpenProjectsStore } from '../../stores/open-projects-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

/**
 * 当前远程工作区，或项目条中仍有打开的远程项目，都是恢复 CCLink 实时连接的有效理由。
 * 仅有历史登录状态不是理由。
 */
export function shouldAutoConnectCclink(
  activeWorkspaceRef: WorkspaceRef,
  openRemoteWorkspaceRefs: RemoteWorkspaceRef[],
): boolean {
  return activeWorkspaceRef.kind === 'remote' || openRemoteWorkspaceRefs.length > 0
}

export async function restoreCclinkConnectionForOpenProjects(): Promise<boolean> {
  if (
    !shouldAutoConnectCclink(
      useWorkspaceStore.getState().activeWorkspaceRef,
      useOpenProjectsStore.getState().openRemoteWorkspaceRefs,
    )
  ) {
    return false
  }
  return useCclinkStore.getState().connectRealtime()
}
