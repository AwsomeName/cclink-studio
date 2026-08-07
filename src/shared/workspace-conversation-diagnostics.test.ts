import { describe, expect, it } from 'vitest'
import { summarizeWorkspaceConversationSnapshot } from './workspace-conversation-diagnostics'

describe('summarizeWorkspaceConversationSnapshot', () => {
  it('reports only structural counts and never returns conversation content', () => {
    const summary = summarizeWorkspaceConversationSnapshot({
      activeConversationId: 'conversation-secret-id',
      conversationOrder: ['conversation-secret-id'],
      conversations: {
        'conversation-secret-id': {
          title: 'private title',
          sessionId: 'private-session-id',
          archivedAt: null,
          messages: [
            { role: 'user', rawText: 'private prompt' },
            { role: 'assistant', rawText: 'private answer', isStreaming: true },
          ],
        },
      },
    })

    expect(summary).toMatchObject({
      orderedConversationCount: 1,
      storedConversationCount: 1,
      sessionBackedConversationCount: 1,
      messageCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      streamingMessageCount: 1,
      textCharacterCount: 28,
      activeConversationPresent: true,
    })
    expect(JSON.stringify(summary)).not.toContain('private')
    expect(JSON.stringify(summary)).not.toContain('conversation-secret-id')
  })
})
