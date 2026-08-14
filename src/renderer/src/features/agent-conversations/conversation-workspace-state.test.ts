import { describe, expect, it } from 'vitest'
import { createAgentConversationState } from './conversation-state'
import { normalizeConversationSnapshot } from './conversation-workspace-state'

describe('Agent conversation runtime migration', () => {
  it('loads an old Thread without runtimeBinding as Claude Code', () => {
    const conversation = createAgentConversationState('legacy-thread')
    delete conversation.runtimeBinding

    const snapshot = normalizeConversationSnapshot({
      conversations: { [conversation.id]: conversation },
      conversationOrder: [conversation.id],
      activeConversationId: conversation.id,
    })

    expect(snapshot?.conversations['legacy-thread'].runtimeBinding).toEqual({
      kind: 'claude-code',
    })
  })
})
