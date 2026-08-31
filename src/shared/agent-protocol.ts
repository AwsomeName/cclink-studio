export interface ClaudeSystemInitEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  model: string
  tools: string[]
}

export interface ClaudeStreamEvent {
  type: 'stream_event'
  event: {
    type: string
    index?: number
    delta?: {
      type: string
      text?: string
      thinking?: string
      partial_json?: string
    }
    content_block?: {
      type: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
    }
    message?: { id: string; role: string; content: unknown[] }
  }
  session_id: string
}

export interface ClaudeAssistantEvent {
  type: 'assistant'
  message: {
    id: string
    role: 'assistant'
    content: Array<{
      type: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      input?: unknown
    }>
  }
  session_id: string
}

export interface ClaudeUserEvent {
  type: 'user'
  message: {
    id?: string
    role: 'user'
    content: Array<{
      type: string
      tool_use_id?: string
      content?: unknown
      is_error?: boolean
    }>
  }
  session_id: string
}

export interface ClaudeResultEvent {
  type: 'result'
  subtype: string
  is_error: boolean
  duration_ms: number
  num_turns: number
  result?: string
  session_id: string
  total_cost_usd: number
}

export type ClaudeEvent =
  | ClaudeSystemInitEvent
  | ClaudeStreamEvent
  | ClaudeAssistantEvent
  | ClaudeUserEvent
  | ClaudeResultEvent

export interface ClaudeStreamEventData {
  type: string
  conversationId?: string
  runId?: string
  /** Runtime/API/model compatibility identity for safely persisting SDK sessions. */
  sessionCompatibilityFingerprint?: string | null
  operation?: 'message' | 'compact'
  subtype?: string
  session_id?: string
  status?: 'compacting' | 'requesting' | null
  compact_result?: 'success' | 'failed'
  compact_error?: string
  compact_metadata?: {
    trigger: 'manual' | 'auto'
    pre_tokens: number
    post_tokens?: number
  }
  contextUsage?: AgentContextUsageSnapshot
  event?: {
    type: string
    index?: number
    delta?: { type: string; text?: string; thinking?: string; partial_json?: string }
    content_block?: {
      type: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
    }
    message?: { id: string; role: string; content: unknown[] }
  }
  message?: ClaudeAssistantEvent['message'] | ClaudeUserEvent['message']
}

export interface ClaudeResultEventData {
  conversationId?: string
  runId?: string
  operation?: 'message' | 'compact'
  subtype: string
  is_error: boolean
  duration_ms: number
  result?: string
  session_id: string
  total_cost_usd: number
}

export interface StudioAgentStreamEventData {
  protocol: 'studio-agent-event-v1'
  conversationId?: string
  runId?: string
  sessionCompatibilityFingerprint?: string | null
  event: {
    type: 'session' | 'text-delta' | 'thought-delta' | 'tool' | 'notice'
    [key: string]: unknown
  }
}

export interface StudioAgentResultEventData {
  protocol: 'studio-agent-event-v1'
  conversationId?: string
  runId?: string
  sessionCompatibilityFingerprint?: string | null
  result?: string
  session_id?: string
  is_error?: boolean
  event: {
    type: 'complete'
    [key: string]: unknown
  }
}

export type AgentScope =
  | { kind: 'all' }
  | { kind: 'android' }
  | { kind: 'editor' }
  | { kind: 'browser'; instanceId: string }

export interface ToolConfirmationRequest {
  id: string
  conversationId?: string
  runId?: string
  toolName: string
  summary: ToolConfirmationSummaryRow[]
  riskLevel: 'read' | 'write' | 'destructive'
  /** false 表示该操作每次都必须单独确认。 */
  allowAlways?: boolean
}

export interface ToolConfirmationSummaryRow {
  label: string
  value: string
  monospace?: boolean
}

