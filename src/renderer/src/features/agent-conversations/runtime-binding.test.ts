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
  it('locks the runtime after the first message and never binds the retired Codex ACP', () => {
    const store = useAgentStore.getState()
    const conversationId = store.activeConversationId

    expect(
      store.setRuntimeBinding({ kind: 'acp', implementationId: 'codex-acp' }, conversationId),
    ).toBe(false)
    expect(store.setRuntimeBinding({ kind: 'codex' }, conversationId)).toBe(true)
    useAgentStore.getState().addUserMessage('start', conversationId)
    useAgentStore.getState().setSessionId('native-session', conversationId)
    expect(
      useAgentStore.getState().setRuntimeBinding({ kind: 'claude-code' }, conversationId),
    ).toBe(false)
    expect(useAgentStore.getState().conversations[conversationId].runtimeBinding).toEqual({
      kind: 'codex',
    })
  })

  it('lets a historical Codex ACP conversation move to a native runtime, keeping history', () => {
    const store = useAgentStore.getState()
    const id = store.createConversation()
    store.addUserMessage('old ACP request', id)
    store.setSessionId('acp-session', id)
    useAgentStore.setState((state) => ({
      conversations: {
        ...state.conversations,
        [id]: {
          ...state.conversations[id],
          runtimeBinding: { kind: 'acp', implementationId: 'codex-acp' },
        },
      },
    }))
    expect(useAgentStore.getState().setRuntimeBinding({ kind: 'codex' }, id)).toBe(true)
    const after = useAgentStore.getState().conversations[id]
    expect(after.runtimeBinding).toEqual({ kind: 'codex' })
    expect(after.sessionId).toBeNull()
    expect(after.messages.some((m) => m.rawText === 'old ACP request')).toBe(true)
  })

  it('allows switching after a failed launch without a Session, preserving user history', () => {
    const store = useAgentStore.getState()
    const id = store.createConversation()
    store.setRuntimeBinding({ kind: 'codex' }, id)
    store.addUserMessage('preserve this failed request', id)
    store.beginRun(id)
    expect(store.setRuntimeBinding({ kind: 'claude-code' }, id)).toBe(false)
    store.cancelStreaming(id, 'error')
    expect(store.setRuntimeBinding({ kind: 'claude-code' }, id)).toBe(true)
    expect(
      useAgentStore
        .getState()
        .conversations[id].messages.some((m) => m.rawText === 'preserve this failed request'),
    ).toBe(true)
    store.setSessionId('native-session', id)
    expect(store.setRuntimeBinding({ kind: 'codex' }, id)).toBe(false)
  })
})
