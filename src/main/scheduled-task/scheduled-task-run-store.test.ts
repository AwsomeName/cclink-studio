import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ScheduledTaskRunStore } from './scheduled-task-run-store'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('ScheduledTaskRunStore v1 migration', () => {
  it('adds workspaceId to occurrence keys before scheduling and keeps different copies distinct', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'scheduled-task-ledger-'))
    tempDirectories.push(directory)
    const filePath = join(directory, 'runs.json')
    await mkdir(directory, { recursive: true })
    const taskId = '12345678-1234-1234-1234-123456789abc'
    const scheduledFor = 1_700_000_000_000
    const runs = ['workspace-a', 'workspace-b'].map((workspaceId, index) => ({
      schemaVersion: 1,
      id: `12345678-1234-1234-1234-123456789ab${index}`,
      occurrenceKey: `scheduled:${taskId}:${scheduledFor}`,
      taskId,
      taskRevision: 1,
      workspaceId,
      workspaceRef: { kind: 'local', path: `/workspace-${index}` },
      conversationId: '',
      trigger: 'scheduled',
      scheduledFor,
      status: 'completed',
      currentStep: 'done',
      createdAt: scheduledFor + index,
      startedAt: scheduledFor,
      finishedAt: scheduledFor,
    }))
    await writeFile(filePath, `${JSON.stringify({ schemaVersion: 1, runs }, null, 2)}\n`, 'utf-8')

    const store = new ScheduledTaskRunStore(filePath)
    await store.load(scheduledFor + 1)

    expect(
      store
        .list()
        .map((run) => run.occurrenceKey)
        .sort(),
    ).toEqual([
      `scheduled:workspace-a:${taskId}:${scheduledFor}`,
      `scheduled:workspace-b:${taskId}:${scheduledFor}`,
    ])
    expect(store.hasOccurrenceConflict('workspace-a', taskId)).toBe(false)
    expect(JSON.parse(await readFile(filePath, 'utf-8')).schemaVersion).toBe(2)
    await expect(readFile(`${filePath}.bak`, 'utf-8')).resolves.toContain('"schemaVersion": 1')
  })
})
