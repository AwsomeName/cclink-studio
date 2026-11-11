import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore, buildAgentConversationWorkspaceSnapshot } from '../../stores/agent-store'
import { transientMessageResources } from './payload'
import type { AgentMountedResource } from '../../types'

const mountedFile = (id: string): AgentMountedResource => ({
  id,
  kind: 'file',
  label: id,
  ref: { type: 'file', path: `/tmp/${id}.md` },
})

const image = {
  id: 'image-retry',
  name: 'retry.png',
  mediaType: 'image/png' as const,
  data: 'AQID',
  size: 3,
}
beforeEach(() => useAgentStore.setState(useAgentStore.getInitialState(), true))
function sent(resources: AgentMountedResource[] = [], images = [image]) {
  const store = useAgentStore.getState()
  const id = store.activeConversationId
  resources.forEach((resource) => store.addMountedResource(resource, id))
  store.addPendingImages(images, id)
  store.addUserMessage('看看图片', id, transientMessageResources(resources, images))
  const runId = store.beginRun(id)
  store.clearTransientResources(
    id,
    images.map((item) => item.id),
  )
  store.setInput('', id)
  return { id, runId, current: () => useAgentStore.getState().conversations[id] }
}

describe('image draft recovery on asynchronous Runtime failure', () => {
  it('restores the exact prepared image and text once, including a late IPC rejection', () => {
    const { id, runId, current } = sent()
    const store = useAgentStore.getState()
    store.cancelStreaming(id, 'error', runId)
    expect(current().input).toBe('看看图片')
    expect(current().pendingImages).toEqual([image])
    store.cancelStreaming(id, 'error', runId)
    store.restoreFailedMessage('看看图片', { ...current(), pendingImages: [image] }, id)
    expect(current().queuedMessages ?? []).toEqual([])
    expect(current().pendingImages).toEqual([image])
    expect(current().activeImageDraft).toBeUndefined()
  })

  it('preserves a newer draft and places the failed images in the paused queue', () => {
    const { id, runId, current } = sent()
    useAgentStore.getState().setInput('后来输入的内容', id)
    useAgentStore.getState().cancelStreaming(id, 'error', runId)
    expect(current().input).toBe('后来输入的内容')
    expect(current().queuedMessages?.[0]).toMatchObject({
      content: '看看图片',
      pendingImages: [image],
    })
    expect(current().messageQueuePauseReason).toContain('检查')
  })

  it('ignores stale failures and clears recovery references on success and persistence', () => {
    const { id, runId, current } = sent()
    useAgentStore.getState().cancelStreaming(id, 'error', 'stale-run')
    expect(current().pendingImages).toEqual([])
    expect(current().activeImageDraft?.runId).toBe(runId)
    const snapshot = buildAgentConversationWorkspaceSnapshot(useAgentStore.getState(), null)
    expect(JSON.stringify(snapshot)).not.toContain('activeImageDraft')
    useAgentStore.getState().finishStreamingMessage(id, runId)
    useAgentStore.getState().cancelStreaming(id, 'error', runId)
    expect(current().pendingImages).toEqual([])
    expect(current().activeImageDraft).toBeUndefined()
  })

  it('preserves the original file/browser mounts when recovering an otherwise empty draft', () => {
    const original = mountedFile('original')
    const { id, runId, current } = sent([original])
    useAgentStore.getState().cancelStreaming(id, 'error', runId)
    expect(current().pendingImages).toEqual([image])
    expect(current().mountedResources).toEqual([original])
  })

  it.each(['runtime', 'ipc'] as const)(
    'preserves newly mounted resources after %s failure',
    (failure) => {
      const original = mountedFile('original')
      const newer = mountedFile('newer')
      const { id, runId, current } = sent([original])
      const snapshot = { ...current(), input: '看看图片', pendingImages: [image] }
      useAgentStore.getState().addMountedResource(newer, id)
      if (failure === 'runtime') useAgentStore.getState().cancelStreaming(id, 'error', runId)
      else useAgentStore.getState().restoreFailedMessage('看看图片', snapshot, id)
      expect(current().mountedResources).toEqual([original, newer])
      expect(current().input).toBe('')
      expect(current().pendingImages).toEqual([])
      expect(current().queuedMessages?.[0]).toMatchObject({
        content: '看看图片',
        pendingImages: [image],
        mountedResources: [original],
      })
    },
  )

  it('does not mistake one overlapping image for recovery of the whole message', () => {
    const second = { ...image, id: 'second' }
    const { id, runId, current } = sent([], [image, second])
    useAgentStore.getState().addPendingImages([image], id)
    useAgentStore.getState().cancelStreaming(id, 'error', runId)
    expect(current().pendingImages).toEqual([image])
    expect(current().queuedMessages?.[0].pendingImages).toEqual([image, second])
  })

  it('uses the dispatched queue resources rather than those of a later composer draft', () => {
    const store = useAgentStore.getState()
    const id = store.activeConversationId
    const original = mountedFile('queued')
    const newer = mountedFile('composer')
    store.addMountedResource(newer, id)
    store.addUserMessage('排队的图片', id, transientMessageResources([original], [image]))
    const runId = store.beginRun(id, undefined, [original])
    store.cancelStreaming(id, 'error', runId)
    const current = useAgentStore.getState().conversations[id]
    expect(current.mountedResources).toEqual([newer])
    expect(current.queuedMessages?.[0]).toMatchObject({
      content: '排队的图片',
      mountedResources: [original],
      pendingImages: [image],
    })
  })
})
