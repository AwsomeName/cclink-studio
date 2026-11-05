import type {
  AgentAbortResult,
  AgentCommandResult,
  AgentCompactConversationPayload,
} from '@shared/agent-protocol'
import type { AgentSendMessageInput, AgentApiContract } from '@shared/ipc/agent'
import type { AgentMessageImageAsset } from '@shared/image-attachment'
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
import { conversationQueueContextKey, type QueuedAgentMessage } from './conversation-state'
import { followUpUnavailableReason } from './follow-up-actions'

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
  | { status: 'queued'; messageId: string }
  | { status: 'ignored'; reason: ConversationCommandIgnoreReason }
  | { status: 'failed'; error: string; runId?: string }

interface ConversationRunAgentApi {
  supplement?: AgentApiContract['supplement']
  saveMessageImages: AgentApiContract['saveMessageImages']
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
  beginSupplement: (content: string, conversationId: string, runId: string) => string | null
  finishSupplement: (
    messageId: string,
    result: import('@shared/agent-protocol').AgentSupplementResult,
    conversationId: string,
  ) => void
  setQueuedMessageDispatchId: (id: string | null, conversationId: string) => void
  enqueueMessage: (content: string, conversationId: string) => string | null
  enqueueReplacement: (content: string, conversationId: string) => string | null
  removeQueuedMessage: (id: string, conversationId: string) => void
  setMessageQueuePauseReason: (reason: string | null, conversationId: string) => void
  restoreFailedMessage: (
    content: string,
    snapshot: AgentConversationState,
    conversationId: string,
  ) => void
  setMessageImageAssets: (conversationId: string, assets: AgentMessageImageAsset[]) => void
  conversations: Record<string, AgentConversationState>
  setInput: (text: string, conversationId?: string) => void
  addUserMessage: (
    content: string,
    conversationId?: string,
    resources?: AgentMountedResource[],
  ) => void
  addSystemMessage: (content: string, conversationId?: string) => void
  beginRun: (conversationId?: string, supplementContextKey?: string) => string
  cancelStreaming: (
    conversationId?: string,
    reason?: AgentRunTerminalReason,
    runId?: string,
  ) => void
  markRunCancelling: (conversationId: string, runId: string) => void
  applyRuntimeRunStatus: (record: NonNullable<AgentAbortResult['run']>) => void
  setBackendState: (state: AgentBackendState, conversationId?: string) => void
  clearTransientResources: (conversationId?: string, consumedIds?: string[]) => void
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
  sendQueued: (item: QueuedAgentMessage) => Promise<ConversationCommandResult>
  abort: () => Promise<ConversationCommandResult>
  stopAndSend: (content: string) => Promise<ConversationCommandResult>
  supplement: (content: string) => Promise<ConversationCommandResult>
  compact: (instructions: string) => Promise<ConversationCommandResult>
}

const pendingSends = new Set<string>()

export function isConversationSendPending(conversationId: string): boolean {
  return pendingSends.has(conversationId)
}

