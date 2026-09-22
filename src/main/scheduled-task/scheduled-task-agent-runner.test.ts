import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeEvent } from '../agent-core/runtime/agent-runtime'
import type { ScheduledTaskDefinition } from '../../shared/scheduled-task/scheduled-task-types'
import { ScheduledTaskAgentRunner } from './scheduled-task-agent-runner'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scheduled-agent-runner-'))
  await writeFile(join(root, 'README.md'), '# Workspace\n', 'utf-8')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ScheduledTaskAgentRunner', () => {
  it.each(['error', 'complete'] as const)(
    'saves a configured template on provider refusal (%s) without copying the refused content',
    async (type) => {
      const listeners = new Set<(event: AgentRuntimeEvent) => void>()
      const runner = new ScheduledTaskAgentRunner({
        onRuntimeEvent: (listener: (event: AgentRuntimeEvent) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        sendScheduledTaskMessage: async (input: { runId: string; conversationId: string }) => {
          for (const listener of listeners) {
            listener({
              ...input,
              type,
              data:
                type === 'error'
                  ? { message: 'API Error: [1301] provider refusal with private details' }
                  : {
                      is_error: true,
                      result: 'API Error: [1301] provider refusal with private details',
                    },
            })
          }
        },
        abort: vi.fn(),
      } as never)
      const task = definition()
      task.outputPolicy.failureTemplate = '今日体重：\n\n## 昨日总结\n\n## 今日待做\n'
      const result = await runner.run({
        runId: 'fallback',
        conversationId: 'scheduled-task:fallback',
        definition: task,
        scheduledFor: Date.parse('2026-07-29T01:00:00Z'),
      })
      const persisted = await readFile(join(root, result.artifact.relativePath), 'utf-8')
      expect(persisted).toContain(task.outputPolicy.failureTemplate)
      expect(persisted).toContain('本次 AI 补充失败，仅保存预设模板')
      expect(persisted).not.toContain('private details')
      expect(result.generationError).toContain('[1301]')
      expect(result.artifact.bytes).toBe(Buffer.byteLength(persisted))
      expect(listeners.size).toBe(0)
    },
  )

  it.each([false, true])(
    'does not write a fallback when cancelled (abort rejects: %s)',
    async (abortRejects) => {
      const listeners = new Set<(event: AgentRuntimeEvent) => void>()
      const send = vi.fn(async () => {})
      const runner = new ScheduledTaskAgentRunner({
        onRuntimeEvent: (listener: (event: AgentRuntimeEvent) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        sendScheduledTaskMessage: send,
        abort: async () => {
          if (abortRejects) throw new Error('abort failed')
        },
      } as never)
      const task = definition()
      task.outputPolicy.fileNameTemplate = 'cancelled.md'
      task.outputPolicy.failureTemplate = '# Template'
      const pending = runner.run({
        runId: 'cancel',
        conversationId: 'cancel',
        definition: task,
        scheduledFor: null,
      })
      const rejected = expect(pending).rejects.toThrow('已取消')
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
      await runner.cancel('cancel').catch(() => {})
      await rejected
      await expect(readFile(join(root, 'docs/generated/cancelled.md'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      expect(listeners.size).toBe(0)
    },
  )

  it('uses the scheduled origin and atomically verifies a Markdown artifact', async () => {
    const listeners = new Set<(event: AgentRuntimeEvent) => void>()
    const sendScheduledTaskMessage = vi.fn(
      async (input: { runId: string; conversationId: string }) => {
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener({
              conversationId: input.conversationId,
              runId: input.runId,
              type: 'complete',
              data: { result: '# Generated\n\nSafe output.' },
            })
          }
        })
      },
    )
    const runner = new ScheduledTaskAgentRunner({
      onRuntimeEvent: (listener: (event: AgentRuntimeEvent) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      sendScheduledTaskMessage,
      abort: vi.fn(async () => {}),
    } as never)

    const taskDefinition = definition()
    taskDefinition.schedule.timezone = 'America/Los_Angeles'
    taskDefinition.outputPolicy.fileNameTemplate =
      'report-{taskId}-{runId}-{date}-{monthDay}-{weekday}.md'
    taskDefinition.outputPolicy.failureTemplate = '# Fallback must not replace success'
    const result = await runner.run({
      runId: 'run-1',
      conversationId: 'scheduled-task:run-1',
      definition: taskDefinition,
      scheduledFor: Date.parse('2026-07-29T01:00:00.000Z'),
    })
    const canonicalRoot = await realpath(root)
    expect(result.generationError).toBeUndefined()

    expect(sendScheduledTaskMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: definition().id,
        taskRevision: 3,
        workspacePath: canonicalRoot,
        readRoots: [canonicalRoot],
      }),
    )
    expect(result.artifact).toMatchObject({
      relativePath:
        'docs/generated/report-00000000-0000-4000-8000-000000000001-run-1-2026-07-28-0728-周二.md',
      bytes: Buffer.byteLength('# Generated\n\nSafe output.\n'),
    })
    expect(await readFile(join(root, result.artifact.relativePath), 'utf-8')).toBe(
      '# Generated\n\nSafe output.\n',
    )
  })

  it('refuses create-only collisions before starting Agent', async () => {
    await mkdir(join(root, 'docs/generated'), { recursive: true })
    await writeFile(
      join(root, 'docs/generated/report-00000000-0000-4000-8000-000000000001-run-2-2026-07-29.md'),
      '# Existing\n',
    )
    const sendScheduledTaskMessage = vi.fn()
    const runner = new ScheduledTaskAgentRunner({
      onRuntimeEvent: vi.fn(),
      sendScheduledTaskMessage,
      abort: vi.fn(),
    } as never)
    const task = definition()
    task.outputPolicy.failureTemplate = '# Never replace an existing daily log'

    await expect(
      runner.run({
        runId: 'run-2',
        conversationId: 'scheduled-task:run-2',
        definition: task,
        scheduledFor: Date.parse('2026-07-29T01:00:00.000Z'),
      }),
    ).rejects.toThrow('create-only')
    expect(sendScheduledTaskMessage).not.toHaveBeenCalled()
  })
})

function definition(): ScheduledTaskDefinition {
  return {
    schemaVersion: 2,
    id: '00000000-0000-4000-8000-000000000001',
    workspaceRef: { kind: 'local', path: root },
    source: 'local',
    executionDigest: 'digest-3',
    revision: 3,
    title: 'Generate report',
    instruction: 'Read README and generate a concise report.',
    schedule: {
      kind: 'daily',
      time: '09:00',
      timezone: 'Asia/Shanghai',
    },
    resources: [{ kind: 'workspace' }],
    outputPolicy: {
      directory: 'docs/generated',
      fileNameTemplate: 'report-{taskId}-{runId}-{date}.md',
      mode: 'create-only',
    },
    createdAt: 1,
    updatedAt: 2,
  }
}
