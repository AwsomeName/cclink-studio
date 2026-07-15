import type { AgentConversationState } from '../stores/agent-store'
import type { ResolvedConversationTab } from './conversation-tab'

export type ConversationRuntimeAdapterKind = 'local-agent'

export type ConversationRuntimeAdapterStatus =
  | 'ready'
  | 'busy'
  | 'offline'
  | 'error'
  | 'cached'
  | 'archived'

export interface ConversationRuntimeAdapterMeta {
  kind: ConversationRuntimeAdapterKind
  title: string
  subtitle: string
  chips: string[]
  badge: string
  status: ConversationRuntimeAdapterStatus
}

export interface ConversationRuntimeAdapterUnsupported {
  kind: 'unsupported'
  title: string
  reason: string
}

export type ConversationRuntimeAdapterMetaResult =
  | ConversationRuntimeAdapterMeta
  | ConversationRuntimeAdapterUnsupported

function localStatus(conversation: AgentConversationState): ConversationRuntimeAdapterStatus {
  if (conversation.archivedAt) return 'archived'
  if (conversation.loading || conversation.backendState === 'streaming') return 'busy'
  if (conversation.backendState === 'error') return 'error'
  if (conversation.backendState === 'disconnected') return 'offline'
  return 'ready'
}

function localBadge(status: ConversationRuntimeAdapterStatus): string {
  switch (status) {
    case 'busy':
      return '执行中'
    case 'error':
      return '出错'
    case 'offline':
      return '未连接'
    case 'archived':
      return '已归档'
    case 'ready':
    default:
      return '可对话'
  }
}

function backendLabel(backend: AgentConversationState['runtime']['backend']): string {
  switch (backend) {
    case 'codex':
      return 'Codex'
    case 'claude-code':
      return 'Claude Code'
    case 'custom':
      return '自定义后端'
    case 'deepink-agent':
    default:
      return 'CCLink Studio Agent'
  }
}

export function getLocalAgentConversationMeta(
  conversation: AgentConversationState,
  subtitle: string,
  chips: string[],
): ConversationRuntimeAdapterMeta {
  const status = localStatus(conversation)
  return {
    kind: 'local-agent',
    title: conversation.title === '新会话' ? '新工作会话' : conversation.title,
    subtitle,
    chips: [
      ...chips,
      backendLabel(conversation.runtime.backend),
      ...(conversation.sessionId ? [`Session ${conversation.sessionId.slice(0, 8)}`] : []),
    ],
    badge: localBadge(status),
    status,
  }
}

export function getUnsupportedConversationMeta(
  target: Extract<ResolvedConversationTab, { kind: 'unsupported' }>,
): ConversationRuntimeAdapterUnsupported {
  return {
    kind: 'unsupported',
    title: '这个会话暂时打不开',
    reason: target.reason,
  }
}
