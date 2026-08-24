import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRuntimeStateStore } from './agent-runtime-state-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('AgentRuntimeStateStore', () => {
  it('atomically admits only one non-terminal run per conversation, including cancelling runs', async () => {
    const store = new AgentRuntimeStateStore()
    await store.beginRun({ conversationId: 'conversation-1', runId: 'run-1', workspaceKey: null })

    await expect(
      store.beginRun({ conversationId: 'conversation-1', runId: 'run-2', workspaceKey: null }),
    ).rejects.toThrow('run-1')

    await store.markCancelling('conversation-1', 'run-1')
    await expect(
      store.beginRun({ conversationId: 'conversation-1', runId: 'run-3', workspaceKey: null }),
    ).rejects.toThrow('run-1')

    await store.finishRun('conversation-1', 'run-1', 'cancelled')
    await expect(
      store.beginRun({ conversationId: 'conversation-1', runId: 'run-4', workspaceKey: null }),
    ).resolves.toMatchObject({ status: 'running', runId: 'run-4' })
  })

  it('allows only the first terminal transition to publish a record', async () => {
    const store = new AgentRuntimeStateStore()
    await store.beginRun({ conversationId: 'conversation-1', runId: 'run-1', workspaceKey: null })

    await expect(store.finishRun('conversation-1', 'run-1', 'cancelled')).resolves.toMatchObject({
      status: 'cancelled',
    })
    await expect(store.finishRun('conversation-1', 'run-1', 'succeeded')).resolves.toBeNull()
    expect(store.getRun('conversation-1', 'run-1')).toMatchObject({ status: 'cancelled' })
  })

  it('persists terminal state and repairs an owned run as failed after a main-process restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studio-agent-runtime-state-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'state.json')
    const first = new AgentRuntimeStateStore(filePath)
    await first.load()
    await first.beginRun({
      conversationId: 'conversation-1',
      runId: 'run-orphaned',
      workspaceKey: 'local:/workspace',
    })
    await first.flush()

    const restarted = new AgentRuntimeStateStore(filePath)
    await restarted.load()

    expect(restarted.getRun('conversation-1', 'run-orphaned')).toMatchObject({
      status: 'failed',
      errorCode: 'runtime_owner_lost',
      completedAt: expect.any(Number),
    })
    expect(JSON.parse(await readFile(filePath, 'utf8')).runs[0]).toMatchObject({
      status: 'failed',
      errorCode: 'runtime_owner_lost',
    })
  })
})
