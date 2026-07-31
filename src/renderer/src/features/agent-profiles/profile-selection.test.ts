import { describe, expect, it } from 'vitest'
import { createAgentConversationState } from '../agent-conversations/conversation-state'
import { buildProfileBranchOptions, canReplaceConversationProfile } from './profile-selection'

describe('agent profile selection', () => {
  it('allows an empty thread to replace its role in place', () => {
    expect(canReplaceConversationProfile(createAgentConversationState())).toBe(true)
  })

  it('requires a branch after history or a runtime session exists', () => {
    const withHistory = createAgentConversationState()
    withHistory.messages.push({
      id: 'user-1',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      rawText: 'hello',
      timestamp: 1,
    })
    const withSession = createAgentConversationState()
    withSession.sessionId = 'session-1'

    expect(canReplaceConversationProfile(withHistory)).toBe(false)
    expect(canReplaceConversationProfile(withSession)).toBe(false)
  })

  it('copies draft and reusable context without copying images or history', () => {
    const conversation = createAgentConversationState(undefined, {
      input: '继续分析',
      mountedResources: [
        {
          id: 'file-1',
          kind: 'file',
          label: 'note.md',
          ref: { type: 'file', path: '/workspace/note.md' },
        },
      ],
      mountedSkills: [
        {
          id: 'grill-me',
          name: 'grill-me',
          label: 'grill-me',
        },
      ],
    })
    conversation.pendingImages = [
      {
        id: 'image-1',
        name: 'screen.png',
        mediaType: 'image/png',
        data: 'AQID',
        size: 3,
      },
    ]

    expect(
      buildProfileBranchOptions(conversation, {
        profileId: 'critical-challenger',
        version: 1,
      }),
    ).toEqual({
      surface: 'assistant-panel',
      runtime: conversation.runtime,
      profileRef: { profileId: 'critical-challenger', version: 1 },
      input: '继续分析',
      mountedResources: conversation.mountedResources,
      mountedSkills: conversation.mountedSkills,
    })
  })
})
