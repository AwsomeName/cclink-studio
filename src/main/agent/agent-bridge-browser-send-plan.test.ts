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

  it.each(['failed', 'cancelled'] as const)(
    'blocks Agent success when the exact BrowserTask is %s',
    (status) => {
      const task = { id: 'browser-task', status, reobservationRequired: false }
      const bridge = createBridge(
        { kind: 'all' },
        {},
        {
          getTaskForAgentRun: () => task,
          getTask: () => task,
          listActionLogs: () => [
            { id: 'ok-action', taskRunId: 'browser-task', status: 'succeeded' },
          ],
        },
      )

      expect(
        bridge.normalizeBrowserTerminalEvent({
          conversationId: 'conversation-a',
          runId: 'run-a',
          type: 'complete',
          data: { result: 'done' },
        }),
      ).toMatchObject({
        type: 'error',
        data: { code: 'browser_task_not_successful' },
      })
    },
  )

  it('blocks Agent success while a dispatched result still requires re-observation', () => {
    const task = {
      id: 'browser-task',
      status: 'running',
      reobservationRequired: true,
    }
    const bridge = createBridge(
      { kind: 'all' },
      {},
      {
        getTaskForAgentRun: () => task,
        getTask: () => task,
        listActionLogs: () => [{ id: 'ok-action', taskRunId: 'browser-task', status: 'succeeded' }],
      },
    )

    expect(
      bridge.normalizeBrowserTerminalEvent({
        conversationId: 'conversation-a',
        runId: 'run-a',
        type: 'complete',
        data: { result: 'done' },
      }),
    ).toMatchObject({
      type: 'error',
      data: { code: 'browser_reobservation_required' },
    })
  })

  it('reports a human takeover pause without calling it an unknown browser result', () => {
    const task = {
      id: 'browser-task',
      status: 'paused',
      reobservationRequired: true,
      takeoverReason: '网页验证码需要人工处理',
    }
    const bridge = createBridge(
      { kind: 'all' },
      {},
      {
        getTaskForAgentRun: () => task,
        getTask: () => task,
        listActionLogs: () => [],
      },
    )

    expect(
      bridge.normalizeBrowserTerminalEvent({
        conversationId: 'conversation-a',
        runId: 'run-a',
        type: 'complete',
        data: { result: '请用户接管' },
      }),
    ).toMatchObject({
      type: 'error',
      data: {
        code: 'browser_task_waiting_human',
        message: expect.stringContaining('网页验证码需要人工处理'),
      },
    })
  })

  it('uses the event run id instead of a newer active BrowserTask', () => {
    const oldTask = { id: 'old-task', status: 'failed' }
    const currentTask = { id: 'current-task', status: 'running' }
    const bridge = createBridge(
      { kind: 'all' },
      {},
      {
        getTaskForAgentRun: (_conversationId: string, runId: string) =>
          runId === 'run-old' ? oldTask : currentTask,
        getTask: (taskId: string) => (taskId === 'old-task' ? oldTask : currentTask),
        getActiveTaskForConversation: () => currentTask,
        listActionLogs: () => [{ id: 'ok', taskRunId: 'old-task', status: 'succeeded' }],
      },
    )

    expect(
      bridge.normalizeBrowserTerminalEvent({
        conversationId: 'conversation-a',
        runId: 'run-old',
        type: 'complete',
        data: { result: 'late success' },
      }),
    ).toMatchObject({
      type: 'error',
      data: { code: 'browser_task_not_successful' },
    })
  })

  it('reports a correlated article publishing task when its BrowserTask fails', () => {
    const onCorrelatedBrowserTaskEnded = vi.fn()
    const task = {
      id: 'browser-task',
      tabId: 'tab-a',
      correlation: {
        workspaceKey: '/workspace/a',
        affairId: 'affair-a',
        affairAttemptId: 'attempt-a',
        affairExecutionGeneration: 1,
        affairLaunchOperationId: 'launch-a',
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        playwrightConnectionGeneration: 3,
        playwrightPageBindingGeneration: 4,
      },
    }
    const failTask = vi.fn()
    const bridge = createBridge(
      { kind: 'all' },
      {},
      {
        getTask: () => task,
        getActiveTaskForConversation: () => task,
        updateCorrelation: vi.fn(),
        failTask,
      },
      onCorrelatedBrowserTaskEnded,
    )

    bridge.failActiveBrowserTask('conversation-a', { message: 'automation unavailable' })

    expect(failTask).toHaveBeenCalledWith('browser-task', {
      reason: 'unknown',
      errorMessage: 'automation unavailable',
    })
    expect(onCorrelatedBrowserTaskEnded).toHaveBeenCalledWith({
      workspacePath: '/workspace/a',
      affairId: 'affair-a',
      attemptId: 'attempt-a',
      browserTaskRunId: 'browser-task',
      executionGeneration: 1,
      launchOperationId: 'launch-a',
      tabId: 'tab-a',
      browserViewRuntimeGeneration: 2,
      webContentsId: 20,
      playwrightConnectionGeneration: 3,
      playwrightPageBindingGeneration: 4,
      reason: 'Agent Run 或 BrowserTask 失败：automation unavailable',
    })
  })

  it('reports every correlated publishing task when a later task in the same Run is unbound', () => {
    const onCorrelatedBrowserTaskEnded = vi.fn()
    const publishingTask = {
      id: 'publishing-task',
      tabId: 'tab-a',
      status: 'failed',
      correlation: {
        workspaceKey: '/workspace/a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        affairId: 'affair-a',
        affairAttemptId: 'attempt-a',
        affairExecutionGeneration: 1,
        affairLaunchOperationId: 'launch-a',
        browserViewRuntimeGeneration: 2,
        webContentsId: 20,
        playwrightConnectionGeneration: 3,
        playwrightPageBindingGeneration: 4,
      },
    }
    const laterUnboundTask = {
      id: 'later-unbound-task',
      status: 'running',
      correlation: {
        workspaceKey: '/workspace/a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
      },
    }
    const bridge = createBridge(
      { kind: 'all' },
      {},
      {
        getTask: () => laterUnboundTask,
        getTaskForAgentRun: () => laterUnboundTask,
        getActiveTaskForConversation: () => laterUnboundTask,
        listTasks: () => [publishingTask, laterUnboundTask],
        updateCorrelation: vi.fn(),
        failTask: vi.fn(),
      },
      onCorrelatedBrowserTaskEnded,
    )

    bridge.failActiveBrowserTask(
      'conversation-a',
      { message: 'automation unavailable' },
      undefined,
      'run-a',
    )

    expect(onCorrelatedBrowserTaskEnded).toHaveBeenCalledTimes(1)
    expect(onCorrelatedBrowserTaskEnded).toHaveBeenCalledWith({
      workspacePath: '/workspace/a',
      affairId: 'affair-a',
      attemptId: 'attempt-a',
      browserTaskRunId: 'publishing-task',
      executionGeneration: 1,
      launchOperationId: 'launch-a',
      tabId: 'tab-a',
      browserViewRuntimeGeneration: 2,
      webContentsId: 20,
      playwrightConnectionGeneration: 3,
      playwrightPageBindingGeneration: 4,
      reason: 'Agent Run 或 BrowserTask 失败：automation unavailable',
    })
  })
})

function createBridge(
  scope: { kind: 'all' } | { kind: 'browser'; instanceId: string },
  browserManager: Record<string, unknown>,
  browserTaskRuntime?: Record<string, unknown>,
  onCorrelatedBrowserTaskEnded?: (input: Record<string, unknown>) => void,
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
  failActiveBrowserTask: (
    conversationId: string,
    error: unknown,
    resolvedTaskId?: string | null,
    agentRunId?: string | null,
  ) => void
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
  bridge.deps = { browserManager, browserTaskRuntime, onCorrelatedBrowserTaskEnded }
  bridge.activeBrowserTaskIds = new Map()
  bridge.sessionDiagnosticRefs = { get: () => null }
  return bridge as never
}
