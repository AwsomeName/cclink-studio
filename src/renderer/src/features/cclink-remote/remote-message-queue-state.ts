import { imageImportBlockReason } from '../agent-conversations/image-import-jobs'
import type { StateCreator } from 'zustand'
import type { TransientImageAttachment } from '@shared/image-attachment'
import type { CclinkRealtimeEvent, CclinkImageUploadProgress } from '@shared/ipc/cclink'
import { workspaceRefKey, type RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { CclinkState } from '../../stores/cclink-store'
import {
  captureActiveWorkspaceTarget,
  isWorkspaceTargetCurrent,
} from '../../stores/workspace-store'

export interface RemoteQueuedMessage {
  id: string
  content: string
  pendingImages: TransientImageAttachment[]
}

export interface RemoteMessageQueue {
  ref: RemoteWorkspaceRef
  sessionId: string | null
  items: RemoteQueuedMessage[]
  pauseReason: string | null
  dispatchId: string | null
  /** Current manual submission is never a waiting queue item. */
  directSubmission?: RemoteQueuedMessage
  /** A projection of the existing main-process conversation lifecycle, never a timer. */
  awaitingCompletion: boolean
  uploadProgress?: CclinkImageUploadProgress
}

export function remoteAgentComposerKey(ref: RemoteWorkspaceRef, sessionId: string | null): string {
  return JSON.stringify([workspaceRefKey(ref), sessionId])
}

export interface RemoteMessageQueueSlice {
  remoteMessageQueues: Record<string, RemoteMessageQueue>
  submitRemoteAgentDraft(
    ref: RemoteWorkspaceRef,
    sessionId: string | null,
    forceQueue?: boolean,
  ): boolean
  enqueueRemoteAgentDraft(ref: RemoteWorkspaceRef, sessionId: string | null): boolean
  editRemoteQueuedMessage(key: string, id: string): boolean
  removeRemoteQueuedMessage(key: string, id: string): void
  pauseRemoteMessageQueue(key: string, reason: string | null): void
  dispatchRemoteMessage(key: string, signal?: AbortSignal): Promise<void>
}

export function projectRemoteQueueEvent(
  queues: Record<string, RemoteMessageQueue>,
  event: CclinkRealtimeEvent,
): Record<string, RemoteMessageQueue> {
  if (event.type !== 'conversation') return queues
  const entry = Object.entries(queues).find(
    ([, queue]) => queue.sessionId === event.sessionId && queue.ref.endpointId === event.serverId,
  )
  if (!entry) return queues
  const [key, queue] = entry
  const active = event.phase === 'started' || event.phase === 'streaming'
  const terminal = ['completed', 'error', 'untracked'].includes(event.phase ?? '')
  if (!active && !terminal) return queues
  // The current item can still await its send receipt after the run has failed.
  // Only queued follow-ups need pausing; an empty queue must allow a fresh manual send.
  const hasPendingMessages = queue.items.some((item) => item.id !== queue.dispatchId)
  return {
    ...queues,
    [key]: {
      ...queue,
      awaitingCompletion: active,
      pauseReason:
        event.phase === 'error' && hasPendingMessages
          ? '上一轮远程任务失败，请检查消息和诊断后继续队列'
          : event.phase === 'untracked'
            ? '已停止跟踪，不代表远端已取消；请确认远端状态后继续队列'
            : queue.pauseReason,
    },
  }
}

export const createRemoteMessageQueueSlice: StateCreator<
  CclinkState,
  [],
  [],
  RemoteMessageQueueSlice
> = (set, get) => ({
  remoteMessageQueues: {},
  enqueueRemoteAgentDraft: (ref, sessionId) => get().submitRemoteAgentDraft(ref, sessionId, true),
  submitRemoteAgentDraft: (ref, sessionId, forceQueue = false) => {
    const key = remoteAgentComposerKey(ref, sessionId)
    const state = get()
    const content = (state.remoteAgentDrafts[key] ?? '').trim()
    const pendingImages = [...(state.remoteAgentImages[key] ?? [])]
    const imageBlock = imageImportBlockReason(`remote:${key}`, pendingImages)
    if (imageBlock) {
      set({ error: imageBlock })
      return false
    }
    const session = state.sessions.find((item) => item.id === sessionId)
    if (
      (!content && !pendingImages.length) ||
      !state.session.loggedIn ||
      workspaceRefKey(captureActiveWorkspaceTarget().ref) !== workspaceRefKey(ref) ||
      (sessionId &&
        (!session ||
          session.status === 'archived' ||
          session.serverId !== ref.endpointId ||
          session.workspaceId !== ref.workspaceId))
    )
      return false
    const current = state.remoteMessageQueues[key]
    const mustQueue = Boolean(
      forceQueue ||
      current?.dispatchId ||
      current?.awaitingCompletion ||
      current?.items.length ||
      session?.status === 'active' ||
      state.remoteQuestionControls[key]?.submitting,
    )
    if (!mustQueue && state.realtime.state !== 'online') {
      set({ error: '远程连接不可用，请恢复连接后发送' })
      return false
    }
    if ((current?.items.length ?? 0) >= 20) {
      set({ error: '待发送队列已满（最多 20 条）' })
      return false
    }
    if (new TextEncoder().encode(content).length > 8 * 1024) {
      set({ error: '单条远程消息不能超过 8 KiB，请拆分后发送' })
      return false
    }
    const drafts = { ...state.remoteAgentDrafts }
    const images = { ...state.remoteAgentImages }
    delete drafts[key]
    delete images[key]
    const item = { id: crypto.randomUUID(), content, pendingImages }
    set({
      error: null,
      remoteAgentDrafts: drafts,
      remoteAgentImages: images,
      remoteMessageQueues: {
        ...state.remoteMessageQueues,
        [key]: {
          ...(current ?? {
            ref: { ...ref },
            sessionId,
            pauseReason:
              state.realtime.state === 'online' ? null : '远程连接不可用，请恢复连接后继续队列',
            dispatchId: null,
            awaitingCompletion: session?.status === 'active',
          }),
          items: mustQueue ? [...(current?.items ?? []), item] : [],
          ...(!mustQueue ? { directSubmission: item, pauseReason: null } : {}),
        },
      },
    })
    // Start this user command immediately. The queue subscription only handles follow-ups.
    if (!mustQueue) void get().dispatchRemoteMessage(key)
    return true
  },
  editRemoteQueuedMessage: (key, id) => {
    const state = get()
    const queue = state.remoteMessageQueues[key]
    const item = queue?.items.find((entry) => entry.id === id)
    if (
      !item ||
      queue.dispatchId === id ||
      (state.remoteQuestionControls[key]?.submitting &&
        state.remoteQuestionControls[key]?.queuedMessageId === id) ||
      state.remoteAgentDrafts[key]?.trim() ||
      state.remoteAgentImages[key]?.length
    )
      return false
    set({
      remoteAgentDrafts: { ...state.remoteAgentDrafts, [key]: item.content },
      remoteAgentImages: { ...state.remoteAgentImages, [key]: item.pendingImages },
      remoteMessageQueues: {
        ...state.remoteMessageQueues,
        [key]: {
          ...queue,
          items: queue.items.filter((entry) => entry.id !== id),
          pauseReason: '正在编辑待发送消息；重新发送后点击继续队列',
        },
      },
    })
    return true
  },
  removeRemoteQueuedMessage: (key, id) =>
    set((state) => {
      const queue = state.remoteMessageQueues[key]
      if (
        !queue ||
        queue.dispatchId === id ||
        (state.remoteQuestionControls[key]?.submitting &&
          state.remoteQuestionControls[key]?.queuedMessageId === id)
      )
        return state
      return {
        remoteMessageQueues: {
          ...state.remoteMessageQueues,
          [key]: { ...queue, items: queue.items.filter((item) => item.id !== id) },
        },
      }
    }),
  pauseRemoteMessageQueue: (key, pauseReason) =>
    set((state) => {
      const queue = state.remoteMessageQueues[key]
      if (!queue) return state
      return {
        remoteMessageQueues: { ...state.remoteMessageQueues, [key]: { ...queue, pauseReason } },
      }
    }),
  dispatchRemoteMessage: async (initialKey, signal) => {
    let key = initialKey
    const queue = get().remoteMessageQueues[key]
    const item = queue?.directSubmission ?? queue?.items[0]
    const direct = Boolean(queue?.directSubmission)
    const target = captureActiveWorkspaceTarget()
    if (
      signal?.aborted ||
      !item ||
      queue.dispatchId ||
      queue.awaitingCompletion ||
      queue.pauseReason ||
      get().remoteQuestionControls[key]?.submitting ||
      !get().session.loggedIn ||
      get().realtime.state !== 'online' ||
      workspaceRefKey(target.ref) !== workspaceRefKey(queue.ref)
    )
      return
    if (
      queue.sessionId &&
      get().sessions.find((session) => session.id === queue.sessionId)?.status !== 'idle'
    )
      return
    const accountId = get().session.user?.id
    const selectedAtDispatch = get().selectedSessionId
    const ownsDispatch = (): boolean =>
      get().session.user?.id === accountId && get().remoteMessageQueues[key]?.dispatchId === item.id
    const update = (patch: Partial<RemoteMessageQueue>): void => {
      if (!ownsDispatch()) return
      set((state) => ({
        remoteMessageQueues: {
          ...state.remoteMessageQueues,
          [key]: { ...state.remoteMessageQueues[key], ...patch },
        },
      }))
    }
    const fail = (reason: string): void => {
      if (!ownsDispatch()) return
      set((state) => {
        const current = state.remoteMessageQueues[key]
        const restoreDraft =
          direct &&
          !current.items.length &&
          !state.remoteAgentDrafts[key]?.trim() &&
          !state.remoteAgentImages[key]?.length
        const items = direct && !restoreDraft ? [item, ...current.items] : current.items
        return {
          error: reason,
          ...(restoreDraft
            ? {
                remoteAgentDrafts: { ...state.remoteAgentDrafts, [key]: item.content },
                remoteAgentImages: { ...state.remoteAgentImages, [key]: item.pendingImages },
              }
            : {}),
          remoteMessageQueues: {
            ...state.remoteMessageQueues,
            [key]: {
              ...current,
              items,
              directSubmission: undefined,
              awaitingCompletion: false,
              pauseReason: items.length ? reason : null,
            },
          },
        }
      })
    }
    set((state) => ({
      remoteMessageQueues: {
        ...state.remoteMessageQueues,
        [key]: { ...queue, dispatchId: item.id },
      },
    }))
    try {
      const status = await window.cclinkStudio.remote.getStatus(queue.ref)
      if (!ownsDispatch()) return
      if (signal?.aborted) throw new Error('队列调度已停止，请确认后继续队列')
      if (
        status.state !== 'online' ||
        status.compatibility === 'upgrade-required' ||
        !status.capabilities.agent.session ||
        !status.capabilities.agent.stream ||
        (item.pendingImages.length > 0 && !status.capabilities.agent.imageInput)
      ) {
        throw new Error(
          status.remoteError?.message || '远程 Agent 离线或不支持这条消息，请检查后继续队列',
        )
      }
      if (!isWorkspaceTargetCurrent(target))
        throw new Error('工作空间已切换，请返回原会话后继续队列')
      let sessionId = queue.sessionId
      if (!sessionId) {
        const session = await window.cclinkStudio.cclink.createSession({
          ref: queue.ref,
          name: '新远程会话',
        })
        if (!ownsDispatch()) return
        sessionId = session.id
        const newKey = remoteAgentComposerKey(queue.ref, sessionId)
        set((state) => {
          const queues = { ...state.remoteMessageQueues }
          queues[newKey] = { ...queues[key], sessionId }
          delete queues[key]
          const drafts = { ...state.remoteAgentDrafts }
          const images = { ...state.remoteAgentImages }
          if (drafts[key] !== undefined) {
            drafts[newKey] = drafts[key]
            delete drafts[key]
          }
          if (images[key]) {
            images[newKey] = images[key]
            delete images[key]
          }
          return {
            remoteMessageQueues: queues,
            remoteAgentDrafts: drafts,
            remoteAgentImages: images,
            sessions: [session, ...state.sessions.filter((entry) => entry.id !== session.id)],
            selectedSessionId:
              isWorkspaceTargetCurrent(target) && state.selectedSessionId === selectedAtDispatch
                ? session.id
                : state.selectedSessionId,
          }
        })
        key = newKey
      }
      if (!isWorkspaceTargetCurrent(target))
        throw new Error('工作空间已切换，请返回原会话后继续队列')
      if (signal?.aborted) throw new Error('队列调度已停止，请确认后继续队列')
      if (
        get().remoteMessageQueues[key].pauseReason ||
        get().remoteQuestionControls[key]?.submitting ||
        get().realtime.state !== 'online'
      )
        throw new Error(
          get().remoteMessageQueues[key].pauseReason || '当前远程会话不可发送，请检查后重试',
        )
      const session = get().sessions.find((entry) => entry.id === sessionId)
      if (
        !session ||
        session.status !== 'idle' ||
        session.serverId !== queue.ref.endpointId ||
        session.workspaceId !== queue.ref.workspaceId
      ) {
        throw new Error('远程会话当前不可发送，请核对会话状态后继续队列')
      }
      // Main emits started/completed; an IPC acceptance alone must never unlock the next item.
      update({ awaitingCompletion: true })
      const sent = await get().sendAgentMessage(
        queue.ref,
        sessionId,
        item.content,
        item.pendingImages,
        item.pendingImages.length ? item.id : undefined,
      )
      if (!ownsDispatch()) return
      if (!sent) {
        fail(get().error || '发送结果未确认，请核对消息历史后重试')
        return
      }
      update({
        items: get().remoteMessageQueues[key].items.filter((entry) => entry.id !== item.id),
      })
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    } finally {
      update({ dispatchId: null, directSubmission: undefined, uploadProgress: undefined })
    }
  },
})
