import { conversationQueueContextKey, type AgentConversationState } from './conversation-state'

export const AGENT_FOLLOW_UP = {
  supplement: { id: 'agent.supplementCurrentRun', label: '补充当前任务' },
  replace: { id: 'agent.stopAndSend', label: '停止并执行这条' },
} as const

export type FollowUpAction = keyof typeof AGENT_FOLLOW_UP

export function followUpUnavailableReason(
  conversation: AgentConversationState | undefined,
  action: FollowUpAction,
): string | null {
  if (!conversation || conversation.archivedAt) return '会话已不存在或已归档'
  if (conversation.runtime.location !== 'local') return '此远程会话暂不支持此操作'
  if (conversation.runtimeBinding?.kind === 'acp')
    return '此 Codex ACP 会话尚未提供已验证的补充和停止确认能力'
  if (!conversation.activeRunId || !conversation.loading) return '原任务已结束'
  if (conversation.runStatus === 'cancelling') return '正在等待停止确认'
  if (conversation.runStatus === 'starting') return '正在启动任务，请稍候'
  if (conversation.contextCompaction.status === 'compacting') return '上下文压缩期间暂不可用'
  if (!conversation.input.trim() && !conversation.pendingImages?.length) return '请先输入消息'
  if (conversation.queuedMessages?.some((item) => item.afterCancellation))
    return '请先处理已有的停止后执行消息'
  if (action === 'replace' && (conversation.queuedMessages?.length ?? 0) >= 20)
    return '待发送队列已满'
  if (action === 'supplement') {
    if (conversation.input.trim().length > 8192) return '补充内容最多 8192 个字符，请精简后发送'
    if (!conversation.supplementSupported) return '当前 Runtime 尚未提供补充接收确认能力'
    if (
      conversation.pendingImages?.length ||
      conversation.mountedResources.some((resource) => resource.kind === 'file-range')
    )
      return '补充当前任务暂只支持文字；附件可排队或停止后发送'
    if (
      conversation.activeRunSupplementContextKey !==
      JSON.stringify([conversationQueueContextKey(conversation), conversation.mountedResources])
    )
      return '执行上下文已变化，请排队或停止后发送'
    if (
      conversation.messages.some(
        (message) =>
          message.supplement &&
          message.supplement.runId === conversation.activeRunId &&
          (message.supplement.status === 'pending' || message.supplement.status === 'unknown'),
      )
    )
      return '上一条补充仍未确认，请核对任务状态'
  }
  return null
}
