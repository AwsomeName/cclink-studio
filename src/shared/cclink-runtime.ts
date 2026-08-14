import type { RemoteError } from './remote-error'

export interface CclinkRemoteSession {
  id: string
  name: string
  workspaceId: string
  workspacePath: string
  serverId: string
  status: 'active' | 'idle' | 'archived'
  createdAt: number
  updatedAt: number
  messageCount: number
  contextUsage: number
}

export type CclinkRemoteMessage =
  | { type: 'user'; id: string; content: string; timestamp: number }
  | { type: 'agentText'; id: string; content: string; timestamp: number }
  | {
      type: 'agentTool'
      id: string
      timestamp: number
      tool: {
        id: string
        name: string
        state: 'pending' | 'executing' | 'completed' | 'failed' | 'denied'
        input?: Record<string, unknown>
        output?: string
        error?: string
        requiresApproval?: boolean
        approvalReason?: string
        expiresAt?: number
        requestId?: string
      }
    }
  | {
      type: 'userQuestion'
      id: string
      timestamp: number
      requestId: string
      toolUseId: string
      questions: Array<{
        id: string
        header?: string
        question: string
        multiSelect?: boolean
        options?: Array<{ label: string; description?: string }>
      }>
      answered?: boolean
    }
  | { type: 'system'; id: string; content: string; timestamp: number; remoteError?: RemoteError }

export interface CclinkRuntimeEnvelope<T extends string = string> {
  cc_type: T
  v: number
  min_v: number
  request_id?: string
  trace_id?: string
}

export interface CclinkSessionCreateMessage extends CclinkRuntimeEnvelope<'session_create'> {
  request_id: string
  session_id: string
  workspace_id: string
  workspace_path: string
  name?: string
  workspace_restricted: true
  project_mode: 'remote_workspace'
}

export interface CclinkSessionResponseMessage extends CclinkRuntimeEnvelope<'session_response'> {
  request_id: string
  session_id: string
  status?: 'ok' | 'error'
  ok?: boolean
  message?: string
  error?: string
  agent_id?: string
  workspace_id?: string
  workspace_path?: string
  workspace_restricted?: boolean
  project_mode?: string
}

export interface CclinkSessionSyncResponseMessage extends CclinkRuntimeEnvelope<'session_sync_response'> {
  sessions: Array<{
    session_id: string
    name?: string
    workspace_id?: string
    workspace_path: string
    project_mode?: 'remote_workspace'
    workspace_restricted?: boolean
    created_at?: number
    last_active_at?: number
    updated_at?: number
    message_count?: number
    context_usage?: number
  }>
}

export interface CclinkUserTextMessage extends CclinkRuntimeEnvelope<'user_text'> {
  agent_id: string
  session_id: string
  workspace_id: string
  workspace_path: string
  project_mode: 'remote_workspace'
  content: string
}

export interface CclinkStreamStartMessage extends CclinkRuntimeEnvelope<'stream_start'> {
  session_id: string
  msg_id: string
}

export interface CclinkStreamChunkMessage extends CclinkRuntimeEnvelope<'stream_chunk'> {
  session_id: string
  msg_id: string
  delta: string
}

export interface CclinkStreamEndMessage extends CclinkRuntimeEnvelope<'stream_end'> {
  session_id: string
  msg_id: string
  exit_code?: number
  code?: string
  error?: string
  final_text?: string
}

export interface CclinkAgentTextMessage extends CclinkRuntimeEnvelope<'agent_text'> {
  session_id: string
  msg_id: string
  content: string
}

export interface CclinkAgentStatusMessage extends CclinkRuntimeEnvelope<'agent_status'> {
  session_id: string
  msg_id: string
  status: string
  code?: string
  message?: string
}

export interface CclinkAgentToolMessage extends CclinkRuntimeEnvelope<'agent_tool'> {
  session_id: string
  msg_id: string
  tool: string
  input?: Record<string, unknown>
  tool_use_id: string
  state: 'pending' | 'executing' | 'completed' | 'failed' | 'denied'
  output?: string
  error?: string
  requires_approval?: boolean
  approval_reason?: string
  expires_at?: number
}

export interface CclinkToolApprovalResponseMessage extends CclinkRuntimeEnvelope<'tool_approval_response'> {
  request_id: string
  session_id: string
  tool_use_id: string
  approved: boolean
  explicit_user_decision: true
}

export interface CclinkToolApprovalAckMessage extends CclinkRuntimeEnvelope<'tool_approval_ack'> {
  request_id: string
  session_id: string
  tool_use_id: string
  approved: boolean
  status: 'accepted'
}

export interface CclinkUserQuestionMessage extends CclinkRuntimeEnvelope<'user_question'> {
  request_id: string
  session_id: string
  msg_id: string
  tool_use_id: string
  questions: Array<{
    id: string
    header?: string
    question: string
    multiSelect?: boolean
    options?: Array<{ label: string; description?: string }>
  }>
}

