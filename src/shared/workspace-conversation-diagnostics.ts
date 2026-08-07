export interface WorkspaceConversationSnapshotSummary {
  orderedConversationCount: number
  storedConversationCount: number
  archivedConversationCount: number
  sessionBackedConversationCount: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  systemMessageCount: number
  streamingMessageCount: number
  textCharacterCount: number
  serializedCharacterCount: number
  activeConversationPresent: boolean
}

/**
 * 只提取会话快照的结构统计，严禁返回标题、正文、路径或 Session ID。
 */
export function summarizeWorkspaceConversationSnapshot(
  value: unknown,
): WorkspaceConversationSnapshotSummary {
  const empty: WorkspaceConversationSnapshotSummary = {
    orderedConversationCount: 0,
    storedConversationCount: 0,
    archivedConversationCount: 0,
    sessionBackedConversationCount: 0,
    messageCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    systemMessageCount: 0,
    streamingMessageCount: 0,
    textCharacterCount: 0,
    serializedCharacterCount: safeSerializedLength(value),
    activeConversationPresent: false,
  }
  if (!value || typeof value !== 'object') return empty

  const snapshot = value as {
    conversations?: unknown
    conversationOrder?: unknown
    activeConversationId?: unknown
  }
  const conversations =
    snapshot.conversations && typeof snapshot.conversations === 'object'
      ? (snapshot.conversations as Record<string, unknown>)
      : {}
  const order = Array.isArray(snapshot.conversationOrder)
    ? snapshot.conversationOrder.filter((id): id is string => typeof id === 'string')
    : []
  const summary = {
    ...empty,
    orderedConversationCount: order.length,
    storedConversationCount: Object.keys(conversations).length,
    activeConversationPresent:
      typeof snapshot.activeConversationId === 'string' &&
      Object.hasOwn(conversations, snapshot.activeConversationId),
  }

  for (const rawConversation of Object.values(conversations)) {
    if (!rawConversation || typeof rawConversation !== 'object') continue
    const conversation = rawConversation as {
      archivedAt?: unknown
      sessionId?: unknown
      messages?: unknown
    }
    if (typeof conversation.archivedAt === 'number') summary.archivedConversationCount += 1
    if (typeof conversation.sessionId === 'string' && conversation.sessionId.length > 0) {
      summary.sessionBackedConversationCount += 1
    }
    if (!Array.isArray(conversation.messages)) continue

    for (const rawMessage of conversation.messages) {
      if (!rawMessage || typeof rawMessage !== 'object') continue
      const message = rawMessage as { role?: unknown; rawText?: unknown; isStreaming?: unknown }
      summary.messageCount += 1
      if (message.role === 'user') summary.userMessageCount += 1
      if (message.role === 'assistant') summary.assistantMessageCount += 1
      if (message.role === 'system') summary.systemMessageCount += 1
      if (message.isStreaming === true) summary.streamingMessageCount += 1
      if (typeof message.rawText === 'string') summary.textCharacterCount += message.rawText.length
    }
  }

  return summary
}

function safeSerializedLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return -1
  }
}
