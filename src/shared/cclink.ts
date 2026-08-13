import type { RemoteError } from './remote-error'
import type { CclinkRuntimeMessage } from './cclink-runtime'
export type * from './cclink-runtime'

export interface CclinkIdentity {
  accountUserId: string
  imUserId: string
  clientImUserId: string
  imUserSig: string
  authToken: string
  sdkAppId: number
  deviceId: string
  deviceName: string
  expiresAt?: string | null
  updatedAt: number
}

export interface CclinkWorkspace {
  id: string
  path: string
  name: string
  serverId: string
  kind?: string
  exists?: boolean
}

export interface CclinkServer {
  id: string
  name: string
  hostname: string
  os: string
  status: 'online' | 'offline' | 'connecting'
  agentVersion: string
  protocolVersion?: string
  minProtocolVersion?: string
  capabilities?: Record<string, boolean>
  capabilityList?: string[]
  lastSeen: number
  workspaces: CclinkWorkspace[]
}

export interface CclinkTreeNode {
  id: string
  name: string
  type: 'file' | 'directory'
  path: string
  modifiedByAgent: boolean
  lastModified?: number
  children?: CclinkTreeNode[]
}

export interface CclinkFileContent {
  path: string
  content: string
  totalLines: number
  complete: boolean
  sha256?: string
}

export const CCLINK_PROTOCOL_VERSION = 2
export const CCLINK_MIN_PROTOCOL_VERSION = 2

export type CclinkMessageType =
  | 'user_text'
  | 'stream_start'
  | 'stream_chunk'
  | 'stream_end'
  | 'agent_status'
  | 'agent_text'
  | 'agent_tool'
  | 'terminal_output'
  | 'session_create'
  | 'session_response'
  | 'session_sync_request'
  | 'session_sync_response'
  | 'session_update'
  | 'file_write_request'
  | 'file_write_response'
  | 'file_create_request'
  | 'file_create_response'
  | 'file_rename_request'
  | 'file_rename_response'
  | 'file_delete_request'
  | 'file_delete_response'
  | 'file_mutation_begin_request'
  | 'file_mutation_begin_response'
  | 'file_mutation_chunk_request'
  | 'file_mutation_chunk_response'
  | 'file_mutation_status_request'
  | 'file_mutation_status_response'
  | 'file_mutation_commit_request'
  | 'file_mutation_commit_response'
  | 'file_mutation_abort_request'
  | 'file_mutation_abort_response'
  | 'terminal_pty_open'
  | 'terminal_pty_open_response'
  | 'terminal_pty_input'
  | 'terminal_pty_output'
  | 'terminal_pty_state'
  | 'terminal_pty_exit'
  | 'terminal_pty_resize'
  | 'terminal_pty_resize_response'
  | 'terminal_pty_interrupt'
  | 'terminal_pty_interrupt_response'
  | 'terminal_pty_close'
  | 'terminal_pty_close_response'
  | 'terminal_pty_keepalive'
  | 'terminal_pty_attach'
  | 'terminal_pty_attach_response'
  | 'terminal_pty_error'
  | 'server_meta_request'
  | 'server_meta'
  | 'capability_probe_request'
  | 'capability_probe_response'
  | 'workspace_list_request'
  | 'workspace_list_response'
  | 'file_tree_request'
  | 'file_tree_response'
  | 'file_read_request'
  | 'file_read_response'
  | 'error'

export interface CclinkEnvelope {
  cc_type: CclinkMessageType
  v: number
  min_v: number
  request_id?: string
  trace_id?: string
}

export interface CclinkServerMetaMessage extends CclinkEnvelope {
  cc_type: 'server_meta'
  agent_id: string
  hostname: string
  os: string
  agent_version: string
  protocol_version?: string | number
  min_protocol_version?: string | number
  capabilities?: Record<string, boolean>
  capability_list?: string[]
  workspaces?: Array<{ path: string; name: string; session_count?: number }>
  suggestedWorkspaces?: Array<{ path: string; name: string; kind?: string }>
}

export interface CclinkCapabilityProbeResponseMessage extends CclinkEnvelope {
  cc_type: 'capability_probe_response'
  agent_id?: string
  agentVersion?: string
  agent_version?: string
  protocolVersion?: string | number
  protocol_version?: string | number
  minProtocolVersion?: string | number
  min_protocol_version?: string | number
  capabilities?: {
    file?: Record<string, boolean>
    shell?: Record<string, boolean>
    agent?: Record<string, boolean>
    session?: Record<string, boolean>
  }
  capability_map?: Record<string, boolean>
  capability_list?: string[]
}

