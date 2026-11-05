import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../../stores/agent-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createConversationRunController } from './conversation-run-controller'
import { installConversationMessageQueue } from './conversation-message-queue'
import {
  buildAgentConversationWorkspaceSnapshot,
  normalizeConversationSnapshot,
} from './conversation-workspace-state'
import type { AgentSendMessageInput } from '@shared/ipc/agent'

const id = 'agent-default'
let dispose: (() => void) | undefined
const settle = async (): Promise<void> => {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}
const conversation = () => useAgentStore.getState().conversations[id]

function harness() {
  const api = {
    saveMessageImages: vi.fn().mockResolvedValue({ success: true, assets: [] }),
    sendMessage: vi.fn(async (conversationId: string, payload: AgentSendMessageInput) => ({
      success: true,
      configurationReceipt: {
        conversationId,
        runId: (typeof payload === 'string' ? undefined : payload.runId)!,
        configurationRevision: conversation().configuration.revision,
        roleRef: conversation().configuration.roleRef,
        configurationFingerprint: 'a'.repeat(64),
        runtimeSessionMode: 'new' as const,
        skills: [],
      },
    })),
    abort: vi.fn().mockResolvedValue({ accepted: true }),
    supplement: vi.fn().mockResolvedValue({ status: 'received' }),
    compactConversation: vi.fn().mockResolvedValue({ success: true }),
  }
  const createController = (conversationId: string) =>
    createConversationRunController({ conversationId, agentApi: api, getTabs: () => [] })
  dispose = installConversationMessageQueue(createController)
  return { api, controller: createController(id) }
}

beforeEach(() => {
  useAgentStore.setState(useAgentStore.getInitialState(), true)
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
})
afterEach(() => {
  dispose?.()
  dispose = undefined
})

