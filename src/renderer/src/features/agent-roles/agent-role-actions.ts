import type { AgentRoleRef } from '@shared/agent-role'
import { useAgentStore } from '../../stores/agent-store'

export const AGENT_ROLE_COMMANDS = {
  applyToConversation: 'agent-role.apply-to-conversation',
  setNewConversationDefault: 'agent-role.set-new-conversation-default',
} as const

export type ApplyAgentRoleResult =
  | { ok: true }
  | {
      ok: false
      reason: 'missing-conversation' | 'busy' | 'confirmation-pending' | 'persist-failed'
    }

/**
 * 角色切换的唯一领域入口。Composer 与角色中心都调用它，避免产生第二个状态所有者。
 */
export async function applyAgentRoleToConversation(
  conversationId: string,
  roleRef: AgentRoleRef,
): Promise<ApplyAgentRoleResult> {
  const state = useAgentStore.getState()
  const conversation = state.conversations[conversationId]
  if (!conversation) return { ok: false, reason: 'missing-conversation' }
  if (conversation.loading || conversation.contextCompaction.status === 'compacting') {
    return { ok: false, reason: 'busy' }
  }
  if (state.pendingConfirmations.some((item) => item.conversationId === conversationId)) {
    return { ok: false, reason: 'confirmation-pending' }
  }
  return (await state.applyRoleToConversation(roleRef, conversationId))
    ? { ok: true }
    : { ok: false, reason: 'persist-failed' }
}

export function getApplyAgentRoleError(result: ApplyAgentRoleResult): string | null {
  if (result.ok) return null
  switch (result.reason) {
    case 'missing-conversation':
      return '目标会话不存在'
    case 'busy':
      return 'Agent 正在运行或压缩上下文，完成或中止后才能切换角色'
    case 'confirmation-pending':
      return '当前会话仍有待确认操作，请先处理后再切换角色'
    case 'persist-failed':
      return '角色配置保存失败，原配置已保留'
  }
}
