export * from '../agent-protocol'

import { defineIpcCall } from './contract'
import type {
  AgentApiContract as CoreAgentApiContract,
  AgentCapabilityStatus,
  AgentCommandResult,
  AgentCompactConversationPayload,
  AgentContextUsageSnapshot,
  AgentScope,
  AgentStatus,
  AgentToolModuleStatus,
  ClaudeResultEventData,
  ClaudeStreamEventData,
  ExternalMcpServer,
  ExternalMcpServerSummary,
  ToolConfirmationRequest,
} from '../agent-protocol'
import type { WorkspaceRef } from '../workspace-ref'
import type { AgentConversationConfiguration, AgentRoleSummary } from '../agent-role'
import type { AgentSkillSummary } from '../agent-skill'
import type { AgentProfileRef } from '../agent-profile'

export type AgentSendResourceKind =
  | 'file'
  | 'image'
  | 'file-range'
  | 'folder'
  | 'tab'
  | 'browser'
  | 'android'
  | 'terminal'
  | 'artifact'
  | 'project'
  | 'data-source'
  | 'saved-query'
  | 'data-query'
  | 'data-record'

export interface AgentSendResource {
  id: string
  kind: AgentSendResourceKind
  label: string
  detail?: string
  ref: {
    type: AgentSendResourceKind
    path?: string
    tabId?: string
    workspaceKey?: string | null
    sourceId?: string
    collection?: string
    savedQueryId?: string
    queryId?: string
    recordId?: string
    sourceUrl?: string
    publishedAt?: string
    collectedAt?: string
    executedAt?: string
    total?: number
    returned?: number
    truncated?: boolean
    format?: 'markdown'
    startLine?: number
    endLine?: number
    startColumn?: number
    endColumn?: number
    selectedText?: string
    sourceSnapshot?: string
    snapshotHash?: string
    dirty?: boolean
    mediaType?: AgentImageMediaType
    size?: number
  }
}

export interface AgentSendSkill {
  id: string
  name: string
  label: string
  description?: string
  source?: 'builtin' | 'user' | 'workspace'
}

export type AgentImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

export interface AgentImageAttachment {
  id: string
  name: string
  mediaType: AgentImageMediaType
  /** Raw base64 without a data URL prefix. It is transient and must not enter workspace snapshots. */
  data: string
  size: number
}

export interface AgentConversationContinuity {
  recentMessages: Array<{
    role: 'user' | 'assistant' | 'system'
    text: string
  }>
  tasks: Array<{
    content: string
    status: 'pending' | 'in_progress' | 'completed'
  }>
}

export interface AgentSendMessagePayload {
  message: string
  /** 当前发送对应的运行实例；用于跨项目流事件关联和丢弃过期事件。 */
  runId?: string
  resources?: AgentSendResource[]
  skills?: AgentSendSkill[]
  images?: AgentImageAttachment[]
  /** 已持久化的 Claude session；主进程在发送前原子恢复，避免 UI 历史与后端脱节。 */
  sessionId?: string | null
  /** 创建 sessionId 时的运行时/API/模型指纹；不匹配时主进程必须拒绝恢复。 */
  sessionCompatibilityFingerprint?: string | null
  /** 当前会话的持久配置；主进程必须解析角色并校验 revision。 */
  configuration?: AgentConversationConfiguration
  /** @deprecated v0.1.14 IPC 兼容字段，只读一版。 */
  profileRef?: AgentProfileRef
  /** 会话绑定的工作空间；Agent cwd 必须跟随会话，而不是全局当前项目。 */
  workspaceRef?: WorkspaceRef
  /** UI 持久化历史生成的有界连续性快照；用于 SDK 压缩或进程恢复后的任务续接。 */
  continuity?: AgentConversationContinuity
}

export type AgentSendMessageInput = string | AgentSendMessagePayload

export type AgentSendMessageArgs =
  | [message: AgentSendMessageInput]
  | [conversationId: string, message: AgentSendMessageInput]

