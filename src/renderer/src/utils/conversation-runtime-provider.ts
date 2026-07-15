import type { AgentSendMessageInput } from '@shared/ipc/agent'

export type ConversationRuntimeProviderKind = 'local-agent'

export interface ConversationRuntimeProvider {
  kind: ConversationRuntimeProviderKind
  load?: () => Promise<void>
  send: (content: string) => Promise<boolean>
  abort?: () => Promise<boolean>
}

interface LocalAgentConversationProviderOptions {
  conversationId: string
  isBusy: () => boolean
  setInput: (text: string, conversationId?: string) => void
  addUserMessage: (content: string, conversationId?: string) => void
  addSystemMessage: (content: string, conversationId?: string) => void
  cancelStreaming: (conversationId?: string) => void
  buildSendInput?: (content: string) => AgentSendMessageInput
  sendMessage: (conversationId: string, content: AgentSendMessageInput) => Promise<unknown>
  abortMessage: (conversationId: string) => Promise<void>
}

export function createLocalAgentConversationProvider({
  conversationId,
  isBusy,
  setInput,
  addUserMessage,
  addSystemMessage,
  cancelStreaming,
  buildSendInput,
  sendMessage,
  abortMessage,
}: LocalAgentConversationProviderOptions): ConversationRuntimeProvider {
  return {
    kind: 'local-agent',
    send: async (content) => {
      const text = content.trim()
      if (!text || isBusy()) return false
      setInput('', conversationId)
      addUserMessage(text, conversationId)
      try {
        await sendMessage(conversationId, buildSendInput ? buildSendInput(text) : text)
        return true
      } catch (error) {
        addSystemMessage(`发送失败: ${String(error)}`, conversationId)
        return false
      }
    },
    abort: async () => {
      await abortMessage(conversationId)
      cancelStreaming(conversationId)
      addSystemMessage('已手动中止当前任务', conversationId)
      return true
    },
  }
}
