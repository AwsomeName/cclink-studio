import { workspaceRefKey } from '@shared/workspace-ref'
import type { AgentConversationState } from '../../stores/agent-store'

function bounded(value: string): string {
  return value
    .replaceAll(/((?:token|password|cookie|authorization)=)[^\s&]+/gi, '$1[redacted]')
    .slice(0, 500)
}

export function buildAgentConversationContextDiagnosticMarkdown(
  conversation: AgentConversationState,
): string {
  const workspaceKey = conversation.runtime.workspaceRef
    ? workspaceRefKey(conversation.runtime.workspaceRef)
    : null
  return [
    '# CCLink Studio 会话诊断',
    `- conversationId: ${bounded(conversation.id)}`,
    `- workspace: ${bounded(workspaceKey ?? '未绑定')}`,
    `- backend: ${conversation.backendState}`,
    `- runStatus: ${conversation.runStatus ?? 'unknown'}`,
    `- activeRunId: ${bounded(conversation.activeRunId ?? '无')}`,
    `- loading: ${conversation.loading}`,
    `- session: ${conversation.sessionId ? '已存在' : '无'}`,
    `- messages: ${conversation.messages.length}`,
    `- updatedAt: ${new Date(conversation.updatedAt).toISOString()}`,
    '- 说明：敏感字段和会话凭证不进入此摘要。',
  ].join('\n')
}