describe('conversation message queue', () => {
  it('keeps supplement receipts on their Run without clearing a later draft or changing the queue', async () => {
    const { api, controller } = harness()
    await controller.send('A')
    const runId = conversation().activeRunId!
    useAgentStore.getState().applyRuntimeRunStatus({
      conversationId: id,
      runId,
      status: 'running',
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 1,
      completedAt: null,
    })
    useAgentStore.getState().setSupplementSupported(true, id)
    await controller.send('B')
    useAgentStore.getState().setInput('correction', id)
    let receive!: (value: { status: string }) => void
    api.supplement.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          receive = resolve
        }),
    )
    const sending = controller.supplement('correction')
    expect(conversation().messages.at(-1)?.supplement).toMatchObject({ runId, status: 'pending' })
    const restored = normalizeConversationSnapshot(
      buildAgentConversationWorkspaceSnapshot(useAgentStore.getState(), null),
    )!
    expect(restored.conversations[id].messages.at(-1)?.supplement?.status).toBe('unknown')
    useAgentStore.getState().setInput('later draft', id)
    await expect(controller.supplement('later draft')).resolves.toMatchObject({ status: 'failed' })
    receive({ status: 'received' })
    await expect(sending).resolves.toMatchObject({ status: 'accepted', runId })
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    expect(api.supplement).toHaveBeenCalledTimes(1)
    expect(conversation().input).toBe('later draft')
    expect(conversation().queuedMessages?.map((item) => item.content)).toEqual(['B'])
    expect(conversation().messages.at(-1)?.supplement?.status).toBe('received')
  })

  it('retains an ambiguous supplement in history and refuses automatic or incompatible follow-up input', async () => {
    const { api, controller } = harness()
    await controller.send('A')
    const runId = conversation().activeRunId!
    useAgentStore.getState().applyRuntimeRunStatus({
      conversationId: id,
      runId,
      status: 'running',
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 1,
      completedAt: null,
    })
    useAgentStore.getState().setSupplementSupported(true, id)
    useAgentStore.getState().setInput('correction', id)
    useAgentStore
      .getState()
      .addPendingImages(
        [{ id: 'img', name: 'image.png', mediaType: 'image/png', size: 3, data: 'AQID' }],
        id,
      )
    await expect(controller.supplement('correction')).resolves.toMatchObject({ status: 'failed' })
    expect(api.supplement).not.toHaveBeenCalled()
    useAgentStore.getState().removePendingImage('img', id)
    api.supplement.mockRejectedValueOnce(new Error('transport lost'))
    await expect(controller.supplement('correction')).resolves.toMatchObject({ status: 'failed' })
    expect(conversation().messages.at(-1)).toMatchObject({
      rawText: 'correction',
      supplement: { status: 'unknown' },
    })
    useAgentStore.getState().setInput('retry', id)
    await expect(controller.supplement('retry')).resolves.toMatchObject({ status: 'failed' })
    expect(api.supplement).toHaveBeenCalledTimes(1)
    expect(conversation().input).toBe('retry')
  })

  it('does not mistake a later draft resource for the active queued Run context', async () => {
    const { api, controller } = harness()
    await controller.send('A')
    await controller.send('B')
    useAgentStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        [id]: {
          ...conversation(),
          mountedResources: [
            {
              id: 'new-file',
              kind: 'file',
              label: 'later.txt',
              ref: { type: 'file', path: '/later.txt' },
            },
          ],
        },
      },
    }))
    useAgentStore.getState().finishStreamingMessage(id, conversation().activeRunId!)
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(2)
    const runId = conversation().activeRunId!
    useAgentStore.getState().applyRuntimeRunStatus({
      conversationId: id,
      runId,
      status: 'running',
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 1,
      completedAt: null,
    })
    useAgentStore.getState().setSupplementSupported(true, id)
    useAgentStore.getState().setInput('correction', id)
    await expect(controller.supplement('correction')).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('上下文已变化'),
    })
    expect(api.supplement).not.toHaveBeenCalled()
    expect(conversation().input).toBe('correction')
  })

  it('starts a replacement only after exact cancellation and leaves the original queue paused', async () => {
    const { api, controller } = harness()
    await controller.send('A')
    useAgentStore.getState().setBackendState('connected', id)
    useAgentStore.getState().applyRuntimeRunStatus({
      conversationId: id,
      runId: conversation().activeRunId!,
      status: 'running',
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 1,
      completedAt: null,
    })
    const runId = conversation().activeRunId!
    await controller.send('B')
    await controller.send('C')
    useAgentStore.getState().setInput('D', id)
    await controller.stopAndSend('D')
    useAgentStore.getState().setInput('later draft', id)
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    expect(conversation().queuedMessages?.map((item) => item.content)).toEqual(['D', 'B', 'C'])
    const terminal = {
      conversationId: id,
      runId,
      status: 'cancelled' as const,
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 2,
      completedAt: 2,
    }
    useAgentStore.getState().applyRuntimeRunStatus({ ...terminal, runId: 'different-run' })
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    useAgentStore.getState().applyRuntimeRunStatus(terminal)
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(2)
    expect(api.sendMessage.mock.calls[1][1]).toMatchObject({ message: 'D' })
    expect(conversation().queuedMessages?.map((item) => item.content)).toEqual(['B', 'C'])
    expect(conversation().input).toBe('later draft')
    expect(conversation().messageQueuePauseReason).toBeTruthy()
    useAgentStore.getState().applyRuntimeRunStatus(terminal)
    useAgentStore.getState().finishStreamingMessage(id, conversation().activeRunId!)
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(2)
    useAgentStore.getState().setMessageQueuePauseReason(null, id)
    await settle()
    expect(api.sendMessage.mock.calls[2][1]).toMatchObject({ message: 'B' })
  })

  it('preserves a rejected replacement and never auto-resumes it after a late terminal', async () => {
    const { api, controller } = harness()
    await controller.send('A')
    useAgentStore.getState().setBackendState('connected', id)
    useAgentStore.getState().applyRuntimeRunStatus({
      conversationId: id,
      runId: conversation().activeRunId!,
      status: 'running',
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 1,
      completedAt: null,
    })
    const runId = conversation().activeRunId!
    api.abort.mockResolvedValueOnce({ accepted: false })
    await expect(controller.stopAndSend('D')).resolves.toMatchObject({ status: 'failed' })
    useAgentStore.getState().applyRuntimeRunStatus({
      conversationId: id,
      runId,
      status: 'cancelled',
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 2,
      completedAt: 2,
    })
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    expect(conversation().queuedMessages?.[0].content).toBe('D')
    expect(conversation().queuedMessages?.[0].afterCancellation?.phase).toBe('paused')
    const restored = normalizeConversationSnapshot(
      buildAgentConversationWorkspaceSnapshot(useAgentStore.getState(), null),
    )!
    expect(restored.conversations[id].queuedMessages?.[0].afterCancellation).toBeUndefined()
    expect(restored.conversations[id].messageQueuePauseReason).toContain('已恢复')
  })

  it('rejects duplicate replacement clicks and keeps later queued messages isolated', async () => {
    const { api, controller } = harness()
    await controller.send('A')
    useAgentStore.getState().setBackendState('connected', id)
    useAgentStore.getState().applyRuntimeRunStatus({
      conversationId: id,
      runId: conversation().activeRunId!,
      status: 'running',
      workspaceKey: null,
      startedAt: 1,
      updatedAt: 1,
      completedAt: null,
    })
    await controller.stopAndSend('D')
    await expect(controller.stopAndSend('D')).resolves.toMatchObject({ status: 'failed' })
    await controller.send('later')
    expect(conversation().queuedMessages?.map((item) => item.content)).toEqual(['D', 'later'])
    expect(api.abort).toHaveBeenCalledTimes(1)
  })

  it.each(['archive', 'workspace', 'timeout', 'manual pause'])(
    'never auto-starts a replacement after %s invalidates it',
    async (reason) => {
      const { api, controller } = harness()
      useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'local', path: '/original' } })
      useAgentStore.setState((state) => ({
        conversations: {
          ...state.conversations,
          [id]: {
            ...conversation(),
            runtime: {
              ...conversation().runtime,
              workspaceRef: { kind: 'local', path: '/original' },
            },
          },
        },
      }))
      await controller.send('A')
      const runId = conversation().activeRunId!
      const record = {
        conversationId: id,
        runId,
        status: 'running' as const,
        workspaceKey: '/original',
        startedAt: 1,
        updatedAt: 1,
        completedAt: null,
      }
      useAgentStore.getState().applyRuntimeRunStatus(record)
      await controller.stopAndSend('D')
      if (reason === 'archive') await useAgentStore.getState().archiveConversation(id)
      if (reason === 'workspace')
        useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'local', path: '/other' } })
      if (reason === 'manual pause')
        useAgentStore.getState().setMessageQueuePauseReason('pause', id)
      if (reason === 'timeout')
        useAgentStore.setState((state) => ({
          conversations: {
            ...state.conversations,
            [id]: {
              ...conversation(),
              queuedMessages: conversation().queuedMessages?.map((item) => ({
                ...item,
                afterCancellation: { ...item.afterCancellation!, deadlineAt: 0 },
              })),
            },
          },
        }))
      await settle()
      useAgentStore
        .getState()
        .applyRuntimeRunStatus({ ...record, status: 'cancelled', updatedAt: 2, completedAt: 2 })
      if (reason === 'archive') await useAgentStore.getState().restoreArchivedConversation(id)
      useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'local', path: '/original' } })
      await settle()
      expect(api.sendMessage).toHaveBeenCalledTimes(1)
      expect(conversation().queuedMessages?.[0]).toMatchObject({
        content: 'D',
        afterCancellation: { phase: 'paused' },
      })
    },
  )

  it('waits for an outstanding acceptance even if its Runtime has already completed', async () => {
    const { api, controller } = harness()
    const original = api.sendMessage.getMockImplementation()!
    let accept!: () => void
    const gate = new Promise<void>((resolve) => {
      accept = resolve
    })
    api.sendMessage.mockImplementationOnce(async (...args) => {
      await gate
      return original(...args)
    })
    const sending = controller.send('first')
    useAgentStore.getState().finishStreamingMessage(id, conversation().activeRunId!)
    await expect(controller.send('second')).resolves.toMatchObject({ status: 'queued' })
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    accept()
    await sending
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(2)
    expect(conversation().queuedMessages).toEqual([])
  })

  it('never clears attachments added while the previous acceptance is pending', async () => {
    const { api, controller } = harness()
    const image = (id: string) => ({
      id,
      name: `${id}.png`,
      mediaType: 'image/png' as const,
      size: 3,
      data: 'AQID',
    })
    useAgentStore.getState().addPendingImages([image('first')], id)
    const original = api.sendMessage.getMockImplementation()!
    let accept!: () => void
    const gate = new Promise<void>((resolve) => {
      accept = resolve
    })
    api.sendMessage.mockImplementationOnce(async (...args) => {
      await gate
      return original(...args)
    })
    const sending = controller.send('first')
    await settle()
    useAgentStore.getState().addPendingImages([image('later')], id)
    useAgentStore.getState().setInput('later draft', id)
    accept()
    await sending
    expect(conversation().pendingImages).toEqual([image('later')])
    expect(conversation().input).toBe('later draft')
  })

  it('runs FIFO only after real completion and keeps each image/context separate from the next draft', async () => {
    const { api, controller } = harness()
    await controller.send('first')
    const image = {
      id: 'image-2',
      name: 'second.png',
      mediaType: 'image/png' as const,
      size: 3,
      data: 'AQID',
    }
    useAgentStore.getState().addPendingImages([image], id)
    await expect(controller.send('second')).resolves.toMatchObject({ status: 'queued' })
    await controller.send('third')
    useAgentStore.getState().setInput('unsent draft', id)
    useAgentStore.getState().switchConversation(useAgentStore.getState().createConversation())
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    expect(conversation().queuedMessages?.map((item) => item.content)).toEqual(['second', 'third'])
    useAgentStore.getState().finishStreamingMessage(id, conversation().activeRunId!)
    await settle()
    expect(api.sendMessage.mock.calls[1][1]).toMatchObject({ message: 'second', images: [image] })
    expect(conversation().input).toBe('unsent draft')
    useAgentStore.getState().finishStreamingMessage(id, conversation().activeRunId!)
    await settle()
    expect(api.sendMessage.mock.calls[2][1]).toMatchObject({ message: 'third', images: [] })
    expect(conversation().queuedMessages).toEqual([])
  })

  it('pauses on cancellation, allows editing/deleting, and resumes only on an explicit command', async () => {
    const { api, controller } = harness()
    await controller.send('first')
    await controller.send('second')
    await controller.send('third')
    useAgentStore.getState().cancelStreaming(id, 'cancelled', conversation().activeRunId!)
    await settle()
    expect(conversation().messageQueuePauseReason).toBeTruthy()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    const [second, third] = conversation().queuedMessages!
    useAgentStore.getState().setInput('draft', id)
    expect(useAgentStore.getState().editQueuedMessage(second.id, id)).toBe(false)
    useAgentStore.getState().setInput('', id)
    expect(useAgentStore.getState().editQueuedMessage(second.id, id)).toBe(true)
    expect(conversation().input).toBe('second')
    useAgentStore.getState().removeQueuedMessage(third.id, id)
    await controller.send('edited second')
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    useAgentStore.getState().setMessageQueuePauseReason(null, id)
    await settle()
    expect(api.sendMessage.mock.calls[1][1]).toMatchObject({ message: 'edited second' })
  })

  it('retains a rejected queued entry and its attachments, without retrying or consuming a later draft', async () => {
    const { api, controller } = harness()
    await controller.send('first')
    await controller.send('second')
    api.sendMessage.mockRejectedValueOnce(new Error('offline'))
    useAgentStore.getState().setInput('new draft', id)
    useAgentStore.getState().finishStreamingMessage(id, conversation().activeRunId!)
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(2)
    expect(conversation().queuedMessages?.[0].content).toBe('second')
    expect(conversation().messageQueuePauseReason).toContain('offline')
    expect(conversation().input).toBe('new draft')
  })

  it('waits for the bound workspace and refuses changed role/skill/runtime context', async () => {
    const { api, controller } = harness()
    useAgentStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        [id]: {
          ...conversation(),
          runtime: {
            ...conversation().runtime,
            workspaceRef: { kind: 'local', path: '/queue-test' },
          },
        },
      },
    }))
    await controller.send('first')
    await controller.send('second')
    useAgentStore.getState().finishStreamingMessage(id, conversation().activeRunId!)
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    useAgentStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        [id]: {
          ...conversation(),
          configuration: { ...conversation().configuration, revision: 2 },
        },
      },
    }))
    useWorkspaceStore.setState({ activeWorkspaceRef: { kind: 'local', path: '/queue-test' } })
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    expect(conversation().messageQueuePauseReason).toContain('已变化')
  })

  it('persists text and references without image bodies, restores paused, and blocks missing images', async () => {
    const { api, controller } = harness()
    await controller.send('first')
    useAgentStore
      .getState()
      .addPendingImages(
        [{ id: 'queued-image', name: 'image.png', mediaType: 'image/png', size: 3, data: 'AQID' }],
        id,
      )
    await controller.send('second')
    const snapshot = buildAgentConversationWorkspaceSnapshot(useAgentStore.getState(), null)
    expect(snapshot.conversations[id].queuedMessages?.[0]).toMatchObject({
      pendingImages: [],
      missingImages: true,
      content: 'second',
    })
    const restored = normalizeConversationSnapshot(snapshot)!
    expect(restored.conversations[id].messageQueuePauseReason).toContain('已恢复')
    useAgentStore.setState(restored)
    useAgentStore.getState().cancelStreaming(id, 'runtime-lost', conversation().activeRunId!)
    useAgentStore.getState().setMessageQueuePauseReason(null, id)
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
    expect(conversation().messageQueuePauseReason).toContain('图片附件需重新添加')
  })

  it('does not dispatch after consumer disposal or archive, and caps queue growth', async () => {
    const { api, controller } = harness()
    await controller.send('first')
    for (let i = 0; i < 20; i++) await controller.send(`queued-${i}`)
    await expect(controller.send('overflow')).resolves.toMatchObject({ status: 'failed' })
    expect(conversation().queuedMessages).toHaveLength(20)
    dispose?.()
    useAgentStore.getState().finishStreamingMessage(id, conversation().activeRunId!)
    await settle()
    expect(api.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('preserves the failed active message in addition to a full queue and a newer draft on restore', async () => {
    const { api, controller } = harness()
    let reject!: (error: Error) => void
    api.sendMessage.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectSend) => {
          reject = rejectSend
        }),
    )
    const sending = controller.send('failed active message')
    for (let i = 0; i < 20; i++) await controller.send(`queued-${i}`)
    useAgentStore.getState().setInput('newer draft', id)
    reject(new Error('offline'))
    await sending
    expect(conversation().input).toBe('newer draft')
    expect(conversation().queuedMessages).toHaveLength(21)
    const restored = normalizeConversationSnapshot(
      buildAgentConversationWorkspaceSnapshot(useAgentStore.getState(), null),
    )!
    expect(restored.conversations[id].queuedMessages).toHaveLength(21)
    expect(restored.conversations[id].queuedMessages?.at(-1)?.content).toBe('queued-19')
  })
})