export function createConversationRunController({
  conversationId,
  getStore = useAgentStore.getState,
  getTabs = () => useTabStore.getState().tabs,
  agentApi = getDefaultAgentApi(),
}: ConversationRunControllerOptions): ConversationRunController {
  const send = async (
    content: string,
    queued?: QueuedAgentMessage,
    forceQueue = false,
  ): Promise<ConversationCommandResult> => {
    const store = getStore()
    const current = store.conversations[conversationId]
    const conversation =
      current && queued
        ? {
            ...current,
            mountedResources: queued.mountedResources,
            pendingImages: queued.pendingImages,
          }
        : current
    if (!conversation) return { status: 'ignored', reason: 'missing' }
    const images = conversation.pendingImages ?? []
    const text = content.trim() || (images.length > 0 ? '请查看我发送的图片。' : '')
    if (!text) return { status: 'ignored', reason: 'empty' }
    if (conversation.archivedAt) return { status: 'ignored', reason: 'archived' }
    if (queued && conversation.queuedMessages?.[0]?.id !== queued.id)
      return { status: 'ignored', reason: 'missing' }
    if (
      !queued &&
      (forceQueue ||
        conversation.loading ||
        conversation.contextCompaction.status === 'compacting' ||
        conversation.queuedMessages?.length ||
        conversation.messageQueuePauseReason)
    ) {
      const messageId = store.enqueueMessage(text, conversationId)
      return messageId
        ? { status: 'queued', messageId }
        : { status: 'failed', error: '队列已满（最多 20 条），请处理后再发送' }
    }
    if (queued && (conversation.loading || conversation.contextCompaction.status === 'compacting'))
      return { status: 'ignored', reason: 'busy' }
    if (
      queued?.afterCancellation &&
      (queued.afterCancellation.phase !== 'ready' || conversation.runStatus !== 'cancelled')
    )
      return { status: 'failed', error: '原任务停止状态已变化，新消息已保留，请核对后继续' }
    if (
      queued &&
      (queued.missingImages || queued.contextKey !== conversationQueueContextKey(conversation))
    ) {
      return {
        status: 'failed',
        error: queued.missingImages
          ? '图片附件需重新添加，请移回输入框编辑后重新排队'
          : '角色、技能、操作目标或运行环境已变化，请移回输入框确认后重新排队',
      }
    }

    const draftTab = findMountedLoginDraft(conversation, getTabs())
    if (draftTab) {
      const error =
        `“${draftTab.title || '当前浏览器'}”还是未保存的登录草稿，Agent 不能操作。` +
        '请先在浏览器顶部点击“登录完成，保存账号和登录状态”，保存后再发送。'
      store.addSystemMessage(error, conversationId)
      return { status: 'failed', error }
    }

    if (!queued) store.setInput('', conversationId)
    store.addUserMessage(
      text,
      conversationId,
      transientMessageResources(conversation.mountedResources, images),
    )
    // A queued item owns its resource snapshot; a later draft must not become this Run's context.
    const runId = queued
      ? store.beginRun(
          conversationId,
          JSON.stringify([
            conversationQueueContextKey(conversation),
            conversation.mountedResources.filter((resource) => resource.kind !== 'file-range'),
          ]),
        )
      : store.beginRun(conversationId)
    const consumedIds = [
      ...images.map((image) => image.id),
      ...conversation.mountedResources
        .filter((resource) => resource.kind === 'file-range')
        .map((resource) => resource.id),
    ]
    if (!queued) store.clearTransientResources(conversationId, consumedIds)
    const restoreFailed = (): void => {
      if (!queued) store.restoreFailedMessage(text, conversation, conversationId)
      store.setMessageQueuePauseReason('发送失败，请检查后继续队列', conversationId)
    }

    try {
      const payload = buildAgentSendPayload(
        text,
        {
          ...getStore().conversations[conversationId],
          mountedResources: conversation.mountedResources,
          pendingImages: images,
        },
        runId,
      )
      if (images.length > 0) {
        const saved = await agentApi.saveMessageImages(conversationId, images).catch(() => ({
          success: false as const,
          error: '图片附件保存失败，当前会话仍可预览，重启后可能无法恢复',
        }))
        if (saved.success) store.setMessageImageAssets(conversationId, saved.assets)
        else store.addSystemMessage(saved.error, conversationId)
      }
      const result = await agentApi.sendMessage(conversationId, payload)
      if (!result.success) {
        const error = result.error ?? 'Agent 拒绝接收消息'
        store.cancelStreaming(conversationId, 'error', runId)
        store.addSystemMessage(`发送失败: ${error}`, conversationId)
        store.setBackendState('error', conversationId)
        restoreFailed()
        return { status: 'failed', error, runId }
      }
      if (
        !result.configurationReceipt ||
        !store.setRunConfigurationReceipt(result.configurationReceipt)
      ) {
        const error = '本轮 Agent 实际角色配置与当前会话不一致，已请求停止运行'
        store.setMessageQueuePauseReason(error, conversationId)
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
      if (queued) {
        store.setQueuedMessageDispatchId(null, conversationId)
        store.removeQueuedMessage(queued.id, conversationId)
      }
      return { status: 'accepted', runId }
    } catch (cause) {
      const error = errorMessage(cause)
      store.cancelStreaming(conversationId, 'error', runId)
      store.addSystemMessage(`发送失败: ${error}`, conversationId)
      store.setBackendState('error', conversationId)
      restoreFailed()
      return { status: 'failed', error, runId }
    }
  }
  const guardedSend = async (
    content: string,
    item?: QueuedAgentMessage,
  ): Promise<ConversationCommandResult> => {
    // Enqueue remains available while an IPC acceptance is pending.
    if (item && pendingSends.has(conversationId)) return { status: 'ignored', reason: 'busy' }
    const ownsGuard = !pendingSends.has(conversationId)
    if (ownsGuard) pendingSends.add(conversationId)
    if (item) getStore().setQueuedMessageDispatchId(item.id, conversationId)
    try {
      return await send(content, item, !ownsGuard)
    } finally {
      if (ownsGuard) pendingSends.delete(conversationId)
      if (ownsGuard) getStore().setQueuedMessageDispatchId(null, conversationId)
    }
  }
  return {
    send: (content) => guardedSend(content),
    sendQueued: (item) => guardedSend(item.content, item),
    supplement: async (content) => {
      const current = getStore().conversations[conversationId]
      if (!current?.activeRunId || !current.loading)
        return { status: 'ignored', reason: 'no-active-run' }
      const latest = getStore().conversations[conversationId]
      const reason = followUpUnavailableReason(latest, 'supplement')
      if (reason || latest.activeRunId !== current.activeRunId)
        return { status: 'failed', error: reason ?? '原任务已结束或切换' }
      const text = content.trim()
      if (!text || !agentApi.supplement)
        return { status: 'failed', error: '补充消息为空或当前 Runtime 不支持' }
      const runId = current.activeRunId
      const messageId = getStore().beginSupplement(text, conversationId, runId)
      if (!messageId) return { status: 'ignored', reason: 'busy' }
      try {
        const result = await agentApi.supplement(conversationId, {
          runId,
          messageId,
          content: text,
        })
        getStore().finishSupplement(messageId, result, conversationId)
        return result.status === 'received'
          ? { status: 'accepted', runId }
          : {
              status: 'failed',
              error: result.error ?? '补充接收未确认；消息内容保留在历史中',
              runId,
            }
      } catch (cause) {
        const error = `补充接收未确认：${errorMessage(cause)}`
        getStore().finishSupplement(messageId, { status: 'unknown', error }, conversationId)
        return { status: 'failed', error, runId }
      }
    },
    stopAndSend: async (content) => {
      const store = getStore()
      const current = store.conversations[conversationId]
      const text = content.trim() || (current?.pendingImages?.length ? '请查看我发送的图片。' : '')
      if (!text) return { status: 'ignored', reason: 'empty' }
      if (!current?.activeRunId) return { status: 'ignored', reason: 'no-active-run' }
      if (pendingSends.has(conversationId)) return { status: 'ignored', reason: 'busy' }
      const runId = current.activeRunId
      const messageId = store.enqueueReplacement(text, conversationId)
      if (!messageId)
        return {
          status: 'failed',
          error: '当前不能停止后执行，请等待任务启动完成或处理已有待发送消息',
        }
      try {
        const result = await agentApi.abort(conversationId, runId)
        if (result.run) store.applyRuntimeRunStatus(result.run)
        if (!result.accepted) {
          const error = result.error ?? '停止未确认，新消息已保留，请检查后手动继续'
          store.setMessageQueuePauseReason(error, conversationId)
          return { status: 'failed', error, runId }
        }
        return { status: 'queued', messageId }
      } catch (cause) {
        const error = `停止未确认，新消息已保留：${errorMessage(cause)}`
        store.setMessageQueuePauseReason(error, conversationId)
        return { status: 'failed', error, runId }
      }
    },
    abort: async () => {
      const store = getStore()
      const conversation = store.conversations[conversationId]
      if (!conversation) return { status: 'ignored', reason: 'missing' }
      if (!conversation.activeRunId) return { status: 'ignored', reason: 'no-active-run' }
      const runId = conversation.activeRunId
      if (conversation.queuedMessages?.length)
        store.setMessageQueuePauseReason('已手动停止，请确认后继续队列', conversationId)
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
