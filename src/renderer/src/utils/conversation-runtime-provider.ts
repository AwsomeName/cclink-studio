import type { AgentSendMessageInput } from '@shared/ipc/agent'
import type { AgentRunTerminalReason } from '../stores/agent-store'
import type { AgentMountedResource } from '../types'

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
  addUserMessage: (
    content: string,
    conversationId?: string,
    resources?: AgentMountedResource[],
  ) => void
  addSystemMessage: (content: string, conversationId?: string) => void
  beginRun: (conversationId?: string) => string
  cancelStreaming: (
    conversationId?: string,
    reason?: AgentRunTerminalReason,
    runId?: string,
  ) => void
  setBackendState: (
    state: 'disconnected' | 'connecting' | 'connected' | 'streaming' | 'error',
    conversationId?: string,
  ) => void
  buildSendInput?: (content: string, runId: string) => AgentSendMessageInput
  getMessageResources?: () => AgentMountedResource[]
  clearTransientResources?: () => void
  sendMessage: (conversationId: string, content: AgentSendMessageInput) => Promise<unknown>
  abortMessage: (conversationId: string) => Promise<void>
}

export function createLocalAgentConversationProvider({
  conversationId,
  isBusy,
  setInput,
  addUserMessage,
  addSystemMessage,
  beginRun,
  cancelStreaming,
  setBackendState,
  buildSendInput,
  getMessageResources,
  clearTransientResources,
  sendMessage,
  abortMessage,
}: LocalAgentConversationProviderOptions): ConversationRuntimeProvider {
  return {
    kind: 'local-agent',
    send: async (content) => {
      const text = content.trim()
      if (!text || isBusy()) return false
      setInput('', conversationId)
      const messageResources = getMessageResources?.()
      if (messageResources) addUserMessage(text, conversationId, messageResources)
      else addUserMessage(text, conversationId)
      const runId = beginRun(conversationId)
      try {
        await sendMessage(
          conversationId,
          buildSendInput ? buildSendInput(text, runId) : { message: text, runId },
        )
        clearTransientResources?.()
        return true
      } catch (error) {
        cancelStreaming(conversationId, 'error', runId)
        addSystemMessage(`发送失败: ${String(error)}`, conversationId)
        setBackendState('error', conversationId)
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
