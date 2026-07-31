import { describe, expect, it } from 'vitest'
import { buildAgentConversationTimeline } from './AgentConversationTimeline'

describe('buildAgentConversationTimeline', () => {
  it('把角色配置事件按时间插入同一会话历史', () => {
    const timeline = buildAgentConversationTimeline(
      [
        {
          id: 'message-before',
          role: 'user',
          content: [{ type: 'text', text: 'before' }],
          rawText: 'before',
          timestamp: 1,
        },
        {
          id: 'message-after',
          role: 'user',
          content: [{ type: 'text', text: 'after' }],
          rawText: 'after',
          timestamp: 3,
        },
      ],
      [
        {
          id: 'event-1',
          type: 'configuration-changed',
          fromRoleRef: { roleId: 'default-assistant', version: 1 },
          toRoleRef: { roleId: 'critical-challenger', version: 1 },
          configurationRevision: 2,
          timestamp: 2,
        },
      ],
    )

    expect(timeline.map((item) => item.kind)).toEqual(['message', 'configuration', 'message'])
  })
})
