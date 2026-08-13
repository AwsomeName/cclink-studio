import type { CclinkFileContent, CclinkTreeNode } from './cclink'
import type { RemoteError } from './remote-error'
import type { RemoteWorkspaceRef } from './workspace-ref'

export interface RemoteCapabilitySet {
  file: { tree: boolean; read: boolean }
}

export interface RemoteStatus {
  ref: RemoteWorkspaceRef
  state: 'online' | 'offline' | 'connecting' | 'unknown'
  endpointName?: string
  agentVersion?: string
  protocolVersion?: string
  compatibility: 'compatible' | 'upgrade-required' | 'unknown'
  workspacePath: string
  capabilities: RemoteCapabilitySet
  remoteError?: RemoteError
}

export interface RemoteFileTreeRequest {
  ref: RemoteWorkspaceRef
  path?: string
  depth?: number
}

export interface RemoteFileReadRequest {
  ref: RemoteWorkspaceRef
  path: string
  startLine?: number
  endLine?: number
}

export interface RemoteFileTreeResult {
  success: boolean
  tree?: CclinkTreeNode
  error?: string
  unavailable?: boolean
  remoteError?: RemoteError
}

export interface RemoteFileReadResult {
  success: boolean
  file?: CclinkFileContent
  error?: string
  unavailable?: boolean
  remoteError?: RemoteError
}

export interface RemoteProvider {
  transport: 'cclink'
  getStatus(ref: RemoteWorkspaceRef): Promise<RemoteStatus>
  listFileTree(request: RemoteFileTreeRequest): Promise<RemoteFileTreeResult>
  readFile(request: RemoteFileReadRequest): Promise<RemoteFileReadResult>
}
