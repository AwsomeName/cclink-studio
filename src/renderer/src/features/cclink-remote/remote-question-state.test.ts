import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CclinkRemoteMessage } from '@shared/cclink'
import { remoteWorkspaceRef } from '@shared/workspace-ref'
import { useCclinkStore } from '../../stores/cclink-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { remoteAgentComposerKey } from './remote-message-queue-state'
import { installRemoteMessageQueue } from './remote-message-queue'
import { findReplyableRemoteQuestion } from './remote-question-state'

const ref = remoteWorkspaceRef({ endpointId: 'agent-1', workspaceId: 'ws-1', path: '/workspace' })
const key = remoteAgentComposerKey(ref, 'session-1')
const question: Extract<CclinkRemoteMessage, { type: 'userQuestion' }> = {
  type: 'userQuestion',
  id: 'question-1',
  timestamp: 1,
  requestId: 'request-1',
  toolUseId: 'tool-1',
  questions: [
    { id: 'market', question: '恢复大盘链？', options: [{ label: '恢复' }, { label: '暂停' }] },
    { id: 'breadth', question: '保留宽度数据？', options: [{ label: '保留' }, { label: '停掉' }] },
  ],
}
const reply = '先全部停掉，后面需要恢复哪个我再说。'
const store = () => useCclinkStore.getState()
const submit = () => store().answerRemoteQuestion(ref, 'session-1', question.id, { kind: 'draft' })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}
const settle = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve()
}
let api: { answerQuestion: ReturnType<typeof vi.fn>; listMessages: ReturnType<typeof vi.fn> }
let dispose: (() => void) | undefined
beforeEach(() => {
  useCclinkStore.setState(useCclinkStore.getInitialState(), true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.getState().commitActiveWorkspace(ref)
  useCclinkStore.setState({
    session: {
      loggedIn: true,
      user: {
        id: 'user-1',
        nickname: '',
        phone: '',
        avatarUrl: '',
        loginMethod: 'phone',
        lastLoginAt: 1,
      },
    },
    realtime: { state: 'online' },
    sessions: [
      {
        id: 'session-1',
        name: '',
        serverId: ref.endpointId,
        workspaceId: ref.workspaceId,
        workspacePath: ref.path,
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 1,
        contextUsage: 0,
      },
    ],
    messages: { 'session-1': [question] },
    remoteAgentDrafts: { [key]: reply },
  })
  api = {
    answerQuestion: vi.fn().mockResolvedValue({ success: true }),
    listMessages: vi.fn().mockResolvedValue([{ ...question, answered: true, status: 'resolved' }]),
  }
  vi.stubGlobal('window', { cclinkStudio: { cclink: api } })
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.unstubAllGlobals()
})

describe('remote question replies', () => {
  it('sends the exact free-form instruction for the entire question group without queuing or selecting options', async () => {
    expect(await submit()).toBe(true)
    expect(api.answerQuestion).toHaveBeenCalledWith({
      ref,
      sessionId: 'session-1',
      requestId: question.requestId,
      toolUseId: question.toolUseId,
      answers: { market: reply, breadth: reply },
    })
    expect(store().remoteMessageQueues).toEqual({})
    expect(store().remoteAgentDrafts[key]).toBeUndefined()
    expect(store().messages['session-1'][0]).toMatchObject({ answered: true })
    expect(store().remoteQuestionControls[key]).toMatchObject({
      replyTexts: { [question.id]: reply },
      submitting: false,
    })
  })

  it('shares a synchronous submission lock with option answers and waits for ACK before clearing the draft', async () => {
    const accepted = deferred<{ success: boolean }>()
    api.answerQuestion.mockReturnValueOnce(accepted.promise)
    const pending = submit()
    expect(store().remoteAgentDrafts[key]).toBe(reply)
    expect(store().messages['session-1'][0]).toEqual(question)
    expect(
      await store().answerRemoteQuestion(ref, 'session-1', question.id, {
        kind: 'answers',
        answers: { market: '恢复', breadth: '保留' },
      }),
    ).toBe(false)
    expect(api.answerQuestion).toHaveBeenCalledTimes(1)
    accepted.resolve({ success: true })
    await pending
    expect(store().remoteAgentDrafts[key]).toBeUndefined()
  })

  it('preserves the reply and permits an explicit retry after rejection', async () => {
    api.answerQuestion.mockResolvedValueOnce({ success: false, error: '等待确认超时' })
    expect(await submit()).toBe(false)
    expect(store().remoteAgentDrafts[key]).toBe(reply)
    expect(store().messages['session-1'][0]).toEqual(question)
    expect(store().remoteQuestionControls[key]).toMatchObject({
      submitting: false,
      error: '等待确认超时',
    })
    expect(await submit()).toBe(true)
    expect(api.answerQuestion).toHaveBeenCalledTimes(2)
  })

  it('keeps earlier free-form replies visible when the same session asks another question', async () => {
    await submit()
    const next = { ...question, id: 'question-2', requestId: 'request-2', toolUseId: 'tool-2' }
    store().handleRealtimeEvent({
      type: 'conversation',
      serverId: ref.endpointId,
      sessionId: 'session-1',
      phase: 'message',
      message: next,
    })
    store().setRemoteAgentDraft(key, '后续说明')
    api.listMessages.mockResolvedValue([
      { ...question, answered: true },
      { ...next, answered: true },
    ])
    await store().answerRemoteQuestion(ref, 'session-1', next.id, { kind: 'draft' })
    expect(store().remoteQuestionControls[key].replyTexts).toEqual({
      [question.id]: reply,
      [next.id]: '后续说明',
    })
  })

  it('preserves a newer draft and newer question events across acknowledgment and refresh', async () => {
    const accepted = deferred<{ success: boolean }>()
    const refreshed = deferred<CclinkRemoteMessage[]>()
    api.answerQuestion.mockReturnValueOnce(accepted.promise)
    api.listMessages.mockReturnValueOnce(refreshed.promise)
    const pending = submit()
    store().setRemoteAgentDraft(key, '新的后续指令')
    accepted.resolve({ success: true })
    await settle()
    const next = { ...question, id: 'question-2', requestId: 'request-2', toolUseId: 'tool-2' }
    store().handleRealtimeEvent({
      type: 'conversation',
      serverId: ref.endpointId,
      sessionId: 'session-1',
      phase: 'message',
      message: next,
    })
    refreshed.resolve([{ ...question, answered: true }])
    await pending
    expect(store().remoteAgentDrafts[key]).toBe('新的后续指令')
    expect(store().messages['session-1']).toContainEqual(next)
  })

  it.each(['resolved', 'cancelled', 'ended'] as const)(
    'never submits an %s question',
    async (status) => {
      useCclinkStore.setState({ messages: { 'session-1': [{ ...question, status }] } })
      expect(await submit()).toBe(false)
      expect(api.answerQuestion).not.toHaveBeenCalled()
      expect(store().remoteAgentDrafts[key]).toBe(reply)
    },
  )

  it('allows an expired question through the existing continuation protocol', async () => {
    useCclinkStore.setState({ messages: { 'session-1': [{ ...question, status: 'expired' }] } })
    expect(await submit()).toBe(true)
    expect(api.answerQuestion).toHaveBeenCalledTimes(1)
  })

  it('rejects attachments and overlong answers without discarding anything', async () => {
    const image = {
      id: 'image',
      name: 'one.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }
    store().addRemoteAgentImages(key, [image])
    expect(await submit()).toBe(false)
    expect(store().remoteAgentImages[key]).toEqual([image])
    store().removeRemoteAgentImage(key, image.id)
    store().setRemoteAgentDraft(key, 'x'.repeat(4097))
    expect(await submit()).toBe(false)
    expect(api.answerQuestion).not.toHaveBeenCalled()
  })

  it('rejects a different workspace and ignores a late receipt after account replacement', async () => {
    useWorkspaceStore.getState().commitActiveWorkspace({ kind: 'local', path: '/other' })
    expect(await submit()).toBe(false)
    expect(api.answerQuestion).not.toHaveBeenCalled()
    useWorkspaceStore.getState().commitActiveWorkspace(ref)
    const accepted = deferred<{ success: boolean }>()
    api.answerQuestion.mockReturnValueOnce(accepted.promise)
    const pending = submit()
    useCclinkStore.setState({
      session: { loggedIn: false, user: null },
      remoteQuestionControls: {},
      remoteAgentDrafts: {},
    })
    accepted.resolve({ success: true })
    expect(await pending).toBe(false)
    expect(store().remoteQuestionControls).toEqual({})
    expect(api.listMessages).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'consumes a queued reply only after ACK = %s, even if the turn ends first',
    async (success) => {
      store().enqueueRemoteAgentDraft(ref, 'session-1')
      const item = store().remoteMessageQueues[key].items[0]
      const accepted = deferred<{ success: boolean; error?: string }>()
      api.answerQuestion.mockReturnValueOnce(accepted.promise)
      const send = vi.fn().mockResolvedValue({ success: true })
      Object.assign(window.cclinkStudio, {
        remote: {
          getStatus: vi.fn().mockResolvedValue({
            state: 'online',
            capabilities: { agent: { session: true, stream: true } },
          }),
        },
      })
      Object.assign(api, { sendAgentMessage: send, onImageUploadProgress: () => () => {} })
      dispose = installRemoteMessageQueue()
      const pending = store().answerRemoteQuestion(ref, 'session-1', question.id, {
        kind: 'queued',
        id: item.id,
      })
      store().handleRealtimeEvent({
        type: 'conversation',
        serverId: ref.endpointId,
        sessionId: 'session-1',
        phase: 'completed',
      })
      store().removeRemoteQueuedMessage(key, item.id)
      expect(store().editRemoteQueuedMessage(key, item.id)).toBe(false)
      await settle()
      expect(send).not.toHaveBeenCalled()
      expect(store().remoteMessageQueues[key].items).toHaveLength(1)
      accepted.resolve({ success, error: success ? undefined : '回复未确认' })
      expect(await pending).toBe(success)
      await settle()
      expect(send).not.toHaveBeenCalled()
      expect(store().remoteMessageQueues[key].items).toHaveLength(success ? 0 : 1)
      if (!success) expect(store().remoteMessageQueues[key].pauseReason).toContain('回复未确认')
    },
  )

  it('keeps other queued work and its pause reason when consuming one explicit reply', async () => {
    store().enqueueRemoteAgentDraft(ref, 'session-1')
    const id = store().remoteMessageQueues[key].items[0].id
    store().setRemoteAgentDraft(key, '之后再执行的事')
    store().enqueueRemoteAgentDraft(ref, 'session-1')
    store().pauseRemoteMessageQueue(key, '已手动暂停队列')
    expect(
      await store().answerRemoteQuestion(ref, 'session-1', question.id, { kind: 'queued', id }),
    ).toBe(true)
    expect(store().remoteMessageQueues[key].items.map((item) => item.content)).toEqual([
      '之后再执行的事',
    ])
    expect(store().remoteMessageQueues[key].pauseReason).toBe('已手动暂停队列')
  })

  it('clears the empty queue pause after a rejected queued reply is retried successfully', async () => {
    store().enqueueRemoteAgentDraft(ref, 'session-1')
    const id = store().remoteMessageQueues[key].items[0].id
    api.answerQuestion.mockResolvedValueOnce({ success: false, error: '回复未确认' })
    expect(
      await store().answerRemoteQuestion(ref, 'session-1', question.id, { kind: 'queued', id }),
    ).toBe(false)
    expect(store().remoteMessageQueues[key].pauseReason).toBeTruthy()
    expect(
      await store().answerRemoteQuestion(ref, 'session-1', question.id, { kind: 'queued', id }),
    ).toBe(true)
    expect(store().remoteMessageQueues[key].items).toEqual([])
    expect(store().remoteMessageQueues[key].pauseReason).toBeNull()
  })

  it('routes to the latest open question rather than a resolved or cancelled one', () => {
    expect(
      findReplyableRemoteQuestion([question, { ...question, id: 'new', status: 'expired' }])?.id,
    ).toBe('new')
    expect(findReplyableRemoteQuestion([{ ...question, answered: true }])).toBeNull()
    expect(
      findReplyableRemoteQuestion([question, { ...question, id: 'closed', status: 'resolved' }]),
    ).toBeNull()
    expect(
      findReplyableRemoteQuestion([
        question,
        { type: 'user', id: 'next-turn', timestamp: 2, content: '新任务' },
      ]),
    ).toBeNull()
  })

  it('does not route fresh text into an old question after a failed or completed run', async () => {
    useCclinkStore.setState({
      sessions: store().sessions.map((session) => ({ ...session, status: 'idle' })),
    })
    expect(await submit()).toBe(false)
    expect(api.answerQuestion).not.toHaveBeenCalled()
    expect(store().remoteAgentDrafts[key]).toBe(reply)
  })
})
