import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore } from '../../stores/agent-store'
import type { AgentMountedResource } from '../../types'
import {
  buildAgentSendPayload,
  MAX_FILE_RANGE_BYTES,
  MAX_FILE_RANGE_LINES,
  transientMessageResources,
} from './payload'

describe('buildAgentSendPayload', () => {
  const sessionCompatibilityFingerprint = 'a'.repeat(64)

  beforeEach(() => {
    useAgentStore.setState(useAgentStore.getInitialState(), true)
  })

  it('includes the persisted SDK session and conversation workspace', () => {
    const conversationId = useAgentStore.getState().createConversation({
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: { kind: 'local', path: '/Users/apple/Desktop/previous-project' },
      },
    })
    useAgentStore
      .getState()
      .setSessionId('session-123', conversationId, sessionCompatibilityFingerprint)

    const conversation = useAgentStore.getState().conversations[conversationId]
    expect(buildAgentSendPayload('继续', conversation)).toMatchObject({
      message: '继续',
      sessionId: 'session-123',
      sessionCompatibilityFingerprint,
      profileRef: { profileId: 'default-assistant', version: 1 },
      workspaceRef: { kind: 'local', path: '/Users/apple/Desktop/previous-project' },
    })
  })

  it('includes bounded visible history and the latest todo state for recovery', () => {
    const conversationId = useAgentStore.getState().createConversation()
    const conversation = useAgentStore.getState().conversations[conversationId]!
    conversation.messages = [
      {
        id: 'user-1',
        role: 'user',
        content: [{ type: 'text', text: '按顺序读取第九篇和第十篇' }],
        rawText: '按顺序读取第九篇和第十篇',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '不应进入连续性快照' },
          { type: 'text', text: '第九篇已经处理完成，接下来读取第十篇。' },
          {
            type: 'tool_use',
            id: 'todo-1',
            name: 'TodoWrite',
            input: {
              todos: [
                { content: '总结第九篇', status: 'completed' },
                { content: '读取第十篇', status: 'in_progress' },
              ],
            },
          },
        ],
        rawText: '不应进入连续性快照第九篇已经处理完成，接下来读取第十篇。',
        timestamp: 2,
      },
      {
        id: 'user-current',
        role: 'user',
        content: [{ type: 'text', text: '继续' }],
        rawText: '继续',
        timestamp: 3,
      },
    ]

    const payload = buildAgentSendPayload('继续', conversation)

    expect(payload.continuity).toEqual({
      recentMessages: [
        { role: 'user', text: '按顺序读取第九篇和第十篇' },
        { role: 'assistant', text: '第九篇已经处理完成，接下来读取第十篇。' },
      ],
      tasks: [
        { content: '总结第九篇', status: 'completed' },
        { content: '读取第十篇', status: 'in_progress' },
      ],
    })
    expect(JSON.stringify(payload.continuity)).not.toContain('不应进入连续性快照')
  })

  it('keeps recent user intent when assistant progress messages fill the tail', () => {
    const conversationId = useAgentStore.getState().createConversation()
    const conversation = useAgentStore.getState().conversations[conversationId]!
    conversation.messages = [
      {
        id: 'user-goal',
        role: 'user',
        content: [{ type: 'text', text: '先完成第九篇，再继续第十篇' }],
        rawText: '先完成第九篇，再继续第十篇',
        timestamp: 1,
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `assistant-${index}`,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: `进度 ${index + 1}` }],
        rawText: `进度 ${index + 1}`,
        timestamp: index + 2,
      })),
    ]

    const continuity = buildAgentSendPayload('继续', conversation).continuity

    expect(continuity?.recentMessages[0]).toEqual({
      role: 'user',
      text: '先完成第九篇，再继续第十篇',
    })
    expect(continuity?.recentMessages.at(-1)).toEqual({ role: 'assistant', text: '进度 12' })
    expect(continuity?.recentMessages.length).toBeLessThanOrEqual(10)
  })

  it('sends the immutable markdown range snapshot with its source coordinates', () => {
    const conversationId = useAgentStore.getState().createConversation()
    const resource = fileRangeResource({
      sourceSnapshot: '## 第二节\n\n原始选区内容',
      selectedText: '原始选区内容',
    })
    useAgentStore.getState().addMountedResource(resource, conversationId)

    const payload = buildAgentSendPayload(
      '继续整理',
      useAgentStore.getState().conversations[conversationId],
    )

    expect(payload.resources).toEqual([
      expect.objectContaining({
        kind: 'file-range',
        ref: expect.objectContaining({
          path: '/workspace/guide.md',
          startLine: 8,
          endLine: 10,
          selectedText: '原始选区内容',
          sourceSnapshot: '## 第二节\n\n原始选区内容',
          snapshotHash: 'snapshot-1',
          dirty: true,
        }),
      }),
    ])
  })

  it('drops markdown selections that exceed the per-range line or byte limits', () => {
    const conversationId = useAgentStore.getState().createConversation()
    useAgentStore.getState().addMountedResource(
      fileRangeResource({
        id: 'too-many-lines',
        endLine: 8 + MAX_FILE_RANGE_LINES,
        sourceSnapshot: 'line',
      }),
      conversationId,
    )
    useAgentStore.getState().addMountedResource(
      fileRangeResource({
        id: 'too-many-bytes',
        sourceSnapshot: '中'.repeat(MAX_FILE_RANGE_BYTES),
      }),
      conversationId,
    )

    const payload = buildAgentSendPayload(
      '继续整理',
      useAgentStore.getState().conversations[conversationId],
    )

    expect(payload.resources).toEqual([])
  })

  it('marks only file ranges as transient message resources', () => {
    const range = fileRangeResource({})
    const file: AgentMountedResource = {
      id: 'file:/workspace/guide.md',
      kind: 'file',
      label: 'guide.md',
      ref: { type: 'file', path: '/workspace/guide.md' },
    }

    expect(transientMessageResources([file, range])).toEqual([range])
  })

  it('sends pending images separately and records only bounded image metadata in the user message', () => {
    const conversationId = useAgentStore.getState().createConversation()
    const image = {
      id: 'image-1',
      name: 'screen.png',
      mediaType: 'image/png' as const,
      data: 'AQID',
      size: 3,
    }
    useAgentStore.getState().addPendingImages([image], conversationId)
    const conversation = useAgentStore.getState().conversations[conversationId]

    expect(buildAgentSendPayload('看看这里', conversation).images).toEqual([image])
    expect(transientMessageResources([], [image])).toEqual([
      {
        id: 'image-1',
        kind: 'image',
        label: 'screen.png',
        detail: 'image/png · 3 B',
        ref: { type: 'image', mediaType: 'image/png', size: 3 },
      },
    ])
    expect(JSON.stringify(transientMessageResources([], [image]))).not.toContain('AQID')
  })
})

function fileRangeResource(
  overrides: Partial<AgentMountedResource['ref']> & { id?: string },
): AgentMountedResource {
  const { id = 'file-range:guide:8:10', ...refOverrides } = overrides
  return {
    id,
    kind: 'file-range',
    label: 'guide.md:L8-L10',
    detail: '/workspace/guide.md 第 8-10 行',
    ref: {
      type: 'file-range',
      path: '/workspace/guide.md',
      tabId: 'tab-guide',
      format: 'markdown',
      startLine: 8,
      endLine: 10,
      sourceSnapshot: '## 第二节\n\n原始选区内容',
      selectedText: '原始选区内容',
      snapshotHash: 'snapshot-1',
      dirty: true,
      ...refOverrides,
    },
  }
}
