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

  it('blocks ordinary BrowserTasks for the whole account recovery window', () => {
    const { runtime } = createRuntime()
    const lease = runtime.acquireAccountRecoveryLease({
      accountId: 'account-a',
      profileId: 'profile-a',
      affairId: 'affair-a',
      attemptId: 'attempt-a',
      executionGeneration: 2,
      launchOperationId: 'launch-b',
    })
    const unbound = runtime.startTask({
      tabId: 'browser-unbound',
      goal: 'ordinary task',
      correlation: {
        workspaceKey: '/workspace-a',
        conversationId: 'conversation-b',
        agentRunId: 'run-b',
        agentSessionRef: null,
        profileId: 'profile-a',
      },
    })

    expect(() =>
      runtime.startTask({
        tabId: 'browser-b',
        goal: 'ordinary account task',
        correlation: {
          workspaceKey: '/workspace-a',
          conversationId: 'conversation-b',
          agentRunId: 'run-b',
          agentSessionRef: null,
          profileId: 'profile-a',
          accountId: 'account-a',
        },
      }),
    ).toThrow('正在恢复原网页事务')
    expect(() => runtime.updateCorrelation(unbound.id, { accountId: 'account-a' })).toThrow(
      '普通 BrowserTask 不能取得写入权',
    )
    expect(runtime.releaseAccountRecoveryLease(lease.id)).toBe(true)
  })

  it('atomically transfers a recovery lease and ignores stale recovery release', () => {
    const { runtime } = createRuntime()
    const lease = runtime.acquireAccountRecoveryLease({
      accountId: 'account-a',
      profileId: 'profile-a',
      affairId: 'affair-a',
      attemptId: 'attempt-a',
      executionGeneration: 2,
      launchOperationId: 'launch-b',
    })
    const task = runtime.startTask({
      tabId: 'browser-a',
      goal: 'resume publish',
      correlation: {
        workspaceKey: '/workspace-a',
        conversationId: 'conversation-a',
        agentRunId: 'run-b',
        agentSessionRef: null,
        profileId: 'profile-a',
      },
    })

    runtime.transferAccountRecoveryLeaseToTask(lease.id, task.id, {
      affairId: 'affair-a',
      affairAttemptId: 'attempt-a',
      affairExecutionGeneration: 2,
      affairLaunchOperationId: 'launch-b',
    })

    expect(runtime.getTask(task.id)?.correlation?.accountId).toBe('account-a')
    expect(runtime.releaseAccountRecoveryLease(lease.id)).toBe(false)
    expect(() =>
      runtime.startTask({
        tabId: 'browser-b',
        goal: 'race after handoff',
        correlation: {
          workspaceKey: '/workspace-a',
          conversationId: 'conversation-b',
          agentRunId: 'run-c',
          agentSessionRef: null,
          profileId: 'profile-a',
          accountId: 'account-a',
        },
      }),
    ).toThrow('另一个 Agent 任务')

    runtime.finishTask(task.id)
    expect(() =>
      runtime.startTask({
        tabId: 'browser-b',
        goal: 'after terminal release',
        correlation: {
          workspaceKey: '/workspace-a',
          conversationId: 'conversation-b',
          agentRunId: 'run-c',
          agentSessionRef: null,
          profileId: 'profile-a',
          accountId: 'account-a',
        },
      }),
    ).not.toThrow()
  })

  it('rejects stale or mismatched recovery lease handoff without releasing the live owner', () => {
    const { runtime } = createRuntime()
    const stale = runtime.acquireAccountRecoveryLease({
      accountId: 'account-a',
      profileId: 'profile-a',
      affairId: 'affair-a',
      attemptId: 'attempt-a',
      executionGeneration: 1,
      launchOperationId: 'launch-a',
    })
    runtime.releaseAccountRecoveryLease(stale.id)
    const current = runtime.acquireAccountRecoveryLease({
      accountId: 'account-a',
      profileId: 'profile-a',
      affairId: 'affair-a',
      attemptId: 'attempt-a',
      executionGeneration: 2,
      launchOperationId: 'launch-b',
    })
    const task = runtime.startTask({
      tabId: 'browser-a',
      goal: 'resume publish',
      correlation: {
        workspaceKey: '/workspace-a',
        conversationId: 'conversation-a',
        agentRunId: 'run-b',
        agentSessionRef: null,
        profileId: 'profile-a',
      },
    })

    expect(() => runtime.transferAccountRecoveryLeaseToTask(stale.id, task.id, {})).toThrow(
      '恢复租约已失效',
    )
    expect(() =>
      runtime.transferAccountRecoveryLeaseToTask(current.id, task.id, {
        affairId: 'affair-a',
        affairAttemptId: 'attempt-a',
        affairExecutionGeneration: 1,
        affairLaunchOperationId: 'launch-b',
      }),
    ).toThrow('事务代次不匹配')
    expect(runtime.releaseAccountRecoveryLease(stale.id)).toBe(false)
    expect(runtime.releaseAccountRecoveryLease(current.id)).toBe(true)
  })

  it('replaces a paused BrowserTask only when resuming the same affair Attempt', () => {
    const { runtime } = createRuntime()
    const correlation = {
      workspaceKey: '/workspace-a',
      conversationId: 'conversation-a',
      agentRunId: 'run-a',
      agentSessionRef: null,
      profileId: 'profile-a',
      accountId: 'account-a',
      allowedOrigins: ['https://mp.csdn.net'],
      affairId: 'affair-a',
      affairAttemptId: 'attempt-a',
    }
    const first = runtime.startTask({ tabId: 'browser-a', goal: 'publish', correlation })
    runtime.pauseForTakeover(first.id, '需要用户处理')

    const resumed = runtime.startTask({
      tabId: 'browser-a',
      goal: 'continue publish',
      correlation: { ...correlation, conversationId: 'conversation-b', agentRunId: 'run-b' },
    })

    expect(runtime.getTask(first.id)?.status).toBe('cancelled')
    expect(resumed.status).toBe('running')
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

  it('keeps a dispatched unknown result running until a successful observation', () => {
    const { runtime } = createRuntime()
    const task = runtime.startTask({ tabId: 'browser', goal: 'submit form' })

    const blocked = runtime.markActionResultUnknown(task.id, 'connection lost')
    expect(blocked).toMatchObject({
      status: 'running',
      reobservationRequired: true,
      actionResultUnknown: true,
    })

    const observed = runtime.markReobserved(task.id)
    expect(observed).toMatchObject({
      status: 'running',
      reobservationRequired: false,
      actionResultUnknown: false,
    })
  })

  it('finds the exact BrowserTask for an Agent run including terminal tasks', () => {
    const { runtime } = createRuntime()
    const first = runtime.startTask({
      tabId: 'browser-a',
      goal: 'first',
      correlation: {
        workspaceKey: null,
        conversationId: 'conversation-a',
        agentRunId: 'run-old',
        agentSessionRef: null,
        profileId: null,
      },
    })
    runtime.failTask(first.id, { reason: 'automation_unavailable' })
    runtime.startTask({
      tabId: 'browser-b',
      goal: 'second',
      correlation: {
        workspaceKey: null,
        conversationId: 'conversation-a',
        agentRunId: 'run-current',
        agentSessionRef: null,
        profileId: null,
      },
    })

    expect(runtime.getTaskForAgentRun('conversation-a', 'run-old')).toMatchObject({
      id: first.id,
      status: 'failed',
    })
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

  it('does not expand a structured affair origin boundary from a generic Browser resume', () => {
    const { runtime } = createRuntime()
    const task = runtime.startTask({
      tabId: 'browser',
      goal: 'publish article',
      correlation: {
        workspaceKey: '/workspace-a',
        conversationId: 'conversation-a',
        agentRunId: 'run-a',
        agentSessionRef: null,
        profileId: 'profile-a',
        accountId: 'account-a',
        allowedOrigins: ['https://mp.csdn.net'],
        affairId: 'affair-a',
        affairAttemptId: 'attempt-a',
      },
    })
    runtime.pauseForTakeover(task.id, 'unknown page')

    const resumed = runtime.resumeTask(task.id, 'https://untrusted.example/path')

    expect(resumed.correlation?.allowedOrigins).toEqual(['https://mp.csdn.net'])
  })
})
