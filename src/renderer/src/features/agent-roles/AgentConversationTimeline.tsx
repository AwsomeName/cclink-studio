import type { AgentConversationConfigurationEvent, AgentRoleSummary } from '@shared/agent-role'
import type { AgentMessage } from '../../types'
import { ConversationMessageRenderer } from '../../components/common/ConversationMessageRenderer'

type TimelineItem =
  | { kind: 'message'; timestamp: number; value: AgentMessage }
  | { kind: 'configuration'; timestamp: number; value: AgentConversationConfigurationEvent }

export function buildAgentConversationTimeline(
  messages: AgentMessage[],
  events: AgentConversationConfigurationEvent[],
): TimelineItem[] {
  return [
    ...messages.map((value): TimelineItem => ({ kind: 'message', timestamp: value.timestamp, value })),
    ...events.map(
      (value): TimelineItem => ({ kind: 'configuration', timestamp: value.timestamp, value }),
    ),
  ].sort((left, right) => left.timestamp - right.timestamp)
}

export function AgentConversationTimeline({
  messages,
  configurationEvents,
  roles,
  conversationId,
  workspaceKey,
}: {
  messages: AgentMessage[]
  configurationEvents: AgentConversationConfigurationEvent[]
  roles: AgentRoleSummary[]
  conversationId: string
  workspaceKey: string | null
}): React.ReactElement {
  const labelRole = (roleId: string, version: number): string =>
    roles.find((role) => role.roleId === roleId && role.version === version)?.label ??
    `${roleId}@${version}`

  return (
    <>
      {buildAgentConversationTimeline(messages, configurationEvents).map((item) =>
        item.kind === 'message' ? (
          <ConversationMessageRenderer
            key={item.value.id}
            message={item.value}
            conversationId={conversationId}
            workspaceKey={workspaceKey}
          />
        ) : (
          <div className="agent-configuration-event" key={item.value.id} role="status">
            <span />
            <strong>
              角色已从「
              {labelRole(item.value.fromRoleRef.roleId, item.value.fromRoleRef.version)}」切换为「
              {labelRole(item.value.toRoleRef.roleId, item.value.toRoleRef.version)}」
            </strong>
            <em>配置 #{item.value.configurationRevision}</em>
            <span />
          </div>
        ),
      )}
    </>
  )
}
