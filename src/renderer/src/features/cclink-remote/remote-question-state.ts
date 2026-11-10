import type { StateCreator } from 'zustand'
import type { CclinkRemoteMessage } from '@shared/cclink'
import { workspaceRefKey, type RemoteWorkspaceRef } from '@shared/workspace-ref'
import type { CclinkState } from '../../stores/cclink-store'
import { captureActiveWorkspaceTarget } from '../../stores/workspace-store'
import { remoteAgentComposerKey } from './remote-message-queue-state'

type RemoteQuestion = Extract<CclinkRemoteMessage, { type: 'userQuestion' }>
export type RemoteQuestionAnswerSource =
  | { kind: 'answers'; answers: Record<string, string> }
  | { kind: 'draft' }
  | { kind: 'queued'; id: string }

export interface RemoteQuestionControl {
  submissionId: string
  questionId: string
  submitting: boolean
  error: string | null
  queuedMessageId?: string
  replyTexts: Record<string, string>
}

export function isRemoteQuestionReplyable(message: CclinkRemoteMessage): message is RemoteQuestion {
  return (
    message.type === 'userQuestion' &&
    message.questions.length > 0 &&
    !message.answered &&
    (!message.status || message.status === 'expired')
  )
}

export function findReplyableRemoteQuestion(
  messages: CclinkRemoteMessage[],
): RemoteQuestion | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    // A newer user turn or question supersedes older unresolved history.
    if (message.type === 'user') return null
    if (message.type === 'userQuestion') return isRemoteQuestionReplyable(message) ? message : null
  }
  return null
}

export interface RemoteQuestionSlice {
  /** Submission UI only; question resolution remains owned by main-process messages. */
  remoteQuestionControls: Record<string, RemoteQuestionControl>
  answerRemoteQuestion(
    ref: RemoteWorkspaceRef,
    sessionId: string,
    questionId: string,
    source: RemoteQuestionAnswerSource,
  ): Promise<boolean>
}

export const createRemoteQuestionSlice: StateCreator<CclinkState, [], [], RemoteQuestionSlice> = (
  set,
  get,
) => ({
  remoteQuestionControls: {},
  answerRemoteQuestion: async (ref, sessionId, questionId, source) => {
    const key = remoteAgentComposerKey(ref, sessionId)
    const state = get()
    if (state.remoteQuestionControls[key]?.submitting) return false
    const reject = (error: string): false => {
      set({ error })
      return false
    }
    const session = state.sessions.find((item) => item.id === sessionId)
    if (
      !state.session.loggedIn ||
      state.realtime.state !== 'online' ||
      workspaceRefKey(captureActiveWorkspaceTarget().ref) !== workspaceRefKey(ref) ||
      !session ||
      session.status === 'archived' ||
      session.serverId !== ref.endpointId ||
      session.workspaceId !== ref.workspaceId
    )
      return reject('当前远程会话不可回复，请检查连接和工作空间')
    const question = state.messages[sessionId]?.find((item) => item.id === questionId)
    if (!question || !isRemoteQuestionReplyable(question))
      return reject('该问题已经结束或已回答，请在消息框中继续对话')
    if (
      source.kind !== 'answers' &&
      (findReplyableRemoteQuestion(state.messages[sessionId])?.id !== question.id ||
        (session.status !== 'active' && question.status !== 'expired'))
    )
      return reject('当前已不在等待该问题，请在消息框中继续对话')

    const queued =
      source.kind === 'queued'
        ? state.remoteMessageQueues[key]?.items.find((item) => item.id === source.id)
        : undefined
    if (
      source.kind === 'queued' &&
      (!queued || state.remoteMessageQueues[key]?.dispatchId === queued.id)
    )
      return reject('这条消息已经开始发送或不在队列中')
    const replyText =
      source.kind === 'draft'
        ? (state.remoteAgentDrafts[key] ?? '').trim()
        : source.kind === 'queued'
          ? queued!.content.trim()
          : undefined
    if (source.kind !== 'answers') {
      const images = source.kind === 'draft' ? state.remoteAgentImages[key] : queued?.pendingImages
      if (images?.length) return reject('当前问题只接收文字回复，请先处理图片附件')
      if (!replyText || replyText.length > 4096) return reject('请输入 1–4096 字的文字回复')
    }
    // A free-form reply applies to the entire question group. Preserve the user's words;
    // do not infer an option or fabricate an answer for any question.
    const answers =
      source.kind === 'answers'
        ? source.answers
        : Object.fromEntries(question.questions.map((item) => [item.id, replyText!]))
    const submissionId = crypto.randomUUID()
    const replyTexts = { ...state.remoteQuestionControls[key]?.replyTexts }
    if (replyText) replyTexts[questionId] = replyText
    else delete replyTexts[questionId]
    const accountId = state.session.user?.id
    const ownsSubmission = (): boolean =>
      get().session.user?.id === accountId &&
      get().remoteQuestionControls[key]?.submissionId === submissionId
    const finish = (error: string | null): void => {
      if (!ownsSubmission()) return
      set((current) => ({
        remoteQuestionControls: {
          ...current.remoteQuestionControls,
          [key]: { ...current.remoteQuestionControls[key], submitting: false, error },
        },
        ...(error ? { error } : {}),
        ...(error && queued && current.remoteMessageQueues[key]
          ? {
              remoteMessageQueues: {
                ...current.remoteMessageQueues,
                [key]: {
                  ...current.remoteMessageQueues[key],
                  pauseReason:
                    current.remoteMessageQueues[key].pauseReason ||
                    '问题回复未确认，原消息已保留；请检查后重试',
                },
              },
            }
          : {}),
      }))
    }
    set({
      error: null,
      remoteQuestionControls: {
        ...state.remoteQuestionControls,
        [key]: {
          submissionId,
          questionId,
          submitting: true,
          error: null,
          ...(queued ? { queuedMessageId: queued.id } : {}),
          replyTexts,
        },
      },
    })
    try {
      const result = await window.cclinkStudio.cclink.answerQuestion({
        ref,
        sessionId,
        requestId: question.requestId,
        toolUseId: question.toolUseId,
        answers,
      })
      if (!ownsSubmission()) return false
      if (!result.success) throw new Error(result.error || '远程问题回答失败')
      if (source.kind === 'draft') get().clearRemoteAgentDraft(key, replyText)
      if (queued) {
        set((current) => {
          const queue = current.remoteMessageQueues[key]
          if (!queue) return current
          const items = queue.items.filter((item) => item.id !== queued.id)
          return {
            remoteMessageQueues: {
              ...current.remoteMessageQueues,
              [key]: { ...queue, items, pauseReason: items.length ? queue.pauseReason : null },
            },
          }
        })
      }
      // Refresh only from main; do not optimistically mark the question as answered.
      const previousMessages = get().messages[sessionId]
      const messages = await window.cclinkStudio.cclink.listMessages(sessionId).catch(() => null)
      if (ownsSubmission() && messages && get().messages[sessionId] === previousMessages) {
        set((current) => ({ messages: { ...current.messages, [sessionId]: messages } }))
      }
      finish(null)
      return true
    } catch (error) {
      finish(error instanceof Error ? error.message : String(error))
      return false
    }
  },
})