export type AgentCapabilityName =
  | 'agent-backend'
  | 'browser'
  | 'editor'
  | 'terminal'
  | 'android'
  | 'agent-device'
  | 'meshy'
  | 'image-generation'
  | 'data-source'
  | 'hardware'
  | 'cad'
  | 'cclink'
  | 'scheduled-task'
  | 'mcp'

export type AgentCapabilityState = 'ready' | 'degraded' | 'unavailable' | 'failed'

export interface AgentCapabilityStatus {
  name: AgentCapabilityName
  label: string
  state: AgentCapabilityState
  /** 兼容旧 renderer；仅 ready 状态为 true。 */
  available: boolean
  reason?: string
  updatedAt: number
}

export interface AgentCommandResult {
  success: boolean
  error?: string
  configurationReceipt?: import('./agent-role').AgentRunConfigurationReceipt
}

export type AgentRuntimeRunStatus = 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'

/** 主进程持久拥有的单轮运行事实；不包含消息正文、凭证或原生 Session ID。 */
export interface AgentRuntimeRunRecord {
  conversationId: string
  runId: string
  status: AgentRuntimeRunStatus
  workspaceKey: string | null
  startedAt: number
  updatedAt: number
  completedAt: number | null
  errorCode?: string
  errorMessage?: string
}

export interface AgentAbortResult {
  accepted: boolean
  run: AgentRuntimeRunRecord | null
  error?: string
}

export interface AgentContextUsageCategory {
  name: string
  tokens: number
  color?: string
  isDeferred?: boolean
}

/** Claude Agent SDK 返回的当前上下文窗口真实占用快照。 */
export interface AgentContextUsageSnapshot {
  totalTokens: number
  maxTokens: number
  rawMaxTokens: number
  percentage: number
  model: string
  categories: AgentContextUsageCategory[]
  autoCompactThreshold: number | null
  isAutoCompactEnabled: boolean
  capturedAt: number
}

export interface AgentCompactConversationPayload {
  runId?: string
  sessionId: string
  sessionCompatibilityFingerprint?: string | null
  configuration: import('./agent-role').AgentConversationConfiguration
  workspaceRef?: import('./workspace-ref').WorkspaceRef
  instructions?: string
}

export interface AgentStatus {
  connected: boolean
  /** 当前会话是否仍有一轮 Agent 查询在执行。 */
  busy?: boolean
  /** 当前正在执行的运行实例。 */
  runId?: string | null
  sessionId: string | null
  runtimeBinding?: import('./agent-runtime').AgentRuntimeBinding
  /** Runtime/API/model identity that must match before restoring sessionId. */
  sessionCompatibilityFingerprint?: string | null
  /** Built-in role configuration currently bound to this conversation. */
  conversationConfiguration?: import('./agent-role').AgentConversationConfiguration
  /** Version of the trusted main-process compiler that injects the role prompt. */
  profilePromptCompilerVersion?: number
  /** Safe, path-free facts for status UI and copied diagnostics. */
  runtimeProvenance?: import('./claude-runtime').ClaudeRuntimeProvenance | null
  /** Process-local random reference for redacted diagnostic correlation. */
  sessionRef?: string | null
  ready?: boolean
  /** Claude 原生调度封锁的安全诊断；不包含用户命令或文件正文。 */
  nativeSchedulingPolicy?: {
    enforced: boolean
    policyVersion?: number
    deniedToolCount: number
    loopSkillDisabled: boolean
    sdkSkillOverride: 'off'
    preToolUseGuard: boolean
  }
}

export interface ExternalMcpCredentialInput {
  env?: Record<string, string>
  headers?: Record<string, string>
}

/** Renderer -> main mutation input. Secret values are accepted only on this write path. */
export interface ExternalMcpServerInput {
  name: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  enabled: boolean
  /** undefined preserves an existing revision; null explicitly clears it. */
  credentials?: ExternalMcpCredentialInput | null
}

