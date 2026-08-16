import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    const sidebarRuntime = service.getRuntimeStatus()
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
})

function createService(
  runExecutor?: ScheduledTaskRunExecutor,
  now: () => number = () => Date.parse('2026-07-29T00:00:00.000Z'),
): ScheduledTaskService {
  const workspaceStateService = {
    resolveLocalWorkspace: vi.fn(async (path: string) => ({
      valid: path === workspacePath,
      workspacePath: path === workspacePath ? workspacePath : null,
    })),
    getLocalProjectId: vi.fn(async () => 'project-1'),
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
