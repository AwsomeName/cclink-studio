import { describe, expect, it } from 'vitest'
import type { AgentConversationState } from '../../stores/agent-store'
import { getRunningProjectCounts } from './project-activity'

function conversation(
  id: string,
  workspacePath: string,
  overrides: Partial<AgentConversationState> = {},
): AgentConversationState {
  const now = Date.now()
  return {
    id,
    title: id,
    surface: 'assistant-panel',
    runtime: {
      location: 'local',
      transport: 'local',
      workspaceRef: { kind: 'local', path: workspacePath },
    },
    messages: [],
    input: '',
    loading: false,
    backendState: 'connected',
    runStatus: 'idle',
    sessionId: null,
    streamingMessageId: null,
    lastCost: null,
    scope: { kind: 'all' },
    mountedResources: [],
    mountedSkills: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  }
}

describe('getRunningProjectCounts', () => {
  it('按工作区统计运行中的未归档会话', () => {
    const counts = getRunningProjectCounts({
      a: conversation('a', '/workspace/a', { loading: true, runStatus: 'starting' }),
      b: conversation('b', '/workspace/a', { runStatus: 'running' }),
      c: conversation('c', '/workspace/b', { runStatus: 'completed' }),
      d: conversation('d', '/workspace/b', { loading: true, archivedAt: Date.now() }),
    })

    expect(counts.get('/workspace/a')).toBe(2)
    expect(counts.has('/workspace/b')).toBe(false)
  })
})