export type AgentSetScopeArgs = [scope: AgentScope] | [conversationId: string, scope: AgentScope]

export type AgentPermissionMode = 'auto' | 'categorized' | 'strict'

export interface AgentErrorEvent {
  message: string
  code?: string
  conversationId?: string
  runId?: string
  operation?: 'message' | 'compact'
}

export interface AgentApiContract extends Omit<CoreAgentApiContract, 'sendMessage'> {
  sendMessage: {
    (message: AgentSendMessageInput): Promise<AgentCommandResult>
    (conversationId: string, message: AgentSendMessageInput): Promise<AgentCommandResult>
  }
}

export const agentIpc = {
  sendMessage: defineIpcCall<AgentSendMessageArgs, AgentCommandResult>('agent:sendMessage'),
  abort: defineIpcCall<[conversationId?: string], void>('agent:abort'),
  getStatus: defineIpcCall<[conversationId?: string], AgentStatus>('agent:getStatus'),
  getContextUsage: defineIpcCall<[conversationId?: string], AgentContextUsageSnapshot | null>(
    'agent:getContextUsage',
  ),
  compactConversation: defineIpcCall<
    [conversationId: string, payload: AgentCompactConversationPayload],
    AgentCommandResult
  >('agent:compactConversation'),
  setScope: defineIpcCall<AgentSetScopeArgs, boolean>('agent:setScope'),
  getScope: defineIpcCall<[conversationId?: string], AgentScope>('agent:getScope'),
  resetSession: defineIpcCall<[conversationId?: string], void>('agent:resetSession'),
  restoreConversation: defineIpcCall<
    [
      conversationId: string,
      sessionId: string | null,
      configuration: AgentConversationConfiguration,
      sessionCompatibilityFingerprint?: string | null,
    ],
    void
  >('agent:restoreConversation'),
  listRoles: defineIpcCall<[], AgentRoleSummary[]>('agent:listRoles'),
  listSkills: defineIpcCall<[], AgentSkillSummary[]>('agent:listSkills'),
  closeConversation: defineIpcCall<[conversationId: string], void>('agent:closeConversation'),
  getCapabilities: defineIpcCall<[], AgentCapabilityStatus[]>('agent:getCapabilities'),
  listToolModules: defineIpcCall<[], AgentToolModuleStatus[]>('agent:listToolModules'),
  setToolModuleEnabled: defineIpcCall<[moduleId: string, enabled: boolean], AgentCommandResult>(
    'agent:setToolModuleEnabled',
  ),
  resolveToolConfirmation: defineIpcCall<
    [id: string, approved: boolean, alwaysAllow?: boolean],
    void
  >('agent:resolveToolConfirmation'),
  getPermissionMode: defineIpcCall<[], AgentPermissionMode>('agent:getPermissionMode'),
  setPermissionMode: defineIpcCall<[mode: AgentPermissionMode], void>('agent:setPermissionMode'),
} as const

export const agentMcpIpc = {
  listServers: defineIpcCall<[], ExternalMcpServer[]>('mcp:listServers'),
  addServer: defineIpcCall<[server: ExternalMcpServer], AgentCommandResult>('mcp:addServer'),
  removeServer: defineIpcCall<[name: string], boolean>('mcp:removeServer'),
  updateServer: defineIpcCall<[name: string, updates: Partial<ExternalMcpServer>], boolean>(
    'mcp:updateServer',
  ),
  reloadConfig: defineIpcCall<[], ExternalMcpServerSummary[]>('mcp:reloadConfig'),
} as const

export const agentIpcEvents = {
  stream: 'agent:stream',
  complete: 'agent:complete',
  error: 'agent:error',
  requestConfirmation: 'agent:requestConfirmation',
} as const

export interface AgentIpcEventPayloads {
  [agentIpcEvents.stream]: ClaudeStreamEventData
  [agentIpcEvents.complete]: ClaudeResultEventData
  [agentIpcEvents.error]: AgentErrorEvent
  [agentIpcEvents.requestConfirmation]: ToolConfirmationRequest
}
