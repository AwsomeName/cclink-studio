import type { CclinkWorkspace } from '@shared/cclink'
import { remoteWorkspaceRef, type RemoteWorkspaceRef } from '@shared/workspace-ref'

export function remoteWorkspaceRefFromAgent(
  workspace: CclinkWorkspace,
  endpointName?: string,
): RemoteWorkspaceRef {
  if (!workspace.id.trim()) throw new Error('远程 Agent 未返回规范 workspace_id')
  if (!workspace.serverId.trim()) throw new Error('远程 Agent 未返回设备身份')
  if (!workspace.path.trim()) throw new Error('远程 Agent 未返回规范工作空间路径')
  return remoteWorkspaceRef({
    endpointId: workspace.serverId,
    workspaceId: workspace.id,
    path: workspace.path,
    label: workspace.name,
    endpointName,
  })
}

export async function confirmRemoteWorkspaceRef(
  ref: RemoteWorkspaceRef,
): Promise<RemoteWorkspaceRef> {
  const workspace = await window.cclinkStudio.cclink.openWorkspace({
    serverId: ref.endpointId,
    path: ref.path,
  })
  if (workspace.serverId !== ref.endpointId) {
    throw new Error('远程 Agent 返回了不匹配的设备身份')
  }
  return remoteWorkspaceRefFromAgent(workspace, ref.endpointName)
}
