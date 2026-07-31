import type { AgentProfileRef } from '@shared/agent-profile'
import type { AgentConversationState } from '../agent-conversations/conversation-state'

export interface ProfileBranchConversationOptions {
  surface: 'assistant-panel'
  runtime: AgentConversationState['runtime']
  profileRef: AgentProfileRef
  input: string
  mountedResources: AgentConversationState['mountedResources']
  mountedSkills: AgentConversationState['mountedSkills']
}

export function canReplaceConversationProfile(conversation: AgentConversationState): boolean {
  return (
    !conversation.sessionId &&
    conversation.messages.every((message) => message.id === 'welcome') &&
    !conversation.loading &&
    conversation.contextCompaction.status !== 'compacting'
  )
}

export function buildProfileBranchOptions(
  conversation: AgentConversationState,
  profileRef: AgentProfileRef,
): ProfileBranchConversationOptions {
  return {
    surface: 'assistant-panel',
    runtime: conversation.runtime,
    profileRef,
    input: conversation.input,
    mountedResources: conversation.mountedResources,
    mountedSkills: conversation.mountedSkills,
  }
}
