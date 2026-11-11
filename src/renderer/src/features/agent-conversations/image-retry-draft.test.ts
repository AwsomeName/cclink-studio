import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore, buildAgentConversationWorkspaceSnapshot } from '../../stores/agent-store'
import { transientMessageResources } from './payload'

const image = {
  id: 'image-retry',
  name: 'retry.png',
  mediaType: 'image/png' as const,
  data: 'AQID',
  size: 3,
}
beforeEach(() => useAgentStore.setState(useAgentStore.getInitialState(), true))
function sent() {
  const store = useAgentStore.getState()
  const id = store.activeConversationId
  store.addPendingImages([image], id)
  store.addUserMessage('看看图片', id, transientMessageResources([], [image]))
  const runId = store.beginRun(id)
  store.clearTransientResources(id, [image.id])
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
})
