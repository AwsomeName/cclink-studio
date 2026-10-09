import { describe, expect, it } from 'vitest'
import { createAgentConversationState } from './conversation-state'
import {
  buildAgentConversationWorkspaceSnapshot,
  normalizeConversationSnapshot,
} from './conversation-workspace-state'

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

  it('omits derivable rawText and restores it from text and thinking blocks in order', () => {
    const conversation = createAgentConversationState('projected-thread')
    conversation.messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先分析' },
          { type: 'tool_use', id: 'tool-1', name: 'inspect', input: { path: 'safe' } },
          { type: 'text', text: '再回答' },
        ],
        rawText: '先分析再回答',
        timestamp: 1,
      },
    ]
    const persisted = buildAgentConversationWorkspaceSnapshot(
      {
        conversations: { [conversation.id]: conversation },
        conversationOrder: [conversation.id],
        activeConversationId: conversation.id,
      },
      null,
    )

    expect(persisted.schemaVersion).toBe(2)
    expect(persisted.conversations[conversation.id].messages[0]).not.toHaveProperty('rawText')

    const restored = normalizeConversationSnapshot(persisted)
    expect(restored?.conversations[conversation.id].messages[0].rawText).toBe('先分析再回答')
  })

  it('keeps rawText when it cannot be reconstructed exactly', () => {
    const conversation = createAgentConversationState('non-derivable-thread')
    conversation.messages = [
      {
        id: 'system-1',
        role: 'system',
        content: [{ type: 'text', text: 'visible' }],
        rawText: 'legacy-different-value',
        timestamp: 1,
      },
    ]

    const persisted = buildAgentConversationWorkspaceSnapshot(
      {
        conversations: { [conversation.id]: conversation },
        conversationOrder: [conversation.id],
        activeConversationId: conversation.id,
      },
      null,
    )

    expect(persisted.conversations[conversation.id].messages[0].rawText).toBe(
      'legacy-different-value',
    )
  })

  it('moves a lossless duplicate-heavy snapshot from above 32 MiB to below the limit', () => {
    const conversation = createAgentConversationState('large-thread')
    const text = '会'.repeat(6 * 1024 * 1024)
    conversation.messages = [
      {
        id: 'assistant-large',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: text }],
        rawText: text,
        timestamp: 1,
      },
    ]
    const state = {
      conversations: { [conversation.id]: conversation },
      conversationOrder: [conversation.id],
      activeConversationId: conversation.id,
    }

    const legacyBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength
    const persisted = buildAgentConversationWorkspaceSnapshot(state, null)
    const projectedBytes = new TextEncoder().encode(JSON.stringify(persisted)).byteLength

    expect(legacyBytes).toBeGreaterThan(32 * 1024 * 1024)
    expect(projectedBytes).toBeLessThan(32 * 1024 * 1024)
    expect(
      normalizeConversationSnapshot(persisted)?.conversations[conversation.id].messages[0],
    ).toMatchObject({ rawText: text })
  })
})
