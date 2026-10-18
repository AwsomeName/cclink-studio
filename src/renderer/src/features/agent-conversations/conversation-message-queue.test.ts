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
