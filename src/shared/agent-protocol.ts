export interface PlaywrightAction {
  type:
    | 'navigate'
    | 'click'
    | 'fill'
    | 'screenshot'
    | 'extract'
    | 'select'
    | 'check'
    | 'uncheck'
    | 'press'
    | 'waitForSelector'
    | 'evaluate'
    | 'goBack'
    | 'goForward'
    | 'reload'
    | 'title'
    | 'inputValue'
  [key: string]: any
}

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
  subtype?: string
  session_id?: string
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
  subtype: string
  is_error: boolean
  duration_ms: number
  result?: string
  session_id: string
  total_cost_usd: number
}

export type AgentScope =
  | { kind: 'all' }
  | { kind: 'android' }
  | { kind: 'editor' }
  | { kind: 'browser'; instanceId: string }

export interface ToolConfirmationRequest {
  id: string
  conversationId?: string
  toolName: string
  params: Record<string, unknown>
  riskLevel: 'read' | 'write' | 'destructive'
}

export type AgentCapabilityName =
  | 'agent-backend'
  | 'browser'
  | 'editor'
  | 'android'
  | 'agent-device'
  | 'meshy'
  | 'cclink'
  | 'mcp'

export interface AgentCapabilityStatus {
  name: AgentCapabilityName
  label: string
  available: boolean
  reason?: string
}

export interface AgentCommandResult {
  success: boolean
  error?: string
}

export interface AgentStatus {
  connected: boolean
  /** 当前会话是否仍有一轮 Agent 查询在执行。 */
  busy?: boolean
  /** 当前正在执行的运行实例。 */
  runId?: string | null
  sessionId: string | null
  ready?: boolean
}

export interface AgentPlaywrightActionResult {
  success: boolean
  data?: any
  error?: string
}

export interface AgentCapabilityCheckResult {
  name: string
  pass: boolean
  error?: string
}

export interface AgentPlaywrightStatus {
  connected: boolean
  pageUrl: string | null
}

export interface ExternalMcpServer {
  name: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled: boolean
}

export interface ExternalMcpServerSummary {
  name: string
  transport: 'stdio' | 'http' | 'sse'
  enabled: boolean
}

export interface AgentApiContract {
  sendMessage: {
    (message: string): Promise<AgentCommandResult>
    (conversationId: string, message: string): Promise<AgentCommandResult>
  }
  abort(conversationId?: string): Promise<void>
  getStatus(conversationId?: string): Promise<AgentStatus>
  setScope: {
    (scope: AgentScope): Promise<boolean>
    (conversationId: string, scope: AgentScope): Promise<boolean>
  }
  getScope(conversationId?: string): Promise<AgentScope>
  resetSession(conversationId?: string): Promise<void>
  restoreConversation(conversationId: string, sessionId: string | null): Promise<void>
  closeConversation(conversationId: string): Promise<void>

  onStreamEvent(callback: (event: ClaudeStreamEventData) => void): () => void
  onComplete(callback: (result: ClaudeResultEventData) => void): () => void
  onError(
    callback: (error: {
      message: string
      code?: string
      conversationId?: string
      runId?: string
    }) => void,
  ): () => void

  executeAction(action: PlaywrightAction): Promise<AgentPlaywrightActionResult>
  verifyCapabilities(): Promise<AgentCapabilityCheckResult[]>
  getPlaywrightStatus(): Promise<AgentPlaywrightStatus>
  getCapabilities(): Promise<AgentCapabilityStatus[]>

  onRequestConfirmation(callback: (request: ToolConfirmationRequest) => void): () => void
  resolveToolConfirmation(id: string, approved: boolean, alwaysAllow?: boolean): Promise<void>
  getPermissionMode(): Promise<'auto' | 'categorized' | 'strict'>
  setPermissionMode(mode: 'auto' | 'categorized' | 'strict'): Promise<void>

  listMcpServers(): Promise<ExternalMcpServer[]>
  addMcpServer(server: ExternalMcpServer): Promise<AgentCommandResult>
  removeMcpServer(name: string): Promise<boolean>
  updateMcpServer(name: string, updates: Partial<ExternalMcpServer>): Promise<boolean>
  reloadMcpConfig(): Promise<ExternalMcpServerSummary[]>
}
