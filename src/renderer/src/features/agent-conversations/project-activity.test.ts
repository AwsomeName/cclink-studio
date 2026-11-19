import { describe, expect, it } from 'vitest'
import type { AgentConversationState } from '../../stores/agent-store'
import { getRunningProjectCounts, conversationNeedsAttention } from './project-activity'

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
    configuration: {
      schemaVersion: 1,
      roleRef: { roleId: 'default-assistant', version: 1 },
      revision: 1,
      updatedAt: now,
    },
    configurationEvents: [],
    lastRunConfigurationReceipt: null,
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
    contextUsage: overrides.contextUsage ?? null,
    contextCompaction: overrides.contextCompaction ?? {
      status: 'idle',
      trigger: null,
      preTokens: null,
      postTokens: null,
      error: null,
      updatedAt: null,
    },
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

it('keeps interrupted and failed conversations discoverable without counting them as running', () => {
  const interrupted = conversation('interrupted', '/a', { runStatus: 'interrupted' })
  expect(conversationNeedsAttention(interrupted)).toBe(true)
  expect(conversationNeedsAttention(conversation('failed', '/a', { runStatus: 'failed' }))).toBe(
    true,
  )
  expect(conversationNeedsAttention(conversation('done', '/a', { runStatus: 'completed' }))).toBe(
    false,
  )
  expect(conversationNeedsAttention({ ...interrupted, archivedAt: Date.now() })).toBe(false)
  expect(getRunningProjectCounts({ interrupted }).size).toBe(0)
})
