import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledTaskRun } from '@shared/scheduled-task/scheduled-task-types'
import { ScheduledTaskRunActions } from './ScheduledTaskTab'

describe('ScheduledTaskTab', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React)
  })

  it('renders a copy-log action on a failed run card', () => {
    const run = createRun()

    const markup = renderToStaticMarkup(
      <ScheduledTaskRunActions run={run} onCopyLog={vi.fn()} onOpenArtifact={vi.fn()} />,
    )

    expect(markup).toContain('>复制日志</button>')
  })

  it('does not add a failure log action to a completed run', () => {
    const markup = renderToStaticMarkup(
      <ScheduledTaskRunActions
        run={{ ...createRun(), status: 'completed', error: undefined }}
        onCopyLog={vi.fn()}
        onOpenArtifact={vi.fn()}
      />,
    )

    expect(markup).not.toContain('>复制日志</button>')
  })
})

function createRun(): ScheduledTaskRun {
  const createdAt = Date.parse('2026-08-20T00:50:00.000Z')
  return {
    schemaVersion: 2,
    id: 'run-1',
    occurrenceKey: 'scheduled:run-1',
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
