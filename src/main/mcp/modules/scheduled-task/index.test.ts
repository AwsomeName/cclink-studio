import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScheduledTaskToolModule } from './index'

let root = ''
let workspace = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scheduled-task-tool-'))
  workspace = join(root, 'workspace')
  await mkdir(workspace)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ScheduledTaskToolModule', () => {
  it('exposes only the three read-only ST-A1 tools without workspace path parameters', () => {
    const module = new ScheduledTaskToolModule({} as never)
    expect(module.tools.map((tool) => tool.name)).toEqual([
      'scheduled_task_list',
      'scheduled_task_get_runtime_status',
      'scheduled_task_list_runs',
    ])
    for (const tool of module.tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
      expect(tool.inputSchema.properties).not.toHaveProperty('workspacePath')
    }
  })

  it.each([
    [undefined, 'WORKSPACE_CONTEXT_MISSING'],
    [{ trustedWorkspace: { kind: 'global', workspaceKey: null } }, 'LOCAL_WORKSPACE_REQUIRED'],
    [
      { trustedWorkspace: { kind: 'remote', workspaceKey: 'cclink://endpoint/workspace' } },
      'LOCAL_WORKSPACE_REQUIRED',
    ],
    [
      {
        trustedWorkspace: {
          kind: 'local',
          rootPath: '/workspace/a',
          workspaceKey: '/workspace/b',
        },
      },
      'WORKSPACE_UNAVAILABLE',
    ],
  ])('rejects untrusted workspace context', async (context, code) => {
    const list = vi.fn()
    const module = new ScheduledTaskToolModule({ list } as never)
    const result = await module.execute('scheduled_task_list', {}, context as never)
    expect(result).toMatchObject({ success: false, error: { code } })
    expect(list).not.toHaveBeenCalled()
  })

  it('rejects a real local workspace mismatch', async () => {
    const other = join(root, 'other')
    await mkdir(other)
    const list = vi.fn()
    const module = new ScheduledTaskToolModule({ list } as never)
    const result = await module.execute(
      'scheduled_task_list',
      {},
      {
        trustedWorkspace: {
          kind: 'local',
          rootPath: workspace,
          workspaceKey: other,
        },
      },
    )
    expect(result).toMatchObject({
      success: false,
      error: { code: 'WORKSPACE_CONTEXT_MISMATCH' },
    })
    expect(list).not.toHaveBeenCalled()
  })

  it('requests a workspace-scoped runtime projection from the service owner', async () => {
    const getWorkspaceRuntimeStatus = vi.fn(async () => ({
      success: true,
      runtime: {
        scope: 'workspace' as const,
        state: 'ready' as const,
        startedAt: 1,
        timerDueAt: 2,
        queuedCount: 0,
        runningRunId: null,
        enabledCount: 1,
        systemScheduler: 'none' as const,
      },
    }))
    const module = new ScheduledTaskToolModule({ getWorkspaceRuntimeStatus } as never)

    await expect(
      module.execute('scheduled_task_get_runtime_status', {}, localContext()),
    ).resolves.toMatchObject({
      success: true,
      runtime: { scope: 'workspace', enabledCount: 1 },
    })
    expect(getWorkspaceRuntimeStatus).toHaveBeenCalledWith(workspace)
  })

  it('bounds run history and strips artifact path and hash', async () => {
    const taskId = '00000000-0000-4000-8000-000000000001'
    const listRuns = vi.fn(async () => ({
      success: true,
      runs: Array.from({ length: 3 }, (_, index) => ({
        id: `run-${index}`,
        occurrenceKey: `manual:${index}`,
        taskId,
        taskRevision: 1,
        workspaceId: 'workspace-1',
        workspaceRef: { kind: 'local', path: workspace },
        conversationId: `scheduled-task:run-${index}`,
        trigger: 'manual',
        scheduledFor: null,
        status: 'completed',
        currentStep: '任务已完成',
        createdAt: 3 - index,
        startedAt: 3 - index,
        finishedAt: 3 - index,
        artifact: {
          relativePath: `docs/private-${index}.md`,
          bytes: 10,
          sha256: 'a'.repeat(64),
        },
      })),
    }))
    const module = new ScheduledTaskToolModule({ listRuns } as never)
    const result = await module.execute(
      'scheduled_task_list_runs',
      { taskId, limit: 2 },
      localContext(),
    )

    expect(result).toMatchObject({
      success: true,
      taskId,
      limit: 2,
      hasMore: true,
      runs: [
        { runId: 'run-0', hasArtifact: true },
        { runId: 'run-1', hasArtifact: true },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('private-')
    expect(JSON.stringify(result)).not.toContain('a'.repeat(64))
  })
})

function localContext() {
  return {
    trustedWorkspace: {
      kind: 'local' as const,
      rootPath: workspace,
      workspaceKey: workspace,
    },
  }
}
