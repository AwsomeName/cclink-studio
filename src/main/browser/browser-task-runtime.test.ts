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
})
