import { describe, expect, it, vi } from 'vitest'
import { handleCadModificationStreamEvent } from './cad-modification-auto-open'

function createRuntime(overrides: Record<string, unknown> = {}) {
  return {
    activeConversationId: 'conversation-1',
    activeRunId: 'run-1',
    workspaceRef: { kind: 'local' as const, path: '/workspace/project' },
    findToolName: vi.fn(() => 'cad_modify_step'),
    openModel: vi.fn(),
    consumedToolUseIds: new Set<string>(),
    ...overrides,
  }
}

const result = {
  kind: 'cad-modification-result',
  success: true,
  outputPath: '/workspace/project/model-longer.step',
}

describe('handleCadModificationStreamEvent', () => {
  it('opens a successful live Claude tool result in the active local workspace', () => {
    const runtime = createRuntime({
      findToolName: vi.fn(() => 'mcp__cclink_studio__cad_modify_step'),
    })
    const opened = handleCadModificationStreamEvent(
      {
        type: 'user',
        conversationId: 'conversation-1',
        runId: 'run-1',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: [{ type: 'text', text: JSON.stringify(result) }],
            },
          ],
        },
      },
      runtime,
    )

    expect(opened).toBe(true)
    expect(runtime.openModel).toHaveBeenCalledWith(result.outputPath, runtime.workspaceRef)
  })

  it('opens a completed Studio tool event and ignores a duplicate toolUseId', () => {
    const runtime = createRuntime()
    const event = {
      protocol: 'studio-agent-event-v1' as const,
      conversationId: 'conversation-1',
      runId: 'run-1',
      event: {
        type: 'tool',
        toolCallId: 'tool-2',
        name: 'cad_modify_step',
        status: 'completed',
        output: { structuredContent: result },
      },
    }

    expect(handleCadModificationStreamEvent(event, runtime)).toBe(true)
    expect(handleCadModificationStreamEvent(event, runtime)).toBe(false)
    expect(runtime.openModel).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ conversationId: 'conversation-old', runId: 'run-1' }, 'another conversation'],
    [{ conversationId: 'conversation-1', runId: 'run-old' }, 'a stale or restored run'],
    [{ conversationId: 'conversation-1', runId: undefined }, 'history without a live run'],
  ])(
    'ignores %s from %s',
    (identity: { conversationId: string; runId?: string }, _label: string) => {
      const runtime = createRuntime()
      const opened = handleCadModificationStreamEvent(
        {
          type: 'user',
          ...identity,
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'tool-3', content: result }],
          },
        },
        runtime,
      )

      expect(opened).toBe(false)
      expect(runtime.openModel).not.toHaveBeenCalled()
    },
  )

  it('ignores failed results, other tools, remote workspaces, and output outside the workspace', () => {
    const failedRuntime = createRuntime()
    expect(
      handleCadModificationStreamEvent(
        {
          type: 'user',
          conversationId: 'conversation-1',
          runId: 'run-1',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tool-4', content: result, is_error: true },
            ],
          },
        },
        failedRuntime,
      ),
    ).toBe(false)

    const otherToolRuntime = createRuntime({ findToolName: () => 'editor_write' })
    expect(
      handleCadModificationStreamEvent(
        {
          type: 'user',
          conversationId: 'conversation-1',
          runId: 'run-1',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tool-5', content: result }] },
        },
        otherToolRuntime,
      ),
    ).toBe(false)

    const outsideRuntime = createRuntime()
    expect(
      handleCadModificationStreamEvent(
        {
          type: 'user',
          conversationId: 'conversation-1',
          runId: 'run-1',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-6',
                content: { ...result, outputPath: '/workspace/project-other/model.step' },
              },
            ],
          },
        },
        outsideRuntime,
      ),
    ).toBe(false)

    const remoteRuntime = createRuntime({
      workspaceRef: {
        kind: 'remote' as const,
        transport: 'cclink' as const,
        endpointId: 'e',
        workspaceId: 'w',
        path: '/remote',
      },
    })
    expect(
      handleCadModificationStreamEvent(
        {
          type: 'user',
          conversationId: 'conversation-1',
          runId: 'run-1',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tool-7', content: result }] },
        },
        remoteRuntime,
      ),
    ).toBe(false)
  })
})