export interface CclinkQuestionAnswerMessage extends CclinkRuntimeEnvelope<'question_answer'> {
  request_id: string
  session_id: string
  tool_use_id: string
  answers: Record<string, string>
}

export interface CclinkQuestionAnswerAckMessage extends CclinkRuntimeEnvelope<'question_answer_ack'> {
  request_id: string
  session_id: string
  tool_use_id: string
  status: 'accepted'
}

export interface CclinkPermissionRequestMessage extends CclinkRuntimeEnvelope<'permission_request'> {
  request_id: string
  path: string
  operation: string
}

export interface CclinkPermissionResponseMessage extends CclinkRuntimeEnvelope<'permission_response'> {
  request_id: string
  approved: boolean
  remember: boolean
}

export interface CclinkTerminalOutputMessage extends CclinkRuntimeEnvelope<'terminal_output'> {
  session_id: string
  content: string
  exit_code?: number
}

export interface CclinkMutationBase extends CclinkRuntimeEnvelope {
  mutation_v: 1
  request_id: string
  trace_id: string
  operation_id: string
  operation_created_at: number
  operation_expires_at: number
  agent_id: string
  session_id: string
  workspace_id: string
  workspace_path: string
}

export interface CclinkFileWriteRequestMessage extends CclinkMutationBase {
  cc_type: 'file_write_request'
  path: string
  encoding: 'utf8'
  content_base64: string
  total_bytes: number
  content_sha256: string
  expected_sha256: string
}

export interface CclinkFileCreateRequestMessage extends CclinkMutationBase {
  cc_type: 'file_create_request'
  path: string
  kind: 'file' | 'directory'
  overwrite: false
  encoding?: 'utf8'
  content_base64?: string
  total_bytes?: number
  content_sha256?: string
}

export interface CclinkFileRenameRequestMessage extends CclinkMutationBase {
  cc_type: 'file_rename_request'
  source_path: string
  destination_path: string
  overwrite: false
}

export interface CclinkFileDeleteRequestMessage extends CclinkMutationBase {
  cc_type: 'file_delete_request'
  path: string
  recursive: boolean
  expected_sha256?: string
}

export interface CclinkFileTransferRequestBase extends CclinkMutationBase {
  transfer_id: string
}

export interface CclinkFileMutationBeginRequestMessage extends CclinkFileTransferRequestBase {
  cc_type: 'file_mutation_begin_request'
  operation: 'write' | 'create_file'
  path: string
  encoding: 'utf8'
  total_bytes: number
  content_sha256: string
  expected_sha256?: string
  overwrite?: false
  chunk_size: 4096
  chunk_count: number
}

export interface CclinkFileMutationChunkRequestMessage extends CclinkFileTransferRequestBase {
  cc_type: 'file_mutation_chunk_request'
  operation_fingerprint: string
  chunk_index: number
  chunk_count: number
  decoded_bytes: number
  chunk_sha256: string
  content_base64: string
}

export interface CclinkFileMutationControlRequestMessage extends CclinkFileTransferRequestBase {
  cc_type:
    | 'file_mutation_status_request'
    | 'file_mutation_commit_request'
    | 'file_mutation_abort_request'
  operation_fingerprint: string
}

export interface CclinkFileTransferResponseMessage extends CclinkRuntimeEnvelope {
  cc_type:
    | 'file_mutation_begin_response'
    | 'file_mutation_chunk_response'
    | 'file_mutation_status_response'
    | 'file_mutation_commit_response'
    | 'file_mutation_abort_response'
  mutation_v: 1
  request_id: string
  trace_id: string
  operation_id?: string
  transfer_id: string
  status: 'ok' | 'error'
  replayed: boolean
  disk_state: 'unchanged' | 'changed' | 'unknown'
  state: 'unknown' | 'receiving' | 'ready' | 'committing' | 'committed' | 'aborted' | 'expired'
  missing_ranges?: Array<[number, number]>
  result?: { operation: 'write' | 'create'; path: string; size?: number; sha256?: string }
  code?: string
  message?: string
  retryable?: boolean
}

export interface CclinkMutationResponseMessage extends CclinkRuntimeEnvelope {
  cc_type:
    | 'file_write_response'
    | 'file_create_response'
    | 'file_rename_response'
    | 'file_delete_response'
  mutation_v: 1
  status: 'ok' | 'error'
  replayed: boolean
  disk_state: 'unchanged' | 'changed' | 'unknown'
  operation_id?: string
  path?: string
  destination_path?: string
  sha256?: string
  code?: string
  message?: string
  retryable?: boolean
}

export interface CclinkTerminalPtyOpenMessage extends CclinkRuntimeEnvelope<'terminal_pty_open'> {
  agent_id: string
  terminal_id: string
  session_id?: string
  workspace_id: string
  workspace_path: string
  cols: number
  rows: number
  pty_protocol_version: 1
}

