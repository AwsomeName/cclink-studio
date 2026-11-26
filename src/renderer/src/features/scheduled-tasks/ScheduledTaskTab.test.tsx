import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ScheduledTaskRun,
  ScheduledTaskSnapshot,
} from '@shared/scheduled-task/scheduled-task-types'
import {
  confirmScheduledTaskAction,
  draftSaveKeepsEnabled,
  ScheduledTaskRunActions,
  SharedTaskActivationNote,
} from './ScheduledTaskTab'
import { getRendererDiagnosticLogSnapshot } from '../diagnostics/renderer-diagnostic-log'

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

  it('flags a confirm that returned cancel before anyone could read it', () => {
    const times = [0, 12]
    const confirmed = confirmScheduledTaskAction(
      'enable-on-device',
      '12345678-aaaa',
      '在此设备启用？',
      () => false,
      () => times.shift() ?? 0,
    )
    expect(confirmed).toBe(false)
    const entry = findLastLog('[ScheduledTask]')
    expect(entry).toMatchObject({ level: 'warn' })
    expect(entry?.message).toContain('疑似未显示')
    expect(entry?.message).toContain('12345678')
    expect(entry?.message).not.toContain('在此设备启用？')
  })

  it('keeps an enabled shared task enabled on plain save', () => {
    expect(draftSaveKeepsEnabled(createSnapshot('shared', { enabled: true }))).toBe(true)
    expect(draftSaveKeepsEnabled(createSnapshot('shared', { enabled: false }))).toBe(false)
    expect(draftSaveKeepsEnabled(createSnapshot('local', { enabled: true }))).toBe(true)
    expect(draftSaveKeepsEnabled(undefined)).toBe(false)
  })

  it('explains why a shared task is not enabled on this device', () => {
    const render = (task: ScheduledTaskSnapshot): string =>
      renderToStaticMarkup(<SharedTaskActivationNote task={task} />)

    const fresh = render(createSnapshot('shared', { enabled: false }))
    expect(fresh).toContain('本机未启用')
    expect(fresh).not.toContain('随项目同步来的')

    const changed = render(
      createSnapshot('shared', { enabled: false, suspensionReason: 'definition-changed' }),
    )
    expect(changed).toContain('本机已暂停')
    expect(changed).toContain('在别处被修改')

    expect(render(createSnapshot('shared', { enabled: true }))).toBe('')
    expect(render(createSnapshot('local', { enabled: false }))).toBe('')
  })
})

function createSnapshot(
  source: 'local' | 'shared',
  activation: Partial<ScheduledTaskSnapshot['activation']>,
): ScheduledTaskSnapshot {
  return {
    definition: { source } as ScheduledTaskSnapshot['definition'],
    activation: {
      enabled: false,
      suspensionReason: null,
      ...activation,
    } as ScheduledTaskSnapshot['activation'],
  } as ScheduledTaskSnapshot
}

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

function findLastLog(prefix: string) {
  return getRendererDiagnosticLogSnapshot()
    .entries.filter((entry) => entry.message.includes(prefix))
    .at(-1)
}