/** Main -> Renderer projection. It must never contain env/header values or a credentialRef. */
export interface ExternalMcpServer {
  serverId: string
  name: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  url?: string
  enabled: boolean
  credentialConfigured: boolean
  credentialMissing: boolean
  envKeys: string[]
  headerNames: string[]
}

export interface ExternalMcpServerSummary {
  name: string
  transport: 'stdio' | 'http' | 'sse'
  enabled: boolean
}

export type AgentToolRisk = 'read' | 'write' | 'destructive'

export interface AgentToolSummary {
  name: string
  description: string
  risk: AgentToolRisk
}

export interface AgentToolModuleStatus {
  id: string
  label: string
  description: string
  enabled: boolean
  available: boolean
  reason?: string
  toolCount: number
  tools: AgentToolSummary[]
}

export interface AgentApiContract {
  sendMessage: {
    (message: string): Promise<AgentCommandResult>
    (conversationId: string, message: string): Promise<AgentCommandResult>
  }
  abort(conversationId: string, runId: string): Promise<AgentAbortResult>
  getStatus(conversationId?: string): Promise<AgentStatus>
  getRunStatus(conversationId: string, runId: string): Promise<AgentRuntimeRunRecord | null>
  setScope: {
    (scope: AgentScope): Promise<boolean>
    (conversationId: string, scope: AgentScope): Promise<boolean>
  }
  getScope(conversationId?: string): Promise<AgentScope>
  resetSession(conversationId?: string): Promise<void>
  restoreConversation(
    conversationId: string,
    sessionId: string | null,
    configuration: import('./agent-role').AgentConversationConfiguration,
    sessionCompatibilityFingerprint?: string | null,
    skills?: import('./agent-role').AgentSkillRef[],
    runtimeBinding?: import('./agent-runtime').AgentRuntimeBinding,
    workspaceRef?: import('./workspace-ref').WorkspaceRef,
  ): Promise<void>
  listRoles(): Promise<import('./agent-role').AgentRoleSummary[]>
  listSkills(): Promise<import('./agent-skill').AgentSkillSummary[]>
  closeConversation(conversationId: string): Promise<void>
  getContextUsage(conversationId?: string): Promise<AgentContextUsageSnapshot | null>
  compactConversation(
    conversationId: string,
    payload: AgentCompactConversationPayload,
  ): Promise<AgentCommandResult>

  onStreamEvent(
    callback: (event: ClaudeStreamEventData | StudioAgentStreamEventData) => void,
  ): () => void
  onComplete(
    callback: (result: ClaudeResultEventData | StudioAgentResultEventData) => void,
  ): () => void
  onError(
    callback: (error: {
      message: string
      code?: string
      conversationId?: string
      runId?: string
      operation?: 'message' | 'compact'
    }) => void,
  ): () => void
  onRunStatus(callback: (run: AgentRuntimeRunRecord) => void): () => void

  getCapabilities(): Promise<AgentCapabilityStatus[]>
  listToolModules(): Promise<AgentToolModuleStatus[]>
  setToolModuleEnabled(moduleId: string, enabled: boolean): Promise<AgentCommandResult>

  onRequestConfirmation(callback: (request: ToolConfirmationRequest) => void): () => void
  resolveToolConfirmation(id: string, approved: boolean, alwaysAllow?: boolean): Promise<void>
  getPermissionMode(): Promise<'auto' | 'categorized' | 'strict'>
  setPermissionMode(mode: 'auto' | 'categorized' | 'strict'): Promise<void>

  listMcpServers(): Promise<ExternalMcpServer[]>
  addMcpServer(server: ExternalMcpServerInput): Promise<AgentCommandResult>
  removeMcpServer(name: string): Promise<boolean>
  updateMcpServer(name: string, updates: Partial<ExternalMcpServerInput>): Promise<boolean>
  copyMcpServer(name: string, newName: string): Promise<boolean>
  reloadMcpConfig(): Promise<ExternalMcpServerSummary[]>
}
