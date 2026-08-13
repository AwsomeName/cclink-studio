import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore } from '../stores/agent-store'
import { collectRestorableAgentSessions } from './use-agent-conversation-restore'

describe('collectRestorableAgentSessions', () => {
  const sessionCompatibilityFingerprint = 'a'.repeat(64)

  beforeEach(() => {
    useAgentStore.setState(useAgentStore.getInitialState(), true)
  })

  it('restores active sessions from both assistant panel and workbench tabs', () => {
    const assistantId = useAgentStore.getState().activeConversationId
    useAgentStore
      .getState()
      .setSessionId('assistant-session', assistantId, sessionCompatibilityFingerprint)
    const workbenchId = useAgentStore.getState().createConversation({
      surface: 'workbench-tab',
      activate: false,
    })
    useAgentStore
      .getState()
      .setSessionId('workbench-session', workbenchId, sessionCompatibilityFingerprint)

    const state = useAgentStore.getState()
    expect(collectRestorableAgentSessions(state.conversations, state.conversationOrder)).toEqual([
      {
        conversationId: assistantId,
        sessionId: 'assistant-session',
        sessionCompatibilityFingerprint,
        skills: [],
        configuration: expect.objectContaining({
          roleRef: { roleId: 'default-assistant', version: 1 },
          revision: 1,
        }),
      },
      {
        conversationId: workbenchId,
        sessionId: 'workbench-session',
        sessionCompatibilityFingerprint,
        skills: [],
        configuration: expect.objectContaining({
          roleRef: { roleId: 'default-assistant', version: 1 },
          revision: 1,
        }),
      },
    ])
  })

  it('does not restore a legacy session that has no compatibility provenance', () => {
    const conversationId = useAgentStore.getState().activeConversationId
    useAgentStore.getState().setSessionId('legacy-session', conversationId)

    const state = useAgentStore.getState()
    expect(collectRestorableAgentSessions(state.conversations, state.conversationOrder)).toEqual([])
  })
})
