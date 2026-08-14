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
})
