import type {
  AgentAbortResult,
  AgentCommandResult,
  AgentCompactConversationPayload,
} from '@shared/agent-protocol'
import type { AgentSendMessageInput } from '@shared/ipc/agent'
import type { AgentBackendState, AgentMountedResource } from '../../types'
import type { AgentRunConfigurationReceipt } from '@shared/agent-role'
import {
  useAgentStore,
  type AgentConversationState,
  type AgentRunTerminalReason,
} from '../../stores/agent-store'
import { buildAgentSendPayload, transientMessageResources } from './payload'
import { useTabStore } from '../../stores/tab-store'
import type { Tab } from '../../types'

export type ConversationCommandIgnoreReason =
  | 'empty'
  | 'missing'
  | 'archived'
  | 'busy'
  | 'missing-session'
  | 'aborting'
  | 'no-active-run'

export type ConversationCommandResult =
  | { status: 'accepted'; runId?: string }
  | { status: 'ignored'; reason: ConversationCommandIgnoreReason }
  | { status: 'failed'; error: string; runId?: string }

interface ConversationRunAgentApi {
  sendMessage: (
    conversationId: string,
    message: AgentSendMessageInput,
  ) => Promise<AgentCommandResult>
  abort: (conversationId: string, runId: string) => Promise<AgentAbortResult>
  compactConversation: (
    conversationId: string,
    payload: AgentCompactConversationPayload,
  ) => Promise<AgentCommandResult>
}

interface ConversationRunStore {
  conversations: Record<string, AgentConversationState>
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
  markRunCancelling: (conversationId: string, runId: string) => void
  applyRuntimeRunStatus: (record: NonNullable<AgentAbortResult['run']>) => void
  setBackendState: (state: AgentBackendState, conversationId?: string) => void
  clearTransientResources: (conversationId?: string) => void
  setRunConfigurationReceipt: (receipt: AgentRunConfigurationReceipt) => boolean
  beginContextCompaction: (conversationId?: string) => string
  finishContextCompaction: (
    success: boolean,
    conversationId?: string,
    runId?: string,
    error?: string,
  ) => void
}

