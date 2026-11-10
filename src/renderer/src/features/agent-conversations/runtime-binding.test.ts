import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../../stores/agent-store'

beforeEach(() => {
  useAgentStore.setState(useAgentStore.getInitialState(), true)
  vi.stubGlobal('window', {
    cclinkStudio: {
      workspaceState: { setSection: vi.fn(async () => ({ success: true })) },
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('Thread runtime binding', () => {
  it('defaults new local conversations to Codex and retains Claude as an empty-thread choice', () => {
    const store = useAgentStore.getState()
    const id = store.createConversation()
    expect(useAgentStore.getState().conversations[id].runtimeBinding).toEqual({ kind: 'codex' })
    expect(store.setRuntimeBinding({ kind: 'claude-code' }, id)).toBe(true)
    useAgentStore.getState().addUserMessage('start', id)
    expect(store.setRuntimeBinding({ kind: 'codex' }, id)).toBe(false)
  })
  it('can choose Codex ACP before the first message and locks afterwards', () => {
    const store = useAgentStore.getState()
    const conversationId = store.activeConversationId

    expect(
      store.setRuntimeBinding({ kind: 'acp', implementationId: 'codex-acp' }, conversationId),
    ).toBe(true)
    expect(useAgentStore.getState().conversations[conversationId].runtimeBinding).toEqual({
      kind: 'acp',
      implementationId: 'codex-acp',
    })

    useAgentStore.getState().addUserMessage('start', conversationId)
    expect(
      useAgentStore.getState().setRuntimeBinding({ kind: 'claude-code' }, conversationId),
    ).toBe(false)
    expect(useAgentStore.getState().conversations[conversationId].runtimeBinding).toEqual({
      kind: 'acp',
      implementationId: 'codex-acp',
    })
  })

  it('allows switching after a failed launch without a Session, preserving user history', () => {
    const store = useAgentStore.getState()
    const id = store.createConversation()
    store.setRuntimeBinding({ kind: 'acp', implementationId: 'codex-acp' }, id)
    store.addUserMessage('preserve this failed request', id)
    store.beginRun(id)
    expect(store.setRuntimeBinding({ kind: 'codex' }, id)).toBe(false)
    store.cancelStreaming(id, 'error')
    expect(store.setRuntimeBinding({ kind: 'codex' }, id)).toBe(true)
    expect(
      useAgentStore
        .getState()
        .conversations[id].messages.some((m) => m.rawText === 'preserve this failed request'),
    ).toBe(true)
    store.setSessionId('native-session', id)
    expect(store.setRuntimeBinding({ kind: 'claude-code' }, id)).toBe(false)
  })
})
