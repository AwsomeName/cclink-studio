import { useEffect, useRef } from 'react'
import { useAgentStore, type AgentConversationState } from '../stores/agent-store'
import type { AgentConversationConfiguration, AgentSkillRef } from '@shared/agent-role'
import { DEFAULT_AGENT_RUNTIME_BINDING, type AgentRuntimeBinding } from '@shared/agent-runtime'

export function collectRestorableAgentSessions(
  conversations: Record<string, AgentConversationState>,
  conversationOrder: string[],
): Array<{
  conversationId: string
  sessionId: string
  sessionCompatibilityFingerprint: string
  configuration: AgentConversationConfiguration
  skills: AgentSkillRef[]
  runtimeBinding: AgentRuntimeBinding
}> {
  return conversationOrder.flatMap((conversationId) => {
    const conversation = conversations[conversationId]
    return conversation?.sessionId &&
      conversation.sessionCompatibilityFingerprint &&
      !conversation.archivedAt
      ? [
          {
            conversationId,
            sessionId: conversation.sessionId,
            sessionCompatibilityFingerprint: conversation.sessionCompatibilityFingerprint,
            configuration: conversation.configuration,
            skills: conversation.mountedSkills,
            runtimeBinding: conversation.runtimeBinding ?? DEFAULT_AGENT_RUNTIME_BINDING,
          },
        ]
      : []
  })
}

/** 在 WorkspaceState hydrate 后预热所有 Claude SDK 会话，不依赖某个面板是否挂载。 */
export function useAgentConversationRestore(enabled: boolean): void {
  const conversations = useAgentStore((state) => state.conversations)
  const conversationOrder = useAgentStore((state) => state.conversationOrder)
  const restoredSessionsRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    if (!enabled) return

    const sessions = collectRestorableAgentSessions(conversations, conversationOrder)
    const liveConversationIds = new Set(sessions.map((session) => session.conversationId))
    for (const conversationId of restoredSessionsRef.current.keys()) {
      if (!liveConversationIds.has(conversationId)) {
        restoredSessionsRef.current.delete(conversationId)
      }
    }

    for (const session of sessions) {
      const skillKey = session.skills.map((skill) => `${skill.skillId}@${skill.version}`).join(',')
      const runtimeKey =
        session.runtimeBinding.kind === 'acp'
          ? `acp:${session.runtimeBinding.implementationId}`
          : 'claude-code'
      const restoreKey = `${session.sessionId}:${session.sessionCompatibilityFingerprint}:${session.configuration.roleRef.roleId}@${session.configuration.roleRef.version}:${session.configuration.revision}:${skillKey}:${runtimeKey}`
      if (restoredSessionsRef.current.get(session.conversationId) === restoreKey) continue
      restoredSessionsRef.current.set(session.conversationId, restoreKey)
      void window.cclinkStudio.agent
        .restoreConversation(
          session.conversationId,
          session.sessionId,
          session.configuration,
          session.sessionCompatibilityFingerprint,
          session.skills,
          session.runtimeBinding,
        )
        .catch(() => {
          if (restoredSessionsRef.current.get(session.conversationId) === restoreKey) {
            restoredSessionsRef.current.delete(session.conversationId)
          }
        })
    }
  }, [conversationOrder, conversations, enabled])
}
