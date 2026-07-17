export * from '../agent-protocol'

import type {
  AgentApiContract as CoreAgentApiContract,
  AgentCommandResult,
} from '../agent-protocol'
import type { WorkspaceRef } from '../workspace-ref'

export type AgentSendResourceKind =
  | 'file'
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
  }
}

export interface AgentSendSkill {
  id: string
  name: string
  label: string
  description?: string
  source?: 'builtin' | 'user' | 'workspace'
}

export interface AgentSendMessagePayload {
  message: string
  /** 当前发送对应的运行实例；用于跨项目流事件关联和丢弃过期事件。 */
  runId?: string
  resources?: AgentSendResource[]
  skills?: AgentSendSkill[]
  /** 已持久化的 Claude session；主进程在发送前原子恢复，避免 UI 历史与后端脱节。 */
  sessionId?: string | null
  /** 会话绑定的工作空间；Agent cwd 必须跟随会话，而不是全局当前项目。 */
  workspaceRef?: WorkspaceRef
}

export type AgentSendMessageInput = string | AgentSendMessagePayload

export interface AgentApiContract extends Omit<CoreAgentApiContract, 'sendMessage'> {
  sendMessage: {
    (message: AgentSendMessageInput): Promise<AgentCommandResult>
    (conversationId: string, message: AgentSendMessageInput): Promise<AgentCommandResult>
  }
}
