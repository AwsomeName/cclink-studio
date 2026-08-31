import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
}))

import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import { ScheduledTaskService } from './scheduled-task-service'
import { ScheduledTaskToolModule } from '../mcp/modules/scheduled-task'
import type {
  ScheduledTaskAgentRunInput,
  ScheduledTaskRunExecutor,
} from './scheduled-task-agent-runner'

let tempDir = ''
let workspacePath = ''
let userDataPath = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-scheduled-task-'))
  workspacePath = join(tempDir, 'workspace')
  userDataPath = join(tempDir, 'user-data')
  await mkdir(join(workspacePath, '.git/info'), { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('ScheduledTaskService', () => {
  it('persists workspace definitions separately from local activation state', async () => {
    const service = createService()
    await service.load()
    const saved = await service.save(createInput(true))

    expect(saved).toMatchObject({
      success: true,
      task: {
        definition: { revision: 1, title: '每周工作总结' },
        activation: { workspaceId: 'project-1', enabled: true },
      },
    })
    const taskId = saved.task!.definition.id
    const definitionText = await readFile(
      join(workspacePath, '.cclink-studio/scheduled-tasks', `${taskId}.json`),
      'utf-8',
    )
    const activationText = await readFile(
      join(userDataPath, 'scheduled-tasks/activations.json'),
      'utf-8',
    )
    expect(definitionText).toContain('"revision": 1')
    expect(definitionText).not.toContain('"enabled"')
    expect(activationText).toContain('"enabled": true')
    const localExclude = await readFile(join(workspacePath, '.git/info/exclude'), 'utf-8')
    expect(localExclude).toContain('/.cclink-studio/scheduled-tasks/')
    expect(localExclude).toContain('/.cclink-studio/scheduled-task-results/')

    const listed = await service.list(workspacePath)
    expect(listed.tasks).toHaveLength(1)
    expect(listed.tasks[0]).toMatchObject({
      definition: { id: taskId },
      activation: { enabled: true },
    })
  })

  it('rejects a stale revision without overwriting the current definition', async () => {
    const service = createService()
    await service.load()
    const first = await service.save(createInput(false))
    const taskId = first.task!.definition.id
    const second = await service.save({
      ...createInput(false),
      taskId,
      expectedRevision: 1,
      title: '第二版名称',
    })
    expect(second.task?.definition.revision).toBe(2)

    const stale = await service.save({
      ...createInput(false),
      taskId,
      expectedRevision: 1,
      title: '不应覆盖',
    })
    expect(stale).toMatchObject({
      success: false,
      error: { code: 'SCHEDULED_TASK_REVISION_CONFLICT' },
    })
    expect((await service.get(workspacePath, taskId)).task?.definition.title).toBe('第二版名称')
  })

  it('rejects a stale content digest even when an external edit keeps the same revision', async () => {
    const service = createService()
    await service.load()
    const first = await service.save(createInput(false))
    const taskId = first.task!.definition.id
    const definitionPath = join(workspacePath, '.cclink-studio/scheduled-tasks', `${taskId}.json`)
    const external = JSON.parse(await readFile(definitionPath, 'utf-8'))
    external.instruction = '外部修改但错误地保留 revision。'
    await writeFile(definitionPath, `${JSON.stringify(external, null, 2)}\n`, 'utf-8')

    const stale = await service.save({
      ...createInput(false),
      taskId,
      expectedRevision: 1,
      expectedExecutionDigest: first.task!.definition.executionDigest,
    })

    expect(stale).toMatchObject({
      success: false,
      error: { code: 'SCHEDULED_TASK_REVISION_CONFLICT' },
    })
    expect((await service.get(workspacePath, taskId)).task?.definition.instruction).toBe(
      '外部修改但错误地保留 revision。',
    )
  })

  it('blocks writes when local activation state is damaged', async () => {
    await mkdir(join(userDataPath, 'scheduled-tasks'), { recursive: true })
    const activationPath = join(userDataPath, 'scheduled-tasks/activations.json')
    await writeFile(activationPath, '{not-json', 'utf-8')
    const service = createService()
    await service.load()

    const result = await service.save(createInput(true))

    expect(result).toMatchObject({
      success: false,
      error: { code: 'SCHEDULED_TASK_STORE_INVALID' },
    })
    await service.startRuntime({} as never)
    await expect(service.getWorkspaceRuntimeStatus(workspacePath)).resolves.toMatchObject({
      success: true,
      runtime: {
        state: 'degraded',
        lastError: { code: 'SCHEDULED_TASK_STORE_INVALID' },
      },
    })
    expect(await readFile(activationPath, 'utf-8')).toBe('{not-json')
  })

  it('runs a saved revision once and records a verified Markdown artifact', async () => {
    const run = vi.fn(async () => ({
      artifact: {
        relativePath: 'docs/周报/weekly-2026-07-29.md',
        bytes: 12,
        sha256: 'a'.repeat(64),
      },
    }))
    const service = createService({ run, cancel: vi.fn(async () => {}) })
    await service.load()
    const saved = await service.save(createInput(false))
    await service.startRuntime({} as never)

    const first = await service.runNow({
      workspacePath,
      taskId: saved.task!.definition.id,
    })
    const duplicate = await service.runNow({
      workspacePath,
      taskId: saved.task!.definition.id,
    })

    expect(duplicate.run?.id).toBe(first.run?.id)
    await vi.waitFor(async () => {
      const history = await service.listRuns(workspacePath, saved.task!.definition.id)
      expect(history.runs[0]).toMatchObject({
        status: 'completed',
        taskRevision: 1,
        artifact: { relativePath: 'docs/周报/weekly-2026-07-29.md' },
      })
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('serves the same task and run facts through the read-only Agent module', async () => {
    const executor: ScheduledTaskRunExecutor = {
      run: vi.fn(async () => ({
        artifact: {
          relativePath: 'docs/周报/agent-query.md',
          bytes: 12,
          sha256: 'd'.repeat(64),
        },
      })),
      cancel: vi.fn(async () => {}),
    }
    const service = createService(executor)
    await service.load()
    const saved = await service.save(createInput(true))
    await service.startRuntime({} as never)
    await service.runNow({ workspacePath, taskId: saved.task!.definition.id })
    await vi.waitFor(async () => {
      const history = await service.listRuns(workspacePath, saved.task!.definition.id)
      expect(history.runs[0]?.status).toBe('completed')
    })

    const sidebarSnapshot = await service.list(workspacePath)
    const sidebarRuns = await service.listRuns(workspacePath, saved.task!.definition.id)
    const sidebarRuntime = (await service.getWorkspaceRuntimeStatus(workspacePath)).runtime!
    const module = new ScheduledTaskToolModule(service)
    const context = {
      trustedWorkspace: {
        kind: 'local' as const,
        rootPath: workspacePath,
        workspaceKey: workspacePath,
      },
    }
    const toolList = (await module.execute('scheduled_task_list', {}, context)) as {
      tasks: Array<{
        taskId: string
        title: string
        revision: number
        enabled: boolean
        nextRunAt: number | null
        latestRun: { runId: string; status: string } | null
      }>
    }
    const toolRuns = (await module.execute(
      'scheduled_task_list_runs',
      { taskId: saved.task!.definition.id, limit: 20 },
      context,
    )) as {
      runs: Array<{ runId: string; taskRevision: number; status: string }>
    }
    const toolRuntime = (await module.execute(
      'scheduled_task_get_runtime_status',
      {},
      context,
    )) as { runtime: typeof sidebarRuntime }

    expect(toolList.tasks[0]).toMatchObject({
      taskId: sidebarSnapshot.tasks[0].definition.id,
      title: sidebarSnapshot.tasks[0].definition.title,
      revision: sidebarSnapshot.tasks[0].definition.revision,
      enabled: sidebarSnapshot.tasks[0].activation.enabled,
      nextRunAt: sidebarSnapshot.tasks[0].activation.nextRunAt,
      latestRun: {
        runId: sidebarSnapshot.tasks[0].latestRun?.id,
        status: sidebarSnapshot.tasks[0].latestRun?.status,
      },
    })
    expect(toolRuns.runs[0]).toMatchObject({
      runId: sidebarRuns.runs[0].id,
      taskRevision: sidebarRuns.runs[0].taskRevision,
      status: sidebarRuns.runs[0].status,
    })
    expect(toolRuntime.runtime).toEqual(sidebarRuntime)
    const serialized = JSON.stringify({ toolList, toolRuns, toolRuntime })
    expect(serialized).not.toContain('读取工作空间资料并生成 Markdown 周报')
    expect(serialized).not.toContain('agent-query.md')
    expect(serialized).not.toContain('d'.repeat(64))
    await service.stopRuntime()
  })

  it('projects Agent runtime counts to the bound workspace without a second state owner', async () => {
    const otherWorkspacePath = join(tempDir, 'other-workspace')
    await mkdir(join(otherWorkspacePath, '.git/info'), { recursive: true })
    const workspaceProjectIds = new Map([
      [workspacePath, 'project-1'],
      [otherWorkspacePath, 'project-2'],
    ])
    const service = createService(
      undefined,
      () => Date.parse('2026-07-29T00:00:00.000Z'),
      workspaceProjectIds,
    )
    await service.load()
    await service.save(createInput(true))
    await service.save({
      ...createInput(true),
      workspacePath: otherWorkspacePath,
      title: '其他项目任务',
    })
    await service.startRuntime({} as never)

    expect(service.getRuntimeStatus().enabledCount).toBe(2)
    await expect(service.getWorkspaceRuntimeStatus(workspacePath)).resolves.toMatchObject({
      success: true,
      runtime: { scope: 'workspace', enabledCount: 1 },
    })
    await expect(service.getWorkspaceRuntimeStatus(otherWorkspacePath)).resolves.toMatchObject({
      success: true,
      runtime: { scope: 'workspace', enabledCount: 1 },
    })
    await service.stopRuntime()
  })

  it('does not project another workspace activation error into the bound workspace', async () => {
    const otherWorkspacePath = join(tempDir, 'other-workspace')
    await mkdir(join(otherWorkspacePath, '.git/info'), { recursive: true })
    const workspaceProjectIds = new Map([
      [workspacePath, 'project-1'],
      [otherWorkspacePath, 'project-2'],
    ])
    const now = Date.parse('2026-07-29T00:00:00.000Z')
    const writer = createService(undefined, () => now, workspaceProjectIds)
    await writer.load()
    await writer.save(createInput(true))
    const other = await writer.save({
      ...createInput(true),
      workspacePath: otherWorkspacePath,
      title: '损坏的其他项目任务',
    })
    await writer.flush()

    const activationPath = join(userDataPath, 'scheduled-tasks/activations.json')
    const activationFile = JSON.parse(await readFile(activationPath, 'utf-8')) as {
      activations: Record<string, { taskId: string; nextRunAt: number | null }>
    }
    const otherActivation = Object.values(activationFile.activations).find(
      (activation) => activation.taskId === other.task!.definition.id,
    )
    expect(otherActivation).toBeDefined()
    otherActivation!.nextRunAt = now - 1
    await writeFile(activationPath, JSON.stringify(activationFile), 'utf-8')
    await rm(
      join(
        otherWorkspacePath,
        '.cclink-studio/scheduled-tasks',
        `${other.task!.definition.id}.json`,
      ),
    )

    const service = createService(undefined, () => now, workspaceProjectIds)
    await service.load()
    await service.startRuntime({} as never)
    await service.stopRuntime()

    const primaryRuntime = await service.getWorkspaceRuntimeStatus(workspacePath)
    expect(primaryRuntime.success).toBe(true)
    expect(primaryRuntime.runtime).not.toHaveProperty('lastError')
    await expect(service.getWorkspaceRuntimeStatus(otherWorkspacePath)).resolves.toMatchObject({
      success: true,
      runtime: { lastError: { code: 'SCHEDULED_TASK_NOT_FOUND' } },
    })
  })

  it('uses one App timer to claim a due occurrence without opening the task tab', async () => {
    vi.useFakeTimers()
    let now = Date.parse('2026-07-29T00:00:00.000Z')
    vi.setSystemTime(now)
    const run = vi.fn(async () => ({
      artifact: {
        relativePath: 'docs/周报/once.md',
        bytes: 8,
        sha256: 'b'.repeat(64),
      },
    }))
    const service = createService({ run, cancel: vi.fn(async () => {}) }, () => now)
    await service.load()
    const saved = await service.save({
      ...createInput(true),
      schedule: { kind: 'once', runAt: now + 1_000, timezone: 'UTC' },
      outputPolicy: {
        directory: 'docs/周报',
        fileNameTemplate: 'once.md',
        mode: 'create-only',
      },
    })
    await service.startRuntime({} as never)

    expect(service.getRuntimeStatus()).toMatchObject({
      state: 'ready',
      timerDueAt: now + 1_000,
      systemScheduler: 'none',
    })
    now += 1_000
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    const history = await service.listRuns(workspacePath, saved.task!.definition.id)
    expect(history.runs[0]).toMatchObject({
      trigger: 'scheduled',
      scheduledFor: now,
      status: 'completed',
    })
    await service.stopRuntime()
    vi.useRealTimers()
  })

  it('cancels the active Agent run and persists interrupted on App shutdown', async () => {
    let rejectRun: ((error: Error) => void) | null = null
    const executor: ScheduledTaskRunExecutor = {
      run: vi.fn(
        (_input: ScheduledTaskAgentRunInput) =>
          new Promise<never>((_resolve, reject) => {
            rejectRun = reject
          }),
      ),
      cancel: vi.fn(async () => {
        rejectRun?.(new Error('cancelled'))
      }),
    }
    const service = createService(executor)
    await service.load()
    const saved = await service.save(createInput(false))
    await service.startRuntime({} as never)
    const started = await service.runNow({
      workspacePath,
      taskId: saved.task!.definition.id,
    })
    await vi.waitFor(() => expect(service.getRuntimeStatus().runningRunId).toBe(started.run?.id))

    await service.stopRuntime()

    const history = await service.listRuns(workspacePath, saved.task!.definition.id)
    expect(history.runs[0]).toMatchObject({
      status: 'interrupted',
      error: { code: 'SCHEDULED_TASK_STOPPING' },
    })
    expect(executor.cancel).toHaveBeenCalledWith(started.run?.id)
    expect(service.getRuntimeStatus()).toMatchObject({
      state: 'stopped',
      timerDueAt: null,
      runningRunId: null,
    })
  })

  it('catches up only the latest recurring occurrence inside the 30 minute window', async () => {
    const initialNow = Date.parse('2026-07-29T00:00:00.000Z')
    const first = createService(undefined, () => initialNow)
    await first.load()
    const saved = await first.save({
      ...createInput(true),
      schedule: { kind: 'daily', time: '00:01', timezone: 'UTC' },
      outputPolicy: {
        directory: 'docs/周报',
        fileNameTemplate: 'catch-up.md',
        mode: 'create-only',
      },
    })
    await first.flush()

    const run = vi.fn(async () => ({
      artifact: {
        relativePath: 'docs/周报/catch-up.md',
        bytes: 8,
        sha256: 'c'.repeat(64),
      },
    }))
    const restarted = createService(
      { run, cancel: vi.fn(async () => {}) },
      () => initialNow + 10 * 60_000,
    )
    await restarted.load()
    await restarted.startRuntime({} as never)

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    const history = await restarted.listRuns(workspacePath, saved.task!.definition.id)
    expect(history.runs).toHaveLength(1)
    expect(history.runs[0]).toMatchObject({
      trigger: 'catch-up',
      scheduledFor: initialNow + 60_000,
      status: 'completed',
    })
    await restarted.stopRuntime()
  })

  it('shares only a portable definition and requires device B to confirm each revision', async () => {
    const workspaceB = join(tempDir, 'workspace-b')
    const userDataB = join(tempDir, 'user-data-b')
    await mkdir(join(workspaceB, '.git/info'), { recursive: true })
    const serviceA = createService()
    await serviceA.load()
    const local = await serviceA.save(createInput(true))
    const first = await serviceA.save({
      ...createInput(true),
      taskId: local.task!.definition.id,
      expectedRevision: 1,
      definitionSource: 'shared',
    })
    const taskId = first.task!.definition.id
    const sharedRelativePath = join('.cclink-studio', 'shared', 'scheduled-tasks', `${taskId}.json`)
    const sharedA = join(workspacePath, sharedRelativePath)
    const sharedB = join(workspaceB, sharedRelativePath)
    await mkdir(join(workspaceB, '.cclink-studio/shared/scheduled-tasks'), { recursive: true })
    await copyFile(sharedA, sharedB)
    expect(await readFile(sharedA, 'utf-8')).not.toContain('workspaceRef')
    expect(await readFile(sharedA, 'utf-8')).not.toContain(workspacePath)

    const workspaceStateB = {
      resolveLocalWorkspace: vi.fn(async (path: string) => ({
        valid: path === workspaceB,
        workspacePath: path === workspaceB ? workspaceB : null,
      })),
      getLocalProjectId: vi.fn(async (path: string) => (path === workspaceB ? 'project-b' : null)),
    } as unknown as WorkspaceStateService
    const serviceB = new ScheduledTaskService(workspaceStateB, {
      userDataPath: userDataB,
      homePath: tempDir,
      runExecutor: { run: vi.fn(), cancel: vi.fn(async () => {}) },
    })
    await serviceB.load()
    const discovered = await serviceB.list(workspaceB)
    expect(discovered.tasks[0]).toMatchObject({
      definition: { source: 'shared', workspaceRef: { path: workspaceB }, revision: 2 },
      activation: {
        enabled: false,
        confirmedTaskRevision: null,
        confirmedExecutionDigest: null,
      },
    })
    await serviceB.startRuntime({} as never)
    await expect(serviceB.runNow({ workspacePath: workspaceB, taskId })).resolves.toMatchObject({
      success: false,
      error: { code: 'SCHEDULED_TASK_CONFIRMATION_REQUIRED' },
    })
    const confirmed = await serviceB.setEnabled({
      workspacePath: workspaceB,
      taskId,
      enabled: true,
    })
    expect(confirmed.task?.activation).toMatchObject({
      enabled: true,
      confirmedTaskRevision: 2,
      confirmedExecutionDigest: first.task!.definition.executionDigest,
    })

    await serviceA.save({
      ...createInput(true),
      taskId,
      expectedRevision: 2,
      definitionSource: 'shared',
      instruction: '读取工作空间资料并生成新版 Markdown 周报。',
    })
    await copyFile(sharedA, sharedB)
    const refreshed = await serviceB.list(workspaceB)
    expect(refreshed.tasks[0]).toMatchObject({
      definition: { revision: 3 },
      activation: { enabled: false, suspensionReason: 'definition-changed' },
    })
    await serviceB.stopRuntime()
  })

  it('preserves both definitions when either conversion hash mismatches', async () => {
    const service = createService()
    await service.load()
    const saved = await service.save(createInput(false))
    const taskId = saved.task!.definition.id
    const localPath = join(workspacePath, '.cclink-studio/scheduled-tasks', `${taskId}.json`)
    const sharedPath = join(
      workspacePath,
      '.cclink-studio/shared/scheduled-tasks',
      `${taskId}.json`,
    )
    const migrationDirectory = join(workspacePath, '.cclink-studio/scheduled-task-migrations')
    await mkdir(join(workspacePath, '.cclink-studio/shared/scheduled-tasks'), { recursive: true })
    await mkdir(migrationDirectory, { recursive: true })
    const sourceContents = await readFile(localPath, 'utf-8')
    const targetRecord = { ...JSON.parse(sourceContents), revision: 2, updatedAt: 2 }
    const targetContents = `${JSON.stringify(targetRecord, null, 2)}\n`
    await writeFile(sharedPath, targetContents, 'utf-8')
    await writeFile(join(migrationDirectory, `${taskId}.source.bak`), sourceContents, 'utf-8')
    await writeFile(
      join(migrationDirectory, `${taskId}.json`),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          operationId: '12345678-1234-1234-1234-123456789abc',
          workspaceId: 'project-1',
          taskId,
          from: 'local',
          to: 'shared',
          sourceRelativePath: `.cclink-studio/scheduled-tasks/${taskId}.json`,
          sourceBackupRelativePath: `.cclink-studio/scheduled-task-migrations/${taskId}.source.bak`,
          targetRelativePath: `.cclink-studio/shared/scheduled-tasks/${taskId}.json`,
          sourceRevision: 1,
          sourceFileSha256: '0'.repeat(64),
          targetRevision: 2,
          targetFileSha256: createHash('sha256').update(targetContents).digest('hex'),
          phase: 'target-written',
          createdAt: 1,
        },
        null,
        2,
      )}\n`,
      'utf-8',
    )

    const listed = await service.list(workspacePath)
    expect(listed).toMatchObject({
      success: true,
      tasks: [],
      issues: [{ taskId, kind: 'migration-conflict' }],
    })
    await expect(readFile(localPath, 'utf-8')).resolves.toBe(sourceContents)
    await expect(readFile(sharedPath, 'utf-8')).resolves.toBe(targetContents)
  })

  it('cancels a queued run when its task is deleted but lets the running snapshot finish', async () => {
    let finishFirst!: (value: {
      artifact: { relativePath: string; bytes: number; sha256: string }
    }) => void
    const run = vi.fn(
      () =>
        new Promise<{ artifact: { relativePath: string; bytes: number; sha256: string } }>(
          (resolve) => {
            finishFirst = resolve
          },
        ),
    )
    const service = createService({ run, cancel: vi.fn(async () => {}) })
    await service.load()
    const first = await service.save({ ...createInput(false), title: '第一个任务' })
    const second = await service.save({ ...createInput(false), title: '第二个任务' })
    await service.startRuntime({} as never)
    await service.runNow({ workspacePath, taskId: first.task!.definition.id })
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    const queued = await service.runNow({ workspacePath, taskId: second.task!.definition.id })
    expect(queued.run?.status).toBe('queued')

    await expect(
      service.delete({
        workspacePath,
        taskId: second.task!.definition.id,
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ success: true })
    await expect(
      service.listRuns(workspacePath, second.task!.definition.id),
    ).resolves.toMatchObject({
      success: true,
      runs: [{ status: 'cancelled', error: { code: 'SCHEDULED_TASK_DEFINITION_REMOVED' } }],
    })

    await service.delete({
      workspacePath,
      taskId: first.task!.definition.id,
      expectedRevision: 1,
    })
    finishFirst({
      artifact: { relativePath: 'docs/周报/running.md', bytes: 1, sha256: 'f'.repeat(64) },
    })
    await vi.waitFor(async () => {
      const history = await service.listRuns(workspacePath, first.task!.definition.id)
      expect(history.runs[0]?.status).toBe('completed')
    })
    await service.stopRuntime()
  })

  it('disables an externally removed shared task and keeps its local history', async () => {
    const service = createService({
      run: vi.fn(async () => ({
        artifact: {
          relativePath: '.cclink-studio/scheduled-task-results/removed.md',
          bytes: 1,
          sha256: 'a'.repeat(64),
        },
      })),
      cancel: vi.fn(async () => {}),
    })
    await service.load()
    const saved = await service.save({
      ...createInput(true),
      definitionSource: 'shared',
    })
    const taskId = saved.task!.definition.id
    await service.startRuntime({} as never)
    await service.runNow({ workspacePath, taskId })
    await vi.waitFor(async () => {
      expect((await service.listRuns(workspacePath, taskId)).runs[0]?.status).toBe('completed')
    })
    await rm(join(workspacePath, '.cclink-studio/shared/scheduled-tasks', `${taskId}.json`))

    const listed = await service.list(workspacePath)

    expect(listed).toMatchObject({
      success: true,
      tasks: [],
      issues: [
        {
          taskId,
          kind: 'definition-removed',
          message: expect.stringContaining('运行历史仍保留'),
        },
      ],
    })
    await expect(service.listRuns(workspacePath, taskId)).resolves.toMatchObject({
      success: true,
      runs: [{ status: 'completed' }],
    })
    expect(
      JSON.parse(await readFile(join(userDataPath, 'scheduled-tasks/activations.json'), 'utf-8'))
        .activations[`project-1:${taskId}`],
    ).toMatchObject({ enabled: false, suspensionReason: 'definition-removed' })
  })
})

function createService(
  runExecutor?: ScheduledTaskRunExecutor,
  now: () => number = () => Date.parse('2026-07-29T00:00:00.000Z'),
  workspaceProjectIds = new Map([[workspacePath, 'project-1']]),
): ScheduledTaskService {
  const workspaceStateService = {
    resolveLocalWorkspace: vi.fn(async (path: string) => ({
      valid: workspaceProjectIds.has(path),
      workspacePath: workspaceProjectIds.has(path) ? path : null,
    })),
    getLocalProjectId: vi.fn(async (path: string) => workspaceProjectIds.get(path) ?? null),
  } as unknown as WorkspaceStateService
  return new ScheduledTaskService(workspaceStateService, {
    userDataPath,
    homePath: tempDir,
    now,
    runExecutor,
  })
}

function createInput(enable: boolean) {
  return {
    workspacePath,
    title: '每周工作总结',
    instruction: '读取工作空间资料并生成 Markdown 周报。',
    schedule: {
      kind: 'weekly' as const,
      time: '09:00',
      weekdays: [1],
      timezone: 'Asia/Shanghai',
    },
    resources: [{ kind: 'workspace' as const }],
    outputPolicy: {
      directory: 'docs/周报',
      fileNameTemplate: 'weekly-{date}.md',
      mode: 'create-only' as const,
    },
    enable,
  }
}
