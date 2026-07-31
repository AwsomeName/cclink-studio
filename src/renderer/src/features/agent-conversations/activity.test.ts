import { describe, expect, it } from 'vitest'
import type { AgentConversationState } from '../../stores/agent-store'
import { getConversationActivity } from './activity'

describe('agent conversation activity', () => {
  it('summarizes running tool activity', () => {
    const summary = getConversationActivity(
      conversation({
        loading: true,
        blocks: [{ type: 'tool_use', id: 'tool-1', name: 'browser_click', input: {} }],
      }),
    )

    expect(summary.kind).toBe('running')
    expect(summary.label).toBe('正在执行工具')
    expect(summary.detail).toBe('browser_click')
    expect(summary.toolCount).toBe(1)
  })

  it('surfaces tool result errors before idle status', () => {
    const summary = getConversationActivity(
      conversation({
        blocks: [
          { type: 'tool_use', id: 'tool-1', name: 'editor_write', input: {} },
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: '写入失败：文件不存在',
            is_error: true,
          },
        ],
      }),
    )

    expect(summary.kind).toBe('error')
    expect(summary.label).toBe('工具出错')
    expect(summary.detail).toContain('文件不存在')
    expect(summary.errorCount).toBe(1)
  })

  it('keeps archived sessions visible as closed activity', () => {
    const summary = getConversationActivity(conversation({ archivedAt: Date.now() }))

    expect(summary.kind).toBe('closed')
    expect(summary.label).toBe('已关闭')
  })
})

function conversation({
  loading = false,
  archivedAt = null,
  blocks = [],
}: {
  loading?: boolean
  archivedAt?: number | null
  blocks?: AgentConversationState['messages'][number]['content']
}): AgentConversationState {
  return {
    id: 'conversation',
    title: '工作会话',
    surface: 'workbench-tab',
    runtime: {
      location: 'local',
      transport: 'local',
      backend: 'cclink-studio-agent',
    },
    profileRef: { profileId: 'default-assistant', version: 1 },
    messages: [
      {
        id: 'welcome',
        role: 'assistant',
        content: [{ type: 'text', text: 'welcome' }],
        rawText: 'welcome',
        timestamp: Date.now(),
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: blocks,
        rawText: '',
        timestamp: Date.now(),
      },
    ],
    input: '',
    loading,
    backendState: loading ? 'streaming' : 'connected',
    sessionId: null,
    streamingMessageId: null,
    lastCost: null,
    contextUsage: null,
    contextCompaction: emptyContextCompaction(),
    scope: { kind: 'all' },
    mountedResources: [],
    mountedSkills: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archivedAt,
  }
}

function emptyContextCompaction(): AgentConversationState['contextCompaction'] {
  return {
    status: 'idle',
    trigger: null,
    preTokens: null,
    postTokens: null,
    error: null,
    updatedAt: null,
  }
}
