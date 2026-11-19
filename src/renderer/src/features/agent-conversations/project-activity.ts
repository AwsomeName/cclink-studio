import type { AgentConversationState } from '../../stores/agent-store'

export function getRunningProjectCounts(
  conversations: Record<string, AgentConversationState>,
): Map<string, number> {
  const counts = new Map<string, number>()

  for (const conversation of Object.values(conversations)) {
    const workspaceRef = conversation.runtime.workspaceRef
    const running =
      conversation.loading ||
      conversation.runStatus === 'starting' ||
      conversation.runStatus === 'running' ||
      conversation.runStatus === 'cancelling'
    if (!running || conversation.archivedAt || workspaceRef?.kind !== 'local') continue
    counts.set(workspaceRef.path, (counts.get(workspaceRef.path) ?? 0) + 1)
  }

  return counts
}

/** Pending work includes failed/interrupted runs without misreporting them as running. */
export function conversationNeedsAttention(conversation: AgentConversationState): boolean {
  return (
    !conversation.archivedAt &&
    (conversation.loading ||
      ['starting', 'running', 'cancelling', 'interrupted', 'failed'].includes(
        conversation.runStatus ?? '',
      ))
  )
}
