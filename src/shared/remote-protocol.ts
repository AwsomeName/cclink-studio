import type {
  CclinkCapabilityProbeResponseMessage,
  CclinkFileContent,
  CclinkMessageType,
  CclinkRemoteMessage,
  CclinkRemoteSession,
  CclinkTreeNode,
} from './cclink'
import type { RemoteError } from './remote-error'
import type { RemoteWorkspaceRef } from './workspace-ref'

export interface RemoteCapabilitySet {
  file: {
    tree: boolean
    read: boolean
    write: boolean
    create: boolean
    rename: boolean
    delete: boolean
  }
  shell: { pty: boolean }
  agent: { session: boolean; stream: boolean }
}

export interface RemoteStatus {
  ref: RemoteWorkspaceRef
  state: 'online' | 'offline' | 'connecting' | 'unknown'
  endpointName?: string
  agentVersion?: string
  protocolVersion?: string
  runtime?: string
  capabilityProbe?: {
    state: string
    checkedAt?: string
    stale: boolean
    /** Correlated Agent response with runtime diagnostics reduced to the bounded summary. */
    response: CclinkCapabilityProbeResponseMessage
  }
  compatibility: 'compatible' | 'upgrade-required' | 'unknown'
  workspacePath: string
  capabilities: RemoteCapabilitySet
  remoteError?: RemoteError
}

export interface RemoteDiagnosticEvent {
  timestamp: number
  operation: string
  error: RemoteError
}

export interface RemoteDiagnosticCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  remoteError?: RemoteError
}

export interface RemoteDiagnosticReport {
  ref: RemoteWorkspaceRef
  generatedAt: number
  status: RemoteStatus
  checks: RemoteDiagnosticCheck[]
  recentErrors: RemoteDiagnosticEvent[]
  agentSession?: RemoteAgentSessionDiagnosticSnapshot
}

export interface RemoteAgentSessionDiagnosticEvent {
  timestamp: number
  direction: 'inbound' | 'outbound'
  type: CclinkMessageType
  requestId?: string
  traceId?: string
  messageId?: string
  status?: string
  code?: string
  error?: string
  tool?: string
  toolState?: string
  exitCode?: number
  finalState?: string
  payloadTruncated?: boolean
  count?: number
}

export interface RemoteAgentSessionDiagnosticSnapshot {
  session: CclinkRemoteSession
  messages: CclinkRemoteMessage[]
  messageLimit: number
  events: RemoteAgentSessionDiagnosticEvent[]
  eventLimit: number
  processLocalOnly: true
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

export interface RemoteMutationContext {
  ref: RemoteWorkspaceRef
  sessionId: string
  operationId: string
  operationCreatedAt: number
  operationExpiresAt: number
}

export interface RemoteFileWriteRequest extends RemoteMutationContext {
  path: string
  content: string
  expectedSha256: string
}

export interface RemoteFileCreateRequest extends RemoteMutationContext {
  path: string
  type: 'file' | 'directory'
  content?: string
}

export interface RemoteFileRenameRequest extends RemoteMutationContext {
  oldPath: string
  newPath: string
}

export interface RemoteFileDeleteRequest extends RemoteMutationContext {
  path: string
  recursive?: boolean
  expectedSha256?: string
}

export interface RemoteFileTreeResult {
  success: boolean
  tree?: CclinkTreeNode
  /** Agent-owned opaque workspace identity returned by file_tree_response. */
  workspaceId?: string
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

export interface RemoteFileMutationResult {
  success: boolean
  path?: string
  operationId?: string
  replayed?: boolean
  diskState?: 'unchanged' | 'changed' | 'unknown'
  sha256?: string
  error?: string
  unavailable?: boolean
  remoteError?: RemoteError
}

export interface RemoteProvider {
  transport: 'cclink'
  getStatus(ref: RemoteWorkspaceRef): Promise<RemoteStatus>
  diagnose(ref: RemoteWorkspaceRef, sessionId?: string): Promise<RemoteDiagnosticReport>
  listFileTree(request: RemoteFileTreeRequest): Promise<RemoteFileTreeResult>
  readFile(request: RemoteFileReadRequest): Promise<RemoteFileReadResult>
  writeFile(request: RemoteFileWriteRequest): Promise<RemoteFileMutationResult>
  createFile(request: RemoteFileCreateRequest): Promise<RemoteFileMutationResult>
  renameFile(request: RemoteFileRenameRequest): Promise<RemoteFileMutationResult>
  deleteFile(request: RemoteFileDeleteRequest): Promise<RemoteFileMutationResult>
}