export interface CclinkWorkspaceListResponseMessage extends CclinkEnvelope {
  cc_type: 'workspace_list_response'
  agent_id: string
  cursor: string
  next_cursor: string | null
  workspaces: Array<{
    id: string
    name: string
    path: string
    kind: string
    exists: boolean
  }>
}

export interface CclinkFileTreeResponseMessage extends CclinkEnvelope {
  cc_type: 'file_tree_response'
  tree?: CclinkTreeNode
  path?: string
  items?: Array<{ name: string; type: 'file' | 'directory'; has_children?: boolean }>
  error?: string
}

export interface CclinkFileReadResponseMessage extends CclinkEnvelope {
  cc_type: 'file_read_response'
  path: string
  content: string
  total_lines: number
  has_more?: boolean
  content_sha256?: string
  error?: string
}

export interface CclinkErrorMessage extends CclinkEnvelope {
  cc_type: 'error'
  message: string
  error_type?: string
  layer?: RemoteError['layer']
  code?: string
  retryable?: boolean
}

export type CclinkProtocolMessage =
  | CclinkEnvelope
  | CclinkServerMetaMessage
  | CclinkCapabilityProbeResponseMessage
  | CclinkWorkspaceListResponseMessage
  | CclinkFileTreeResponseMessage
  | CclinkFileReadResponseMessage
  | CclinkErrorMessage
  | CclinkRuntimeMessage

const MESSAGE_TYPES = new Set<CclinkMessageType>([
  'user_text',
  'stream_start',
  'stream_chunk',
  'stream_end',
  'agent_status',
  'agent_text',
  'agent_tool',
  'terminal_output',
  'session_create',
  'session_response',
  'session_sync_request',
  'session_sync_response',
  'session_update',
  'file_write_request',
  'file_write_response',
  'file_create_request',
  'file_create_response',
  'file_rename_request',
  'file_rename_response',
  'file_delete_request',
  'file_delete_response',
  'file_mutation_begin_request',
  'file_mutation_begin_response',
  'file_mutation_chunk_request',
  'file_mutation_chunk_response',
  'file_mutation_status_request',
  'file_mutation_status_response',
  'file_mutation_commit_request',
  'file_mutation_commit_response',
  'file_mutation_abort_request',
  'file_mutation_abort_response',
  'terminal_pty_open',
  'terminal_pty_open_response',
  'terminal_pty_input',
  'terminal_pty_output',
  'terminal_pty_state',
  'terminal_pty_exit',
  'terminal_pty_resize',
  'terminal_pty_resize_response',
  'terminal_pty_interrupt',
  'terminal_pty_interrupt_response',
  'terminal_pty_close',
  'terminal_pty_close_response',
  'terminal_pty_keepalive',
  'terminal_pty_attach',
  'terminal_pty_attach_response',
  'terminal_pty_error',
  'server_meta_request',
  'server_meta',
  'capability_probe_request',
  'capability_probe_response',
  'workspace_list_request',
  'workspace_list_response',
  'file_tree_request',
  'file_tree_response',
  'file_read_request',
  'file_read_response',
  'error',
])

export function createCclinkEnvelope<T extends CclinkMessageType>(
  ccType: T,
  extra: Partial<Omit<CclinkEnvelope, 'cc_type'>> = {},
): CclinkEnvelope & { cc_type: T } {
  return {
    cc_type: ccType,
    v: CCLINK_PROTOCOL_VERSION,
    min_v: CCLINK_MIN_PROTOCOL_VERSION,
    ...extra,
  }
}

export function isCclinkMessage(value: unknown): value is CclinkProtocolMessage {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.cc_type === 'string' &&
    MESSAGE_TYPES.has(record.cc_type as CclinkMessageType) &&
    typeof record.v === 'number' &&
    typeof record.min_v === 'number'
  )
}

export function isCclinkProtocolCompatible(message: CclinkEnvelope): boolean {
  return message.v >= CCLINK_MIN_PROTOCOL_VERSION && message.min_v <= CCLINK_PROTOCOL_VERSION
}
