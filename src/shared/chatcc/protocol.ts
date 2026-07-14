import type { ChatccDiffLine, ChatccTreeNode } from './models'
import type { RemoteErrorLayer } from '../remote-error'

export const CHATCC_PROTOCOL_VERSION = 1
export const CHATCC_MIN_PROTOCOL_VERSION = 1

export const CHATCC_MESSAGE_TYPES = [
  'user_text',
  'user_text_chunk',
  'terminal_command',
  'tool_approval_response',
  'question_answer',
  'file_tree_request',
  'file_read_request',
  'file_mkdir_request',
  'file_search_request',
  'session_create',
  'session_update_settings',
  'session_sync_request',
  'claude_session_list_request',
  'permission_response',
  'permission_grant',
  'cancel_generation',
  'clear_request',
  'compact_request',
  'ping',
  'upgrade_agent',
  'client_list',
  'client_remove',
  'stream_start',
  'stream_chunk',
  'stream_end',
  'agent_tool',
  'user_question',
  'terminal_output',
  'server_meta',
  'session_update',
  'permission_request',
  'error',
  'update_available',
  'pair_required',
  'unknown_type_error',
  'version_error',
  'session_response',
  'session_update_settings_response',
  'session_sync_response',
  'claude_session_list_response',
  'file_tree_response',
  'file_read_response',
  'file_mkdir_response',
  'file_search_response',
  'permission_grant_ack',
  'clear_response',
  'compact_response',
  'pong',
  'upgrade_response',
  'client_list_response',
  'client_remove_response',
] as const

export type ChatccMessageType = typeof CHATCC_MESSAGE_TYPES[number]

export interface ChatccEnvelope {
  cc_type: ChatccMessageType
  v: number
  min_v: number
  request_id?: string
  trace_id?: string
}

export interface ChatccSessionScoped {
  session_id: string
}

export interface ChatccUserTextMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'user_text'
  content: string
  images?: string[]
}

export interface ChatccUserTextChunkMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'user_text_chunk'
  chunk_id: string
  chunk_index: number
  chunk_count: number
  content: string
}

export interface ChatccStreamStartMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'stream_start'
  msg_id: string
}

export interface ChatccStreamChunkMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'stream_chunk'
  msg_id: string
  delta: string
}

export interface ChatccStreamEndMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'stream_end'
  msg_id: string
  exit_code?: number
  error?: string
}

export interface ChatccProtocolAgentToolMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'agent_tool'
  msg_id: string
  tool: string
  input?: Record<string, unknown>
  tool_use_id: string
  state: 'pending' | 'executing' | 'completed' | 'failed' | 'denied'
  requires_approval?: boolean
  workspace_violation?: boolean
  diff?: ChatccDiffLine[]
  preview?: string
  output?: string
  summary?: string
  exit_code?: number
  error?: string
}

export interface ChatccToolApprovalResponseMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'tool_approval_response'
  tool_use_id: string
  approved: boolean
}

export interface ChatccUserQuestionMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'user_question'
  msg_id: string
  tool_use_id: string
  questions: Array<{
    id: string
    header?: string
    question: string
    options?: Array<{ label: string; description?: string }>
  }>
}

export interface ChatccQuestionAnswerMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'question_answer'
  tool_use_id: string
  answers: Record<string, string>
}

export interface ChatccTerminalCommandMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'terminal_command'
  content: string
  cwd?: string
}

export interface ChatccTerminalOutputMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'terminal_output'
  content: string
  exit_code?: number
}

export interface ChatccServerMetaMessage extends ChatccEnvelope {
  cc_type: 'server_meta'
  agent_id: string
  hostname: string
  os: string
  agent_version: string
  claude_version?: string
  workspaces?: Array<{ path: string; name: string; session_count?: number }>
}

export interface ChatccSessionCreateMessage extends ChatccEnvelope {
  cc_type: 'session_create'
  session_id: string
  workspace_path: string
  name?: string
  resume_session_id?: string
}

