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

    const result = await runner.run({
      runId: 'run-1',
      conversationId: 'scheduled-task:run-1',
      definition: definition(),
      scheduledFor: Date.parse('2026-07-29T01:00:00.000Z'),
    })
    const canonicalRoot = await realpath(root)

    expect(sendScheduledTaskMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: definition().id,
        taskRevision: 3,
        workspacePath: canonicalRoot,
        readRoots: [canonicalRoot],
      }),
    )
    expect(result.artifact).toMatchObject({
      relativePath: 'docs/generated/report-2026-07-29.md',
      bytes: Buffer.byteLength('# Generated\n\nSafe output.\n'),
    })
    expect(await readFile(join(root, result.artifact.relativePath), 'utf-8')).toBe(
      '# Generated\n\nSafe output.\n',
    )
  })

  it('refuses create-only collisions before starting Agent', async () => {
    await mkdir(join(root, 'docs/generated'), { recursive: true })
    await writeFile(join(root, 'docs/generated/report-2026-07-29.md'), '# Existing\n')
    const sendScheduledTaskMessage = vi.fn()
    const runner = new ScheduledTaskAgentRunner({
      onRuntimeEvent: vi.fn(),
      sendScheduledTaskMessage,
      abort: vi.fn(),
    } as never)

    await expect(
      runner.run({
        runId: 'run-2',
        conversationId: 'scheduled-task:run-2',
        definition: definition(),
        scheduledFor: Date.parse('2026-07-29T01:00:00.000Z'),
      }),
    ).rejects.toThrow('create-only')
    expect(sendScheduledTaskMessage).not.toHaveBeenCalled()
  })
})

function definition(): ScheduledTaskDefinition {
  return {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    workspaceRef: { kind: 'local', path: root },
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
      fileNameTemplate: 'report-{date}.md',
      mode: 'create-only',
    },
    createdAt: 1,
    updatedAt: 2,
  }
}