interface ConversationRunControllerOptions {
  conversationId: string
  getStore?: () => ConversationRunStore
  getTabs?: () => Tab[]
  agentApi?: ConversationRunAgentApi
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getDefaultAgentApi(): ConversationRunAgentApi {
  return window.cclinkStudio.agent
}

export interface ConversationRunController {
  send: (content: string) => Promise<ConversationCommandResult>
  abort: () => Promise<ConversationCommandResult>
  compact: (instructions: string) => Promise<ConversationCommandResult>
}

export function createConversationRunController({
  conversationId,
  getStore = useAgentStore.getState,
  getTabs = () => useTabStore.getState().tabs,
  agentApi = getDefaultAgentApi(),
}: ConversationRunControllerOptions): ConversationRunController {
  return {
    send: async (content) => {
      const store = getStore()
      const conversation = store.conversations[conversationId]
      if (!conversation) return { status: 'ignored', reason: 'missing' }
      const images = conversation.pendingImages ?? []
      const text = content.trim() || (images.length > 0 ? '请查看我发送的图片。' : '')
      if (!text) return { status: 'ignored', reason: 'empty' }
      if (conversation.archivedAt) return { status: 'ignored', reason: 'archived' }
      if (conversation.loading || conversation.contextCompaction.status === 'compacting') {
        return { status: 'ignored', reason: 'busy' }
      }

      const draftTab = findMountedLoginDraft(conversation, getTabs())
      if (draftTab) {
        const error =
          `“${draftTab.title || '当前浏览器'}”还是未保存的登录草稿，Agent 不能操作。` +
          '请先在浏览器顶部点击“登录完成，保存账号和登录状态”，保存后再发送。'
        store.addSystemMessage(error, conversationId)
        return { status: 'failed', error }
      }

      store.setInput('', conversationId)
      store.addUserMessage(
        text,
        conversationId,
        transientMessageResources(conversation.mountedResources, images),
      )
      const runId = store.beginRun(conversationId)

      try {
        const current = getStore().conversations[conversationId]
        const result = await agentApi.sendMessage(
          conversationId,
          buildAgentSendPayload(text, current, runId),
        )
        if (!result.success) {
          const error = result.error ?? 'Agent 拒绝接收消息'
          store.cancelStreaming(conversationId, 'error', runId)
          store.addSystemMessage(`发送失败: ${error}`, conversationId)
          store.setBackendState('error', conversationId)
          return { status: 'failed', error, runId }
        }
        if (
          !result.configurationReceipt ||
          !store.setRunConfigurationReceipt(result.configurationReceipt)
        ) {
          const error = '本轮 Agent 实际角色配置与当前会话不一致，已请求停止运行'
          const abortResult = await agentApi.abort(conversationId, runId).catch(() => null)
          if (abortResult?.run) store.applyRuntimeRunStatus(abortResult.run)
          if (abortResult?.accepted) {
            store.markRunCancelling(conversationId, runId)
            store.addSystemMessage(`${error}；正在等待 Runtime 退出确认`, conversationId)
          } else {
            store.addSystemMessage(`${error}；但未能确认停止 Runtime`, conversationId)
          }
          return { status: 'failed', error, runId }
        }
        store.clearTransientResources(conversationId)
        return { status: 'accepted', runId }
      } catch (cause) {
        const error = errorMessage(cause)
        store.cancelStreaming(conversationId, 'error', runId)
        store.addSystemMessage(`发送失败: ${error}`, conversationId)
        store.setBackendState('error', conversationId)
        return { status: 'failed', error, runId }
      }
    },

    abort: async () => {
      const store = getStore()
      const conversation = store.conversations[conversationId]
      if (!conversation) return { status: 'ignored', reason: 'missing' }
      if (!conversation.activeRunId) return { status: 'ignored', reason: 'no-active-run' }
      const runId = conversation.activeRunId
      try {
        const result = await agentApi.abort(conversationId, runId)
        if (result.run) store.applyRuntimeRunStatus(result.run)
        if (!result.accepted) {
          const error = result.error ?? '目标任务已不在运行'
          return { status: 'failed', error, runId }
        }
        if (result.run?.status === 'cancelling') {
          store.markRunCancelling(conversationId, runId)
        }
        return { status: 'accepted', runId }
      } catch (cause) {
        const error = errorMessage(cause)
        store.addSystemMessage(`中止失败: ${error}`, conversationId)
        return { status: 'failed', error, runId }
      }
    },

    compact: async (instructions) => {
      const store = getStore()
      const conversation = store.conversations[conversationId]
      if (!conversation) return { status: 'ignored', reason: 'missing' }
      if (conversation.archivedAt) return { status: 'ignored', reason: 'archived' }
      if (conversation.loading || conversation.contextCompaction.status === 'compacting') {
        return { status: 'ignored', reason: 'busy' }
      }
      if (!conversation.sessionId) return { status: 'ignored', reason: 'missing-session' }

      const runId = store.beginContextCompaction(conversationId)
      try {
        const result = await agentApi.compactConversation(conversationId, {
          runId,
          sessionId: conversation.sessionId,
          sessionCompatibilityFingerprint: conversation.sessionCompatibilityFingerprint ?? null,
          configuration: conversation.configuration,
          workspaceRef: conversation.runtime.workspaceRef,
          instructions: instructions.trim() || undefined,
        })
        if (!result.success) {
          const error = result.error ?? '未知错误'
          store.finishContextCompaction(false, conversationId, runId, error)
          store.addSystemMessage(`上下文压缩失败: ${error}`, conversationId)
          return { status: 'failed', error, runId }
        }
        return { status: 'accepted', runId }
      } catch (cause) {
        const error = errorMessage(cause)
        store.finishContextCompaction(false, conversationId, runId, error)
        store.addSystemMessage(`上下文压缩失败: ${error}`, conversationId)
        return { status: 'failed', error, runId }
      }
    },
  }
}

function findMountedLoginDraft(conversation: AgentConversationState, tabs: Tab[]): Tab | null {
  const browserTabIds = new Set<string>()
  if (conversation.scope.kind === 'browser') {
    browserTabIds.add(conversation.scope.instanceId)
  }
  for (const resource of conversation.mountedResources) {
    if ((resource.kind === 'browser' || resource.ref.type === 'browser') && resource.ref.tabId) {
      browserTabIds.add(resource.ref.tabId)
    }
  }
  return (
    tabs.find(
      (tab) =>
        tab.type === 'browser' && Boolean(tab.webResourceDraftRef) && browserTabIds.has(tab.id),
    ) ?? null
  )
}
