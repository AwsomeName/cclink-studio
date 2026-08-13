/** CCLink Studio 工作空间引用。产品侧称“工作空间”，工程侧继续使用 workspace。 */
export type WorkspaceRef = LocalWorkspaceRef | RemoteWorkspaceRef | GlobalWorkspaceRef

export type RemoteWorkspaceTransport = 'cclink'

export interface LocalWorkspaceRef {
  kind: 'local'
  path: string
}

export interface RemoteWorkspaceRef {
  kind: 'remote'
  transport: RemoteWorkspaceTransport
  endpointId: string
  workspaceId: string
  path: string
  label?: string
  endpointName?: string
}

export interface GlobalWorkspaceRef {
  kind: 'global'
}

export function localWorkspaceRef(path: string): LocalWorkspaceRef {
  return { kind: 'local', path }
}

export function globalWorkspaceRef(): GlobalWorkspaceRef {
  return { kind: 'global' }
}

export function remoteWorkspaceRef(
  input: Omit<RemoteWorkspaceRef, 'kind' | 'transport'>,
): RemoteWorkspaceRef {
  return { kind: 'remote', transport: 'cclink', ...input }
}

export function workspaceRefKey(ref: WorkspaceRef): string | null {
  switch (ref.kind) {
    case 'local':
      return ref.path
    case 'remote':
      return `${ref.transport}://${encodeURIComponent(ref.endpointId)}/${encodeURIComponent(ref.workspaceId)}`
    case 'global':
      return null
  }
}

export function workspaceRefLabel(ref: WorkspaceRef): string {
  switch (ref.kind) {
    case 'local':
      return ref.path.split('/').filter(Boolean).at(-1) ?? ref.path
    case 'remote':
      return ref.label || ref.path.split(/[\\/]/u).filter(Boolean).at(-1) || ref.path
    case 'global':
      return '未归档'
  }
}

export function workspaceRefSourceLabel(ref: WorkspaceRef): string {
  switch (ref.kind) {
    case 'local':
      return '本地'
    case 'remote':
      return ref.endpointName ? `远程 · CCLink · ${ref.endpointName}` : '远程 · CCLink'
    case 'global':
      return '系统'
  }
}