export interface ChatccSessionResponseMessage extends ChatccEnvelope, ChatccSessionScoped {
  cc_type: 'session_response'
  ok: boolean
  error?: string
}

export interface ChatccSessionSyncRequestMessage extends ChatccEnvelope {
  cc_type: 'session_sync_request'
}

export interface ChatccSessionSyncResponseMessage extends ChatccEnvelope {
  cc_type: 'session_sync_response'
  sessions: Array<{
    session_id: string
    name: string
    workspace_path: string
    updated_at: number
    message_count?: number
    context_usage?: number
  }>
}

export interface ChatccFileTreeRequestMessage extends ChatccEnvelope {
  cc_type: 'file_tree_request'
  path: string
  depth?: number
}

export interface ChatccFileTreeResponseMessage extends ChatccEnvelope {
  cc_type: 'file_tree_response'
  tree: ChatccTreeNode
}

export interface ChatccFileReadRequestMessage extends ChatccEnvelope {
  cc_type: 'file_read_request'
  path: string
  start_line?: number
  end_line?: number
}

export interface ChatccFileReadResponseMessage extends ChatccEnvelope {
  cc_type: 'file_read_response'
  path: string
  content: string
  total_lines: number
}

export interface ChatccFileSearchRequestMessage extends ChatccEnvelope {
  cc_type: 'file_search_request'
  pattern: string
  path?: string
}

export interface ChatccFileSearchResponseMessage extends ChatccEnvelope {
  cc_type: 'file_search_response'
  results: Array<{ path: string; line?: number; preview?: string }>
}

export interface ChatccErrorMessage extends ChatccEnvelope {
  cc_type: 'error'
  message: string
  error_type?: string
  layer?: RemoteErrorLayer
  code?: string
  retryable?: boolean
  context?: Record<string, string | number | boolean | null>
  session_id?: string
}

export type ChatccProtocolMessage =
  | ChatccUserTextMessage
  | ChatccUserTextChunkMessage
  | ChatccStreamStartMessage
  | ChatccStreamChunkMessage
  | ChatccStreamEndMessage
  | ChatccProtocolAgentToolMessage
  | ChatccToolApprovalResponseMessage
  | ChatccUserQuestionMessage
  | ChatccQuestionAnswerMessage
  | ChatccTerminalCommandMessage
  | ChatccTerminalOutputMessage
  | ChatccServerMetaMessage
  | ChatccSessionCreateMessage
  | ChatccSessionResponseMessage
  | ChatccSessionSyncRequestMessage
  | ChatccSessionSyncResponseMessage
  | ChatccFileTreeRequestMessage
  | ChatccFileTreeResponseMessage
  | ChatccFileReadRequestMessage
  | ChatccFileReadResponseMessage
  | ChatccFileSearchRequestMessage
  | ChatccFileSearchResponseMessage
  | ChatccErrorMessage

export function createChatccEnvelope<T extends ChatccMessageType>(
  ccType: T,
  extra?: Omit<Partial<ChatccEnvelope>, 'cc_type'>,
): ChatccEnvelope & { cc_type: T } {
  return {
    cc_type: ccType,
    v: CHATCC_PROTOCOL_VERSION,
    min_v: CHATCC_MIN_PROTOCOL_VERSION,
    ...extra,
  }
}

export function isChatccMessage(value: unknown): value is ChatccEnvelope {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.cc_type === 'string' &&
    CHATCC_MESSAGE_TYPES.includes(record.cc_type as ChatccMessageType) &&
    typeof record.v === 'number' &&
    typeof record.min_v === 'number'
  )
}

export function isChatccProtocolCompatible(message: ChatccEnvelope): boolean {
  return message.v >= CHATCC_MIN_PROTOCOL_VERSION && message.min_v <= CHATCC_PROTOCOL_VERSION
}