export interface CclinkTerminalPtyOpenResponseMessage extends CclinkRuntimeEnvelope<'terminal_pty_open_response'> {
  status: 'ok' | 'error'
  terminal_id: string
  session_id?: string
  agent_id?: string
  workspace_id?: string
  workspace_path?: string
  terminal_seq?: number
  lease_timeout_ms?: number
  pty_protocol_version?: number
  code?: string
  message?: string
}

export interface CclinkTerminalPtyInputMessage extends CclinkRuntimeEnvelope<'terminal_pty_input'> {
  terminal_id: string
  input_seq: number
  data: string
}

export interface CclinkTerminalPtyResizeMessage extends CclinkRuntimeEnvelope<'terminal_pty_resize'> {
  terminal_id: string
  cols: number
  rows: number
}

export interface CclinkTerminalPtyOperationMessage extends CclinkRuntimeEnvelope {
  cc_type: 'terminal_pty_interrupt' | 'terminal_pty_close'
  terminal_id: string
}

export interface CclinkTerminalPtyKeepaliveMessage extends CclinkRuntimeEnvelope<'terminal_pty_keepalive'> {
  terminal_id: string
  last_terminal_seq: number
}

export interface CclinkTerminalPtyAttachMessage extends CclinkRuntimeEnvelope<'terminal_pty_attach'> {
  terminal_id: string
  session_id?: string
  last_terminal_seq: number
}

export interface CclinkTerminalPtyOutputMessage extends CclinkRuntimeEnvelope<'terminal_pty_output'> {
  terminal_id: string
  workspace_id: string
  workspace_path: string
  terminal_seq: number
  data: string
  replay?: boolean
}

export interface CclinkTerminalPtyStateMessage extends CclinkRuntimeEnvelope<'terminal_pty_state'> {
  terminal_id: string
  terminal_seq: number
  state: 'opening' | 'running' | 'closing' | 'exited' | 'error'
  reason?: string
}

export interface CclinkTerminalPtyExitMessage extends CclinkRuntimeEnvelope<'terminal_pty_exit'> {
  terminal_id: string
  terminal_seq: number
  exit_code?: number
  signal?: string
  reason?: string
}

export interface CclinkTerminalPtyErrorMessage extends CclinkRuntimeEnvelope<'terminal_pty_error'> {
  terminal_id: string
  terminal_seq?: number
  code: string
  message: string
}

export interface CclinkTerminalPtyResponseMessage extends CclinkRuntimeEnvelope {
  cc_type:
    | 'terminal_pty_resize_response'
    | 'terminal_pty_interrupt_response'
    | 'terminal_pty_close_response'
    | 'terminal_pty_attach_response'
  status: 'ok' | 'error'
  terminal_id: string
  terminal_seq?: number
  workspace_id?: string
  workspace_path?: string
  replay_from_seq?: number
  replay_truncated?: boolean
  first_available_seq?: number
  code?: string
  message?: string
}

export type CclinkRuntimeMessage =
  | CclinkSessionCreateMessage
  | CclinkSessionResponseMessage
  | CclinkSessionSyncResponseMessage
  | CclinkUserTextMessage
  | CclinkStreamStartMessage
  | CclinkStreamChunkMessage
  | CclinkStreamEndMessage
  | CclinkAgentTextMessage
  | CclinkAgentStatusMessage
  | CclinkAgentToolMessage
  | CclinkToolApprovalResponseMessage
  | CclinkToolApprovalAckMessage
  | CclinkUserQuestionMessage
  | CclinkQuestionAnswerMessage
  | CclinkQuestionAnswerAckMessage
  | CclinkPermissionRequestMessage
  | CclinkPermissionResponseMessage
  | CclinkTerminalOutputMessage
  | CclinkFileWriteRequestMessage
  | CclinkFileCreateRequestMessage
  | CclinkFileRenameRequestMessage
  | CclinkFileDeleteRequestMessage
  | CclinkFileMutationBeginRequestMessage
  | CclinkFileMutationChunkRequestMessage
  | CclinkFileMutationControlRequestMessage
  | CclinkFileTransferResponseMessage
  | CclinkMutationResponseMessage
  | CclinkTerminalPtyOpenMessage
  | CclinkTerminalPtyOpenResponseMessage
  | CclinkTerminalPtyInputMessage
  | CclinkTerminalPtyResizeMessage
  | CclinkTerminalPtyOperationMessage
  | CclinkTerminalPtyKeepaliveMessage
  | CclinkTerminalPtyAttachMessage
  | CclinkTerminalPtyOutputMessage
  | CclinkTerminalPtyStateMessage
  | CclinkTerminalPtyExitMessage
  | CclinkTerminalPtyErrorMessage
  | CclinkTerminalPtyResponseMessage
