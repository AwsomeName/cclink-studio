import { describe, expect, it, vi } from 'vitest'
import { BrowserTaskRuntime, summarizeBrowserActionParams } from './browser-task-runtime'

function createRuntime(): { runtime: BrowserTaskRuntime; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send },
  } as any
  return { runtime: new BrowserTaskRuntime(mainWindow), send }
}

describe('BrowserTaskRuntime', () => {
  it('routes task events to the current tab owner before falling back to main', () => {
    const ownerSend = vi.fn(() => true)
    const send = vi.fn()
    const runtime = new BrowserTaskRuntime(
      { isDestroyed: () => false, webContents: { send } } as any,
      ownerSend,
    )

    runtime.startTask({ tabId: 'browser-detached', goal: 'inspect' })

    expect(ownerSend).toHaveBeenCalledWith(
      'browser-detached',
      'browserTask:changed',
      expect.any(Object),
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('starts one active task per tab and cancels the previous task', () => {
    const { runtime } = createRuntime()

    const first = runtime.startTask({ tabId: 'browser', goal: 'first goal' })
    const second = runtime.startTask({ tabId: 'browser', goal: 'second goal' })

    expect(runtime.getTask(first.id)?.status).toBe('cancelled')
    expect(runtime.getActiveTaskForTab('browser')?.id).toBe(second.id)
  })

  it('blocks actions after pause and cancel', () => {
    const { runtime } = createRuntime()
    const task = runtime.startTask({ tabId: 'browser', goal: 'fill form' })

    runtime.pauseTask(task.id)
    expect(() => runtime.assertCanRunAction('browser')).toThrow('Browser task is paused')

    runtime.cancelTask(task.id)
    expect(() => runtime.assertCanRunAction('browser')).toThrow('Browser task is cancelled')
  })

  it('keeps completed tasks out of the active task map', () => {
    const { runtime } = createRuntime()
    const task = runtime.startTask({ tabId: 'browser', goal: 'read page' })

    runtime.finishTask(task.id)

    expect(runtime.getTask(task.id)?.status).toBe('completed')
    expect(runtime.getActiveTaskForTab('browser')).toBeNull()
    expect(runtime.assertCanRunAction('browser')).toBeNull()
  })

  it('records action logs and failure reasons', () => {
    const { runtime } = createRuntime()
    const task = runtime.startTask({ tabId: 'browser', goal: 'download file' })
    const log = runtime.startActionLog({
      taskRunId: task.id,
      tabId: 'browser',
      action: 'waitForDownload',
      paramsSummary: '{}',
    })

    runtime.failActionLog(log.id, {
      reason: 'download_failed',
      errorMessage: 'download interrupted',
    })

    expect(runtime.listActionLogs(task.id)).toMatchObject([
      {
        id: log.id,
        status: 'failed',
        failureReason: 'download_failed',
        errorMessage: 'download interrupted',
      },
    ])
  })

  it('keeps Agent correlation immutable and only emits real updates', () => {
    const { runtime, send } = createRuntime()
    const task = runtime.startTask({
      tabId: 'browser',
      goal: 'inspect page',
      correlation: {
        workspaceKey: '/workspace-a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentSessionRef: null,
        profileId: 'profile-a',
      },
    })

    task.correlation!.conversationId = 'mutated-outside-runtime'
    expect(runtime.getTask(task.id)?.correlation?.conversationId).toBe('conversation-a')

    const sendsBeforeNoop = send.mock.calls.length
    runtime.updateCorrelation(task.id, { agentRunId: 'run-a' })
    expect(send).toHaveBeenCalledTimes(sendsBeforeNoop)

    runtime.updateCorrelation(task.id, { agentSessionRef: 'session-reference' })
    expect(runtime.getTask(task.id)?.correlation?.agentSessionRef).toBe('session-reference')
    expect(send).toHaveBeenCalledTimes(sendsBeforeNoop + 1)
  })

  it('resolves the active browser task by conversation without following another tab', () => {
    const { runtime } = createRuntime()
    const taskA = runtime.startTask({
      tabId: 'browser-a',
      goal: 'inspect A',
      correlation: {
        workspaceKey: '/workspace-a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentSessionRef: null,
        profileId: null,
      },
    })
    runtime.startTask({
      tabId: 'browser-b',
      goal: 'inspect B',
      correlation: {
        workspaceKey: '/workspace-b',
        conversationId: 'conversation-b',
        agentRunId: 'run-b',
        agentSessionRef: null,
        profileId: null,
      },
    })

    expect(runtime.getActiveTaskForConversation('conversation-a')).toMatchObject({
      id: taskA.id,
      tabId: 'browser-a',
    })
    expect(runtime.getActiveTaskForConversation('conversation-a', '/workspace-b')).toBeNull()
  })

  it('redacts sensitive browser action params', () => {
    expect(
      summarizeBrowserActionParams('fill', {
        selector: 'input[type=password]',
        value: 'secret-value',
      }),
    ).toContain('[redacted:12 chars]')

    expect(
      summarizeBrowserActionParams('evaluate', {
        expression: 'localStorage.getItem("token")',
      }),
    ).toContain('[javascript:29 chars]')

    expect(
      summarizeBrowserActionParams('setCookie', {
        name: 'session',
        value: 'cookie-value',
      }),
    ).toContain('[redacted]')
  })

  it('leases one registered account to one Agent conversation and releases it on completion', () => {
    const { runtime } = createRuntime()
    const correlation = {
      workspaceKey: '/workspace-a',
      conversationId: 'conversation-a',
      agentRunId: 'run-a',
      agentSessionRef: null,
      profileId: 'profile-a',
      accountId: 'account-a',
      allowedOrigins: ['https://example.com'],
    }
    const first = runtime.startTask({ tabId: 'browser-a', goal: 'inspect', correlation })

    expect(() =>
      runtime.startTask({
        tabId: 'browser-b',
        goal: 'other',
        correlation: { ...correlation, conversationId: 'conversation-b' },
      }),
    ).toThrow('另一个 Agent 任务')

    runtime.finishTask(first.id)
    expect(() =>
      runtime.startTask({
        tabId: 'browser-b',
        goal: 'other',
        correlation: { ...correlation, conversationId: 'conversation-b' },
      }),
    ).not.toThrow()
  })

  it('requires re-observation after human takeover is returned', () => {
    const { runtime } = createRuntime()
    const task = runtime.startTask({ tabId: 'browser', goal: 'fill form' })

    runtime.pauseForTakeover(task.id, '需要验证码')
    const resumed = runtime.resumeTask(task.id)
    expect(resumed.reobservationRequired).toBe(true)
    expect(resumed.takeoverReason).toBe('需要验证码')

    const reobserved = runtime.markReobserved(task.id)
    expect(reobserved.reobservationRequired).toBe(false)
    expect(reobserved.takeoverReason).toBeUndefined()
  })

  it('adds the user-confirmed current origin when an account task is handed back', () => {
    const { runtime } = createRuntime()
    const task = runtime.startTask({
      tabId: 'browser',
      goal: 'continue on redirected provider page',
      correlation: {
        workspaceKey: '/workspace-a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentSessionRef: null,
        profileId: 'profile-a',
        accountId: 'account-a',
        allowedOrigins: ['https://accounts.example.com'],
      },
    })
    runtime.pauseForTakeover(task.id, '跨站身份确认')

    const resumed = runtime.resumeTask(task.id, 'https://console.example.net/application/1')

    expect(resumed.correlation?.allowedOrigins).toEqual([
      'https://accounts.example.com',
      'https://console.example.net',
    ])
    expect(resumed.reobservationRequired).toBe(true)
  })
})
