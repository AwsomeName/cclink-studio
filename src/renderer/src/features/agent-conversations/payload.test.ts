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
    useAgentStore.getState().setSessionId('session-123', conversationId)

    const conversation = useAgentStore.getState().conversations[conversationId]
    expect(buildAgentSendPayload('继续', conversation)).toMatchObject({
      message: '继续',
      sessionId: 'session-123',
      workspaceRef: { kind: 'local', path: '/Users/apple/Desktop/previous-project' },
    })
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
