import type { ConversationTabRef, Tab } from '../types'

export type ResolvedConversationTab =
  | {
      kind: 'local-agent'
      tabId: string
      conversationId: string
    }
  | {
      kind: 'unsupported'
      tabId: string
      reason: string
    }

function resolveConversationRef(
  tabId: string,
  conversation: ConversationTabRef,
): ResolvedConversationTab {
  if ('runtime' in conversation) {
    const { runtime, sessionId } = conversation

    if (runtime.location === 'local' && runtime.transport === 'local') {
      return {
        kind: 'local-agent',
        tabId,
        conversationId: sessionId,
      }
    }

    return {
      kind: 'unsupported',
      tabId,
      reason: `暂不支持 ${runtime.location}/${runtime.transport} 会话 Tab`,
    }
  }

  if (conversation.kind === 'remote' && conversation.transport === 'cclink') {
    return {
      kind: 'unsupported',
      tabId,
      reason: '开源壳不加载 CCLink 远程会话模块',
    }
  }

  return {
    kind: 'unsupported',
    tabId,
    reason: `暂不支持旧 ${conversation.transport} 远程会话 Tab`,
  }
}

export function resolveConversationTab(tab: Tab): ResolvedConversationTab | null {
  if (tab.type === 'conversation' && tab.conversation) {
    return resolveConversationRef(tab.id, tab.conversation)
  }

  if (tab.type === 'cclink' && tab.cclinkSessionId) {
    return {
      kind: 'unsupported',
      tabId: tab.id,
      reason: '开源壳不加载旧 CCLink 会话模块',
    }
  }

  return null
}
