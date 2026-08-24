import { describe, expect, it, vi } from 'vitest'
import { AgentBridge } from './agent-bridge'

describe('AgentBridge browser send plan', () => {
  it('keeps all-scope messages unbound instead of opening a browser from message text', () => {
    const waitForActiveViewForWorkspace = vi.fn()
    const bridge = createBridge({ kind: 'all' }, { waitForActiveViewForWorkspace })

    const plan = bridge.resolveSendPlan('conversation-a', {
      workspaceRef: { kind: 'local', path: '/workspace/a' },
    })

    expect(plan).toEqual({
      options: { forceVisibleBrowser: false },
      browserTabId: null,
      workspaceKey: '/workspace/a',
    })
    expect(waitForActiveViewForWorkspace).not.toHaveBeenCalled()
  })

  it('still binds a browser explicitly selected by scope', () => {
    const bridge = createBridge(
      { kind: 'browser', instanceId: 'browser-a' },
      { getViewWorkspaceKey: () => '/workspace/a' },
    )

    expect(
      bridge.resolveSendPlan('conversation-a', {
        workspaceRef: { kind: 'local', path: '/workspace/a' },
      }),
    ).toMatchObject({
      options: { forceVisibleBrowser: true },
      browserTabId: 'browser-a',
    })
  })

  it('finishes a browser task lazily created by the first browser tool call', () => {
    const finishTask = vi.fn()
    const updateCorrelation = vi.fn()
    const bridge = createBridge(
      { kind: 'all' },
      {},
      {
        getActiveTaskForConversation: () => ({ id: 'lazy-task' }),
        finishTask,
        updateCorrelation,
      },
    )

    bridge.finishActiveBrowserTask('conversation-a')

    expect(updateCorrelation).toHaveBeenCalledWith('lazy-task', {
      agentRunId: 'run-a',
      agentSessionRef: null,
    })
    expect(finishTask).toHaveBeenCalledWith('lazy-task')
  })

  it('turns a claimed browser completion into failure when no visible action succeeded', () => {
    const bridge = createBridge(
      { kind: 'all' },
      {},
      {
        getActiveTaskForConversation: () => ({ id: 'browser-task' }),
        listActionLogs: () => [
          { id: 'failed-action', taskRunId: 'browser-task', status: 'failed' },
        ],
      },
    )

    expect(
      bridge.normalizeBrowserTerminalEvent({
        conversationId: 'conversation-a',
        runId: 'run-a',
        type: 'complete',
        data: { result: '已经打开百度站长' },
      }),
    ).toMatchObject({
      type: 'error',
      data: {
        code: 'visible_browser_action_not_verified',
        message: expect.stringContaining('页面没有被打开或修改'),
      },
    })
  })

  it('keeps browser completion only after a visible Studio action succeeds', () => {
    const bridge = createBridge(
      { kind: 'all' },
      {},
      {
        getActiveTaskForConversation: () => ({ id: 'browser-task' }),
        listActionLogs: () => [{ id: 'ok-action', taskRunId: 'browser-task', status: 'succeeded' }],
      },
    )
    const event = {
      conversationId: 'conversation-a',
      runId: 'run-a',
      type: 'complete' as const,
      data: { result: '已经打开百度站长' },
    }

    expect(bridge.normalizeBrowserTerminalEvent(event)).toBe(event)
  })
})

function createBridge(
  scope: { kind: 'all' } | { kind: 'browser'; instanceId: string },
  browserManager: Record<string, unknown>,
  browserTaskRuntime?: Record<string, unknown>,
): {
  resolveSendPlan: (
    conversationId: string,
    context?: { workspaceRef?: { kind: 'local'; path: string } },
  ) => {
    options: { forceVisibleBrowser: boolean }
    browserTabId: string | null
    workspaceKey: string | null
  }
  finishActiveBrowserTask: (conversationId: string) => void
  normalizeBrowserTerminalEvent: (event: {
    conversationId: string
    runId: string | null
    type: 'stream' | 'complete' | 'error' | 'system'
    data: unknown
  }) => {
    conversationId: string
    runId: string | null
    type: 'stream' | 'complete' | 'error' | 'system'
    data: unknown
  }
} {
  const bridge = Object.create(AgentBridge.prototype) as Record<string, unknown>
  bridge.runtime = {
    getScope: () => scope,
    getStatus: () => ({ runId: 'run-a', sessionId: null }),
  }
  bridge.deps = { browserManager, browserTaskRuntime }
  bridge.activeBrowserTaskIds = new Map()
  bridge.sessionDiagnosticRefs = { get: () => null }
  return bridge as never
}
