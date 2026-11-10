import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CclinkRemoteSession } from '@shared/cclink'
import type { CclinkRealtimeEvent } from '@shared/ipc/cclink'
import { remoteWorkspaceRef } from '@shared/workspace-ref'
import { useCclinkStore } from '../../stores/cclink-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { installRemoteMessageQueue } from './remote-message-queue'
import { remoteAgentComposerKey } from './remote-message-queue-state'

const ref = remoteWorkspaceRef({
  endpointId: 'agent-1',
  workspaceId: 'workspace-1',
  path: '/workspace',
})
const key = remoteAgentComposerKey(ref, 'session-1')
const session = (id = 'session-1'): CclinkRemoteSession => ({
  id,
  serverId: ref.endpointId,
  workspaceId: ref.workspaceId,
  workspacePath: ref.path,
  name: '队列测试',
  status: 'idle',
  createdAt: 1,
  updatedAt: 1,
  contextUsage: 0,
  messageCount: 0,
})
const status = {
  ref,
  state: 'online',
  compatibility: 'compatible',
  capabilities: { agent: { session: true, stream: true, imageInput: true } },
}
const store = () => useCclinkStore.getState()
const queue = () => store().remoteMessageQueues[key]
const settle = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
const event = (
  phase: CclinkRealtimeEvent['phase'],
  sessionId = 'session-1',
  serverId = ref.endpointId,
): void => {
  store().handleRealtimeEvent({ type: 'conversation', serverId, sessionId, phase })
}
function enqueue(text: string, sessionId: string | null = 'session-1'): boolean {
  store().setRemoteAgentDraft(remoteAgentComposerKey(ref, sessionId), text)
  return store().enqueueRemoteAgentDraft(ref, sessionId)
}
function submit(text: string, sessionId: string | null = 'session-1'): boolean {
  store().setRemoteAgentDraft(remoteAgentComposerKey(ref, sessionId), text)
  return store().submitRemoteAgentDraft(ref, sessionId)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let dispose: (() => void) | undefined
let api: ReturnType<typeof setupApi>
function setupApi() {
  return {
    getStatus: vi.fn().mockResolvedValue(status),
    createSession: vi.fn().mockResolvedValue(session()),
    sendAgentMessage: vi.fn(async (input: { sessionId: string }) => {
      event('started', input.sessionId)
      return { success: true }
    }),
    stopTrackingAgentRun: vi.fn().mockResolvedValue({ success: true }),
    listMessages: vi.fn().mockResolvedValue([]),
    onImageUploadProgress: vi.fn(() => vi.fn()),
  }
}
beforeEach(() => {
  useCclinkStore.setState(useCclinkStore.getInitialState(), true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useWorkspaceStore.getState().commitActiveWorkspace(ref)
  useCclinkStore.setState({
    session: {
      loggedIn: true,
      user: {
        id: 'user-1',
        nickname: '测试',
        phone: '',
        avatarUrl: '',
        loginMethod: 'phone',
        lastLoginAt: 1,
      },
    },
    realtime: { state: 'online' },
    sessions: [session()],
    activeSessionsRef: ref,
  })
  api = setupApi()
  vi.stubGlobal('window', { cclinkStudio: { cclink: api, remote: { getStatus: api.getStatus } } })
  dispose = installRemoteMessageQueue()
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.unstubAllGlobals()
})

describe('remote conversation message queue', () => {
  it('sends an idle first message directly without ever creating a queued item or relying on the queue subscription', async () => {
    dispose?.()
    dispose = undefined
    const accepted = deferred<{ success: boolean }>()
    api.sendAgentMessage.mockReturnValueOnce(accepted.promise)
    const lengths: number[] = []
    const unsubscribe = useCclinkStore.subscribe((state) => {
      lengths.push(state.remoteMessageQueues[key]?.items.length ?? 0)
    })
    expect(submit('first')).toBe(true)
    expect(api.getStatus).toHaveBeenCalledTimes(1)
    expect(queue().items).toEqual([])
    expect(queue().directSubmission?.content).toBe('first')
    expect(store().remoteAgentDrafts[key]).toBeUndefined()
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'first' }))
    expect(queue().items).toEqual([])
    accepted.resolve({ success: true })
    await settle()
    expect(queue().directSubmission).toBeUndefined()
    expect(queue().dispatchId).toBeNull()
    expect(lengths.every((length) => length === 0)).toBe(true)
    unsubscribe()
  })

  it('queues only later messages during a direct submission and waits for both completion and the receipt', async () => {
    const accepted = deferred<{ success: boolean }>()
    api.sendAgentMessage.mockReturnValueOnce(accepted.promise)
    submit('one')
    submit('two')
    submit('three')
    await settle()
    expect(queue().items.map((item) => item.content)).toEqual(['two', 'three'])
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
    event('started')
    event('completed')
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
    accepted.resolve({ success: true })
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(2)
    expect(queue().items.map((item) => item.content)).toEqual(['three'])
  })

  it('restores a rejected direct submission and its images to the composer without leaving a paused empty queue', async () => {
    const image = {
      id: 'image-1',
      name: 'one.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }
    store().addRemoteAgentImages(key, [image])
    api.sendAgentMessage.mockResolvedValueOnce({ success: false })
    submit('first')
    await settle()
    expect(store().remoteAgentDrafts[key]).toBe('first')
    expect(store().remoteAgentImages[key]).toEqual([image])
    expect(queue()).toMatchObject({ items: [], pauseReason: null, dispatchId: null })
    expect(submit('retry')).toBe(true)
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(2)
    expect(queue().items).toEqual([])
  })

  it('preserves a later draft and retains a failed direct message in the paused backlog when restoring would overwrite it', async () => {
    const accepted = deferred<{ success: boolean }>()
    api.sendAgentMessage.mockReturnValueOnce(accepted.promise)
    submit('first')
    await settle()
    store().setRemoteAgentDraft(key, 'later')
    accepted.resolve({ success: false })
    await settle()
    expect(store().remoteAgentDrafts[key]).toBe('later')
    expect(queue().items.map((item) => item.content)).toEqual(['first'])
    expect(queue().pauseReason).toBeTruthy()
    expect(queue().directSubmission).toBeUndefined()
  })

  it('creates a new session once while keeping its first direct submission out of the waiting list', async () => {
    useCclinkStore.setState({ sessions: [], selectedSessionId: null })
    const created = deferred<CclinkRemoteSession>()
    api.createSession.mockReturnValueOnce(created.promise)
    submit('first', null)
    await settle()
    const temporary = store().remoteMessageQueues[remoteAgentComposerKey(ref, null)]
    expect(temporary.items).toEqual([])
    expect(temporary.directSubmission?.content).toBe('first')
    submit('second', null)
    created.resolve(session())
    await settle()
    expect(api.createSession).toHaveBeenCalledTimes(1)
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
    expect(queue().items.map((item) => item.content)).toEqual(['second'])
    expect(store().selectedSessionId).toBe('session-1')
  })

  it('keeps a rejected direct message ahead of already queued follow-ups', async () => {
    const accepted = deferred<{ success: boolean }>()
    api.sendAgentMessage.mockReturnValueOnce(accepted.promise)
    submit('first')
    submit('second')
    await settle()
    accepted.resolve({ success: false })
    await settle()
    expect(queue().items.map((item) => item.content)).toEqual(['first', 'second'])
    expect(queue().pauseReason).toBeTruthy()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh direct command when only an empty old queue pause remains', async () => {
    enqueue('old')
    await settle()
    event('completed')
    store().pauseRemoteMessageQueue(key, '旧队列已暂停')
    expect(queue().items).toEqual([])
    submit('new')
    await settle()
    expect(queue().pauseReason).toBeNull()
    expect(queue().items).toEqual([])
    expect(api.sendAgentMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'new' }),
    )
  })

  it('restores the direct draft after an async workspace switch, and never clears an offline draft', async () => {
    const checked = deferred<typeof status>()
    api.getStatus.mockReturnValueOnce(checked.promise)
    submit('first')
    useWorkspaceStore.getState().commitActiveWorkspace({ kind: 'local', path: '/other' })
    checked.resolve(status)
    await settle()
    expect(api.sendAgentMessage).not.toHaveBeenCalled()
    expect(store().remoteAgentDrafts[key]).toBe('first')
    expect(queue().items).toEqual([])
    useWorkspaceStore.getState().commitActiveWorkspace(ref)
    useCclinkStore.setState({ realtime: { state: 'offline' } })
    expect(submit('offline')).toBe(false)
    expect(store().remoteAgentDrafts[key]).toBe('offline')
    expect(queue().items).toEqual([])
  })

  it('still queues when a real run is active even with zero waiting items', async () => {
    useCclinkStore.setState({ sessions: [{ ...session(), status: 'active' }] })
    submit('follow-up')
    await settle()
    expect(queue().directSubmission).toBeUndefined()
    expect(queue().items.map((item) => item.content)).toEqual(['follow-up'])
    expect(api.sendAgentMessage).not.toHaveBeenCalled()
  })

  it('dispatches FIFO only after real terminal events, not IPC acceptance, message text or session refresh', async () => {
    enqueue('one')
    enqueue('two')
    enqueue('three')
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
    expect(queue().items.map((item) => item.content)).toEqual(['two', 'three'])
    event('message')
    store().handleRealtimeEvent({
      type: 'sessions',
      serverId: ref.endpointId,
      sessions: [session()],
    })
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
    event('completed')
    await settle()
    event('completed')
    await settle()
    expect(
      api.sendAgentMessage.mock.calls.map(([input]) => (input as { content?: string }).content),
    ).toEqual(['one', 'two', 'three'])
    expect(queue().items).toEqual([])
  })

  it('waits for an outstanding send receipt even if completion arrives first', async () => {
    const accepted = deferred<{ success: boolean }>()
    api.sendAgentMessage.mockImplementationOnce(() => accepted.promise)
    enqueue('one')
    enqueue('two')
    await settle()
    event('started')
    event('completed')
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
    accepted.resolve({ success: true })
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(2)
    expect(queue().items).toEqual([])
  })

  it('clears only the enqueued draft and snapshots attachments before another message is typed', async () => {
    const accepted = deferred<{ success: boolean }>()
    api.sendAgentMessage.mockImplementationOnce(() => accepted.promise)
    const image = {
      id: 'image-1',
      name: 'one.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }
    store().addRemoteAgentImages(key, [image])
    enqueue('same text')
    await settle()
    expect(store().remoteAgentImages[key]).toBeUndefined()
    store().setRemoteAgentDraft(key, 'same text')
    store().addRemoteAgentImages(key, [{ ...image, id: 'image-2' }])
    accepted.resolve({ success: true })
    await settle()
    expect(store().remoteAgentDrafts[key]).toBe('same text')
    expect(store().remoteAgentImages[key][0].id).toBe('image-2')
    expect(api.sendAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({ images: [image], imageUploadId: expect.any(String) }),
    )
  })

  it('creates one session for consecutive messages and migrates the queue and later draft atomically', async () => {
    useCclinkStore.setState({ sessions: [], selectedSessionId: null })
    const created = deferred<CclinkRemoteSession>()
    api.createSession.mockReturnValueOnce(created.promise)
    enqueue('one', null)
    await settle()
    enqueue('two', null)
    enqueue('three', null)
    store().setRemoteAgentDraft(remoteAgentComposerKey(ref, null), 'later draft')
    created.resolve(session())
    await settle()
    expect(api.createSession).toHaveBeenCalledOnce()
    expect(store().remoteMessageQueues[remoteAgentComposerKey(ref, null)]).toBeUndefined()
    expect(store().selectedSessionId).toBe('session-1')
    expect(store().remoteAgentDrafts[key]).toBe('later draft')
    expect(queue().items.map((item) => item.content)).toEqual(['two', 'three'])
  })

  it('isolates sessions and ignores terminal events from another endpoint or session', async () => {
    useCclinkStore.setState({ sessions: [session(), session('session-2')] })
    enqueue('one')
    enqueue('two')
    await settle()
    store().setRemoteAgentDraft(remoteAgentComposerKey(ref, 'session-2'), 'another draft')
    store().selectSession('session-2')
    event('completed', 'session-2')
    event('completed', 'session-1', 'wrong-agent')
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
    event('completed')
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(2)
    expect(store().selectedSessionId).toBe('session-2')
    expect(store().remoteAgentDrafts[remoteAgentComposerKey(ref, 'session-2')]).toBe(
      'another draft',
    )
  })

  it('preserves a rejected message at the head and waits for explicit resume', async () => {
    api.sendAgentMessage.mockResolvedValueOnce({ success: false })
    enqueue('one')
    enqueue('two')
    await settle()
    expect(queue().items.map((item) => item.content)).toEqual(['one', 'two'])
    expect(queue().pauseReason).toBeTruthy()
    expect(queue().dispatchId).toBeNull()
    store().pauseRemoteMessageQueue(key, null)
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(2)
    expect(queue().items.map((item) => item.content)).toEqual(['two'])
  })

  it('allows a new manual send after a failed run with no pending messages', async () => {
    enqueue('one')
    await settle()
    event('error')
    await settle()
    expect(queue().items).toEqual([])
    expect(queue().awaitingCompletion).toBe(false)
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)

    enqueue('retry')
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(2)
    expect(api.sendAgentMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'retry' }),
    )
    expect(queue().pauseReason).toBeNull()
    expect(queue().items).toEqual([])
  })

  it.each([false, true])(
    'handles failure before the send receipt with pending follow-ups = %s',
    async (hasFollowUp) => {
      const accepted = deferred<{ success: boolean }>()
      api.sendAgentMessage.mockImplementationOnce(() => accepted.promise)
      enqueue('one')
      if (hasFollowUp) enqueue('two')
      await settle()
      event('started')
      event('error')
      await settle()
      expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
      accepted.resolve({ success: true })
      await settle()
      expect(queue().items.map((item) => item.content)).toEqual(hasFollowUp ? ['two'] : [])
      expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)

      enqueue('new manual message')
      await settle()
      if (hasFollowUp) {
        expect(queue().pauseReason).toContain('失败')
        expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
        expect(queue().items.map((item) => item.content)).toEqual(['two', 'new manual message'])
      } else {
        expect(queue().pauseReason).toBeNull()
        expect(api.sendAgentMessage).toHaveBeenCalledTimes(2)
        expect(queue().items).toEqual([])
      }
    },
  )

  it('pauses on failure, untracking and disconnection without resuming on reconnect', async () => {
    enqueue('one')
    enqueue('two')
    await settle()
    event('error')
    await settle()
    expect(queue().pauseReason).toContain('失败')
    store().pauseRemoteMessageQueue(key, null)
    await settle()
    enqueue('three')
    useCclinkStore.setState({ realtime: { state: 'offline' } })
    event('completed')
    useCclinkStore.setState({ realtime: { state: 'online' } })
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(2)
    expect(queue().pauseReason).toContain('中断')
    store().pauseRemoteMessageQueue(key, null)
    await settle()
    enqueue('four')
    await store().stopTrackingAgentRun(ref, 'session-1')
    await settle()
    expect(queue().pauseReason).toContain('不代表远端已取消')
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(3)
    store().pauseRemoteMessageQueue(key, null)
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(4)
  })

  it('keeps a manually paused queue paused after the current run completes', async () => {
    enqueue('one')
    enqueue('two')
    await settle()
    store().pauseRemoteMessageQueue(key, '已手动暂停队列')
    event('completed')
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
    store().pauseRemoteMessageQueue(key, null)
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(2)
  })

  it('does not send after a workspace changes during capability checking', async () => {
    const checked = deferred<typeof status>()
    api.getStatus.mockReturnValueOnce(checked.promise)
    enqueue('one')
    await settle()
    useWorkspaceStore.getState().commitActiveWorkspace({ kind: 'local', path: '/elsewhere' })
    checked.resolve(status)
    await settle()
    expect(api.sendAgentMessage).not.toHaveBeenCalled()
    expect(queue().items).toHaveLength(1)
    expect(queue().pauseReason).toContain('工作空间已切换')
  })

  it('retains a created session and its queued messages without sending after a workspace switch', async () => {
    useCclinkStore.setState({ sessions: [], selectedSessionId: null })
    const created = deferred<CclinkRemoteSession>()
    api.createSession.mockReturnValueOnce(created.promise)
    enqueue('one', null)
    await settle()
    useWorkspaceStore.getState().commitActiveWorkspace({ kind: 'local', path: '/elsewhere' })
    created.resolve(session())
    await settle()
    expect(api.sendAgentMessage).not.toHaveBeenCalled()
    expect(store().selectedSessionId).toBeNull()
    expect(queue().items[0].content).toBe('one')
    expect(queue().pauseReason).toContain('工作空间已切换')
  })

  it('supports image-only messages and never falls back to the local Agent', async () => {
    store().addRemoteAgentImages(key, [
      { id: 'image-1', name: 'one.png', mediaType: 'image/png', data: 'AQID', size: 3 },
    ])
    expect(enqueue('')).toBe(true)
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '',
        sessionId: 'session-1',
        ref,
        images: expect.any(Array),
      }),
    )
    expect(queue().items).toEqual([])
  })

  it('pauses after an archive and keeps the queue available after restoring', async () => {
    const archive = vi.fn().mockResolvedValue({ ...session(), status: 'archived' })
    Object.assign(api, { setSessionArchived: archive })
    enqueue('one')
    enqueue('two')
    await settle()
    await store().setSessionArchived('session-1', true)
    event('completed')
    await settle()
    expect(api.sendAgentMessage).toHaveBeenCalledTimes(1)
    expect(queue().pauseReason).toContain('归档')
    expect(queue().items).toHaveLength(1)
  })

  it('enforces capacity and editing rules without overwriting an existing draft', async () => {
    useCclinkStore.setState({ sessions: [{ ...session(), status: 'active' }] })
    for (let i = 0; i < 20; i++) expect(enqueue(String(i))).toBe(true)
    expect(enqueue('overflow')).toBe(false)
    expect(store().remoteAgentDrafts[key]).toBe('overflow')
    expect(store().editRemoteQueuedMessage(key, queue().items[0].id)).toBe(false)
    store().clearRemoteAgentDraft(key)
    expect(store().editRemoteQueuedMessage(key, queue().items[0].id)).toBe(true)
    expect(store().remoteAgentDrafts[key]).toBe('0')
    expect(queue().pauseReason).toContain('编辑')
    store().enqueueRemoteAgentDraft(ref, 'session-1')
    expect(queue().items.at(-1)?.content).toBe('0')
    store().removeRemoteQueuedMessage(key, queue().items[0].id)
    expect(queue().items).toHaveLength(19)
    await settle()
    expect(api.sendAgentMessage).not.toHaveBeenCalled()
  })

  it('stops pending dispatch and releases subscriptions on disposal', async () => {
    const checked = deferred<typeof status>()
    api.getStatus.mockReturnValueOnce(checked.promise)
    enqueue('one')
    await settle()
    dispose?.()
    dispose = undefined
    checked.resolve(status)
    await settle()
    expect(api.sendAgentMessage).not.toHaveBeenCalled()
    expect(queue().dispatchId).toBeNull()
    expect(api.onImageUploadProgress.mock.results[0].value).toHaveBeenCalledOnce()
  })

  it('does not create or send into a replacement account after an asynchronous boundary', async () => {
    const checked = deferred<typeof status>()
    api.getStatus.mockReturnValueOnce(checked.promise)
    enqueue('one')
    await settle()
    useCclinkStore.setState({ remoteMessageQueues: {}, session: { loggedIn: false, user: null } })
    checked.resolve(status)
    await settle()
    expect(api.sendAgentMessage).not.toHaveBeenCalled()
    expect(store().remoteMessageQueues).toEqual({})
  })
})
