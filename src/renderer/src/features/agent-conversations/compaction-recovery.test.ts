import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore } from '../../stores/agent-store'
import { createCompactionRecoveryConversation } from './compaction-recovery'
import {
  buildAgentConversationWorkspaceSnapshot,
  normalizeConversationSnapshot,
} from './conversation-workspace-state'

const workspaceRef = { kind: 'local' as const, path: '/workspace/recovery' }

beforeEach(() => useAgentStore.setState(useAgentStore.getInitialState(), true))

function failedConversation(): string {
  const store = useAgentStore.getState()
  const id = store.createConversation({
    runtime: { location: 'local', transport: 'local', workspaceRef },
    roleRef: { roleId: 'technical-writer', version: 2 },
    mountedSkills: [{ skillId: 'review', version: 1 }],
  })
  store.setScope({ kind: 'editor' }, id)
  store.setSessionId('old-sdk-session', id, 'a'.repeat(64))
  store.addUserMessage('很长的旧历史', id)
  store.setInput('保留这份未发送的草稿', id)
  store.enqueueMessage('保留这条待发送消息', id)
  store.addPendingImages(
    [{ id: 'draft-image', name: 'draft.png', mediaType: 'image/png', data: 'AQID', size: 3 }],
    id,
  )
  store.addMountedResource(
    {
      id: 'draft-file',
      kind: 'file',
      label: 'notes.md',
      ref: { type: 'file', path: '/workspace/recovery/notes.md' },
    },
    id,
  )
  store.setContextCompaction(
    {
      status: 'failed',
      trigger: 'auto',
      error: 'Prompt is too long · automatic compaction failed: API Error: [1301]',
      errorCode: 'context_compaction_content_rejected',
    },
    id,
  )
  return id
}

describe('compaction recovery', () => {
  it('preserves the entire source and starts a separate, unsent conversation with the same scope', () => {
    const id = failedConversation()
    const source = structuredClone(useAgentStore.getState().conversations[id])
    const freshId = createCompactionRecoveryConversation(id, workspaceRef)!
    const state = useAgentStore.getState()
    expect(freshId).toBeTruthy()
    expect(freshId).not.toBe(id)
    expect(state.activeConversationId).toBe(freshId)
    expect(state.conversations[id]).toEqual(source)
    expect(state.conversations[freshId]).toMatchObject({
      runtime: source.runtime,
      runtimeBinding: source.runtimeBinding,
      configuration: { roleRef: source.configuration.roleRef },
      mountedSkills: source.mountedSkills,
      scope: { kind: 'editor' },
      sessionId: null,
      input: '',
      loading: false,
      activeRunId: null,
      contextCompaction: { status: 'idle' },
      mountedResources: [],
      pendingImages: [],
    })
    expect(state.conversations[freshId].queuedMessages ?? []).toEqual([])
    expect(state.conversations[freshId].messages.some((message) => message.role === 'user')).toBe(
      false,
    )
    expect(JSON.stringify(state.conversations[freshId])).not.toContain('很长的旧历史')
    expect(state.conversations[freshId].messages.at(-1)?.rawText).toContain('旧会话')
    expect(createCompactionRecoveryConversation(id, workspaceRef)).toBeNull()
  })

  it.each(['busy', 'workspace', 'archived', 'not-failed'] as const)(
    'does not create a recovery conversation for %s sources',
    (scenario) => {
      const id = failedConversation()
      const store = useAgentStore.getState()
      if (scenario === 'busy') store.beginRun(id)
      if (scenario === 'archived') {
        useAgentStore.setState({
          conversations: {
            ...store.conversations,
            [id]: { ...store.conversations[id], archivedAt: 1 },
          },
        })
      }
      if (scenario === 'not-failed') store.setContextCompaction({ status: 'completed' }, id)
      const before = useAgentStore.getState().conversationOrder.length
      expect(
        createCompactionRecoveryConversation(
          id,
          scenario === 'workspace' ? { kind: 'local', path: '/another' } : workspaceRef,
        ),
      ).toBeNull()
      expect(useAgentStore.getState().conversationOrder).toHaveLength(before)
    },
  )

  it('retains the classified cause across workspace persistence and clears it on retry', () => {
    const id = failedConversation()
    const snapshot = buildAgentConversationWorkspaceSnapshot(
      useAgentStore.getState(),
      workspaceRef.path,
    )
    const restored = normalizeConversationSnapshot(snapshot, workspaceRef)!
    expect(restored.conversations[id].contextCompaction).toMatchObject({
      status: 'failed',
      errorCode: 'context_compaction_content_rejected',
      error: expect.stringContaining('[1301]'),
    })
    useAgentStore.getState().beginRun(id)
    expect(useAgentStore.getState().conversations[id].contextCompaction).toMatchObject({
      status: 'idle',
      error: null,
      errorCode: null,
    })
  })
})
