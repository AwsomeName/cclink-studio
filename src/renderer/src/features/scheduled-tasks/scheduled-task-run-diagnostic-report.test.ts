import { describe, expect, it, vi } from 'vitest'
import type {
  ScheduledTaskRun,
  ScheduledTaskSnapshot,
} from '@shared/scheduled-task/scheduled-task-types'
import {
  buildScheduledTaskRunDiagnosticReport,
  collectScheduledTaskRunDiagnosticReport,
  shouldOfferScheduledTaskRunLog,
} from './scheduled-task-run-diagnostic-report'

const createdAt = Date.parse('2026-08-20T00:50:00.000Z')

describe('scheduled task run diagnostic report', () => {
  it('builds a redacted failure report with persisted facts and logs from the run window', () => {
    const report = buildScheduledTaskRunDiagnosticReport({
      task: createTask(),
      run: createRun(),
      generatedAt: createdAt + 700_000,
      runtimeStatus: {
        state: 'ready',
        startedAt: createdAt - 1_000,
        timerDueAt: null,
        queuedCount: 0,
        runningRunId: null,
        enabledCount: 1,
        systemScheduler: 'none',
      },
      mainLogSnapshot: {
        capturedAt: '2026-08-20T01:02:00.000Z',
        droppedCount: 2,
        entries: [
          {
            timestamp: '2026-08-19T12:00:00.000Z',
            level: 'info',
            source: 'main',
            message: 'unrelated old entry',
          },
          {
            timestamp: '2026-08-20T00:55:00.000Z',
            level: 'error',
            source: 'main',
            message:
              '[ScheduledTaskAgentRunner] Agent timeout token=secret-value /Users/alice/project',
          },
        ],
      },
    })

    expect(report).toContain('# CCLink Studio 定时任务运行日志')
    expect(report).toContain('错误码：SCHEDULED_TASK_AGENT_UNAVAILABLE')
    expect(report).toContain('定时任务 Agent 运行超时')
    expect(report).toContain('执行耗时：600000 ms')
    expect(report).toContain('Agent timeout token=[REDACTED] ~/project')
    expect(report).not.toContain('unrelated old entry')
    expect(report).not.toContain('secret-value')
    expect(report).not.toContain('请读取所有文件')
  })

  it('keeps the report copyable when diagnostic IPC sources fail', async () => {
    vi.stubGlobal('window', {
      cclinkStudio: {
        scheduledTasks: {
          getRuntimeStatus: vi.fn().mockRejectedValue(new Error('runtime unavailable')),
        },
        diagnostics: {
          getMainLogSnapshot: vi.fn().mockRejectedValue(new Error('logs unavailable')),
        },
      },
    })

    const report = await collectScheduledTaskRunDiagnosticReport(createTask(), createRun())

    expect(report).toContain('状态采集失败：runtime unavailable')
    expect(report).toContain('日志采集失败：logs unavailable')
    expect(report).toContain('运行 ID：run-1')
  })

  it('offers the button for failure-like terminal states only', () => {
    expect(shouldOfferScheduledTaskRunLog(createRun())).toBe(true)
    expect(shouldOfferScheduledTaskRunLog({ ...createRun(), status: 'interrupted' })).toBe(true)
    expect(shouldOfferScheduledTaskRunLog({ ...createRun(), status: 'missed' })).toBe(true)
    expect(shouldOfferScheduledTaskRunLog({ ...createRun(), status: 'skipped' })).toBe(true)
    expect(
      shouldOfferScheduledTaskRunLog({ ...createRun(), status: 'completed', error: undefined }),
    ).toBe(false)
  })
})

function createRun(): ScheduledTaskRun {
  return {
    schemaVersion: 2,
    id: 'run-1',
    occurrenceKey: 'manual:run-1',
    taskId: 'task-1',
    taskRevision: 8,
    taskExecutionDigest: 'digest-8',
    workspaceId: 'workspace-1',
    workspaceRef: { kind: 'local', path: '/Users/alice/project' },
    conversationId: 'scheduled-task:run-1',
    trigger: 'scheduled',
    scheduledFor: createdAt,
    status: 'failed',
    currentStep: '运行失败',
    createdAt,
    startedAt: createdAt,
    finishedAt: createdAt + 600_000,
    error: {
      code: 'SCHEDULED_TASK_AGENT_UNAVAILABLE',
      message: '定时任务 Agent 运行超时',
      recovery: '检查 Agent 配置与网络后重试',
    },
  }
}

function createTask(): ScheduledTaskSnapshot {
  return {
    definition: {
      schemaVersion: 2,
      id: 'task-1',
      workspaceRef: { kind: 'local', path: '/Users/alice/project' },
      source: 'local',
      executionDigest: 'digest-8',
      revision: 8,
      title: '每日日志',
      instruction: '请读取所有文件，并使用 token=do-not-copy',
      schedule: { kind: 'daily', time: '08:50', timezone: 'Asia/Shanghai' },
      resources: [{ kind: 'workspace' }],
      outputPolicy: {
        directory: '.cclink-studio/scheduled-task-results',
        fileNameTemplate: 'result-{runId}.md',
        mode: 'create-only',
      },
      createdAt,
      updatedAt: createdAt,
    },
    activation: {
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      workspaceRef: { kind: 'local', path: '/Users/alice/project' },
      enabled: true,
      confirmedTaskRevision: null,
      confirmedExecutionDigest: null,
      suspensionReason: null,
      catchUpPolicy: { mode: 'latest-within-window', windowMinutes: 30 },
      lastEvaluatedAt: createdAt,
      nextRunAt: createdAt + 86_400_000,
    },
  }
}
