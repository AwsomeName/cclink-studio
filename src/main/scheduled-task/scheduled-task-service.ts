import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import {
  parseScheduledTaskDefinition,
  parseScheduledTaskId,
  parseWorkspacePath,
} from '../../shared/scheduled-task/scheduled-task-schema'
import type {
  CancelScheduledTaskRunInput,
  RunScheduledTaskInput,
  SaveScheduledTaskInput,
  ScheduledTaskActivation,
  ScheduledTaskDefinition,
  ScheduledTaskErrorCode,
  ScheduledTaskFailure,
  ScheduledTaskListResult,
  ScheduledTaskOperationResult,
  ScheduledTaskRun,
  ScheduledTaskRunListResult,
  ScheduledTaskRunResult,
  ScheduledTaskRunTrigger,
  ScheduledTaskRuntimeStatus,
  ScheduledTaskSnapshot,
  SetScheduledTaskEnabledInput,
} from '../../shared/scheduled-task/scheduled-task-types'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import type { AgentBridge } from '../agent/agent-bridge'
import { calculateNextRunAt } from '../../shared/scheduled-task/schedule-calculator'
import {
  ScheduledTaskAgentRunner,
  type ScheduledTaskRunExecutor,
} from './scheduled-task-agent-runner'
import { ScheduledTaskRunStore } from './scheduled-task-run-store'

interface ActivationFile {
  schemaVersion: 1
  activations: Record<string, ScheduledTaskActivation>
}

interface ScheduledTaskServiceOptions {
  userDataPath?: string
  homePath?: string
  now?: () => number
  runExecutor?: ScheduledTaskRunExecutor
}

class ScheduledTaskServiceError extends Error {
  constructor(
    readonly code: ScheduledTaskErrorCode,
    message: string,
    readonly recovery?: string,
  ) {
    super(message)
    this.name = 'ScheduledTaskServiceError'
  }
}

export class ScheduledTaskService {
  private readonly activationFilePath: string
  private readonly activationBackupPath: string
  private readonly activationTempPath: string
  private readonly homePath: string
  private readonly now: () => number
  private readonly runStore: ScheduledTaskRunStore
  private runExecutor: ScheduledTaskRunExecutor | null
  private activationFile: ActivationFile = { schemaVersion: 1, activations: {} }
  private activationLoadError: Error | null = null
  private runStoreLoadError: Error | null = null
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly changeListeners = new Set<(workspacePath: string) => void>()
  private readonly runQueue: string[] = []
  private schedulerTimer: ReturnType<typeof setTimeout> | null = null
  private timerDueAt: number | null = null
  private currentRunId: string | null = null
  private runtimeState: ScheduledTaskRuntimeStatus['state'] = 'stopped'
  private runtimeStartedAt: number | null = null
  private lastRuntimeError: ScheduledTaskFailure | undefined

  constructor(
    private readonly workspaceStateService: WorkspaceStateService,
    options: ScheduledTaskServiceOptions = {},
  ) {
    const root = join(options.userDataPath ?? app.getPath('userData'), 'scheduled-tasks')
    this.activationFilePath = join(root, 'activations.json')
    this.activationBackupPath = `${this.activationFilePath}.bak`
    this.activationTempPath = `${this.activationFilePath}.${process.pid}.tmp`
    this.homePath = resolve(options.homePath ?? app.getPath('home'))
    this.now = options.now ?? Date.now
    this.runStore = new ScheduledTaskRunStore(join(root, 'runs.json'))
    this.runExecutor = options.runExecutor ?? null
  }

  async load(): Promise<void> {
    this.activationLoadError = null
    try {
      this.activationFile = parseActivationFile(
        JSON.parse(await readFile(this.activationFilePath, 'utf-8')),
      )
    } catch (error) {
      if (isMissingFileError(error)) {
        this.activationFile = { schemaVersion: 1, activations: {} }
      } else {
        this.activationLoadError = error instanceof Error ? error : new Error(String(error))
        this.activationFile = { schemaVersion: 1, activations: {} }
        console.error('[ScheduledTaskService] 本机启用状态加载失败:', error)
      }
    }
    this.runStoreLoadError = null
    try {
      await this.runStore.load(this.now())
    } catch (error) {
      this.runStoreLoadError = error instanceof Error ? error : new Error(String(error))
      console.error('[ScheduledTaskService] 运行账本加载失败，调度能力降级:', error)
    }
  }

  async startRuntime(agentBridge: AgentBridge): Promise<void> {
    if (this.runtimeState === 'ready') return
    if (this.activationLoadError || this.runStoreLoadError) {
      this.runtimeState = 'degraded'
      this.lastRuntimeError = {
        code: 'SCHEDULED_TASK_STORE_INVALID',
        message: '定时任务本机状态损坏，调度已停用',
        recovery: '修复或移走 userData/scheduled-tasks 中的损坏文件后重启',
      }
      return
    }
    this.runExecutor ??= new ScheduledTaskAgentRunner(agentBridge)
    this.runtimeState = 'ready'
    this.runtimeStartedAt = this.now()
    this.lastRuntimeError = undefined
    try {
      await this.reconcileMissedOccurrences()
      this.armScheduler()
    } catch (error) {
      this.runtimeState = 'degraded'
      this.lastRuntimeError = toFailure(error)
      console.error('[ScheduledTaskService] App 内调度启动降级:', error)
    }
  }

  async markRuntimeUnavailable(message: string): Promise<void> {
    if (this.runtimeState === 'ready' || this.runtimeState === 'stopping') {
      await this.stopRuntime()
    }
    this.runtimeState = 'degraded'
    this.lastRuntimeError = {
      code: 'SCHEDULED_TASK_AGENT_UNAVAILABLE',
      message,
      recovery: '检查 Agent 设置后重试',
    }
  }

  async stopRuntime(): Promise<void> {
    if (this.runtimeState === 'stopped') return
    this.runtimeState = 'stopping'
    this.clearSchedulerTimer()
    const timestamp = this.now()
    for (const runId of this.runQueue.splice(0)) {
      const run = this.runStore.get(runId)
      if (!run || run.status !== 'queued') continue
      await this.updateRun(run, {
        status: 'cancelled',
        currentStep: 'App 正在退出，排队运行已取消',
        finishedAt: timestamp,
      })
    }
    if (this.currentRunId) {
      const activeRunId = this.currentRunId
      const run = this.runStore.get(activeRunId)
      if (run && (run.status === 'queued' || run.status === 'running')) {
        await this.updateRun(run, {
          status: 'interrupted',
          currentStep: 'App 退出时运行尚未完成',
          finishedAt: this.now(),
          error: {
            code: 'SCHEDULED_TASK_STOPPING',
            message: 'App 退出，运行已中断',
            recovery: '重新打开后手动重试',
          },
        })
      }
      await this.runExecutor?.cancel(activeRunId).catch(() => {})
    }
    this.currentRunId = null
    this.runtimeState = 'stopped'
    this.runtimeStartedAt = null
    await this.flush()
  }

  onChanged(listener: (workspacePath: string) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  async list(workspacePath: string): Promise<ScheduledTaskListResult> {
    try {
      const context = await this.resolveWorkspace(workspacePath, false)
      this.assertActivationStoreAvailable()
      const definitions = await this.readDefinitions(context.workspacePath)
      return {
        success: true,
        tasks: definitions
          .map((definition) => this.createSnapshot(definition, context.workspaceId))
          .sort((left, right) => right.definition.updatedAt - left.definition.updatedAt),
      }
    } catch (error) {
      return { success: false, tasks: [], error: toFailure(error) }
    }
  }

  async get(workspacePath: string, taskId: string): Promise<ScheduledTaskOperationResult> {
    try {
      const context = await this.resolveWorkspace(workspacePath, false)
      this.assertActivationStoreAvailable()
      const definition = await this.readDefinition(context.workspacePath, taskId)
      return {
        success: true,
        task: this.createSnapshot(definition, context.workspaceId),
      }
    } catch (error) {
      return { success: false, error: toFailure(error) }
    }
  }

  async save(input: SaveScheduledTaskInput): Promise<ScheduledTaskOperationResult> {
    return this.enqueue(async () => {
      try {
        const context = await this.resolveWorkspace(input.workspacePath, true)
        this.assertActivationStoreAvailable()
        const previous = input.taskId
          ? await this.readDefinition(context.workspacePath, input.taskId)
          : null
        if (
          previous &&
          input.expectedRevision !== undefined &&
          previous.revision !== input.expectedRevision
        ) {
          throw new ScheduledTaskServiceError(
            'SCHEDULED_TASK_REVISION_CONFLICT',
            '任务已在其他位置更新，未覆盖较新的版本',
            '重新打开任务并合并修改后再保存',
          )
        }

        const timestamp = this.now()
        const definition: ScheduledTaskDefinition = {
          schemaVersion: 1,
          id: previous?.id ?? randomUUID(),
          workspaceRef: { kind: 'local', path: context.workspacePath },
          revision: previous ? previous.revision + 1 : 1,
          title: input.title,
          instruction: input.instruction,
          schedule: input.schedule,
          resources: input.resources,
          outputPolicy: input.outputPolicy,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        }
        await this.writeDefinition(context.workspacePath, definition)

        const activation = this.createActivation(definition, context.workspaceId, input.enable)
        this.activationFile.activations[activationKey(context.workspaceId, definition.id)] =
          activation
        await this.writeActivationFile()
        this.armScheduler()
        this.notifyChanged(context.workspacePath)
        return {
          success: true,
          task: {
            definition,
            activation,
            latestRun: this.latestRun(context.workspacePath, definition.id),
          },
        }
      } catch (error) {
        return { success: false, error: toFailure(error) }
      }
    })
  }

  async setEnabled(input: SetScheduledTaskEnabledInput): Promise<ScheduledTaskOperationResult> {
    return this.enqueue(async () => {
      try {
        const context = await this.resolveWorkspace(input.workspacePath, false)
        this.assertActivationStoreAvailable()
        const definition = await this.readDefinition(context.workspacePath, input.taskId)
        const activation = this.createActivation(
          definition,
          context.workspaceId,
          input.enabled,
          this.activationFile.activations[activationKey(context.workspaceId, definition.id)],
        )
        this.activationFile.activations[activationKey(context.workspaceId, definition.id)] =
          activation
        await this.writeActivationFile()
        this.armScheduler()
        this.notifyChanged(context.workspacePath)
        return {
          success: true,
          task: {
            definition,
            activation,
            latestRun: this.latestRun(context.workspacePath, definition.id),
          },
        }
      } catch (error) {
        return { success: false, error: toFailure(error) }
      }
    })
  }

  async runNow(input: RunScheduledTaskInput): Promise<ScheduledTaskRunResult> {
    return this.enqueue(async () => {
      try {
        this.assertRunStoreAvailable()
        if (this.runtimeState !== 'ready' || !this.runExecutor) {
          throw new ScheduledTaskServiceError(
            'SCHEDULED_TASK_AGENT_UNAVAILABLE',
            '本地 Agent 尚未就绪，无法运行定时任务',
            '检查 Agent 设置后重试',
          )
        }
        const context = await this.resolveWorkspace(input.workspacePath, false)
        const definition = await this.readDefinition(context.workspacePath, input.taskId)
        const duplicate = this.runStore
          .list(context.workspacePath, definition.id)
          .find((run) => run.status === 'queued' || run.status === 'running')
        if (duplicate) return { success: true, run: duplicate }
        const run = await this.claimRun(
          definition,
          context.workspaceId,
          'manual',
          null,
          `manual:${definition.id}:${randomUUID()}`,
        )
        this.queueRun(run)
        return { success: true, run }
      } catch (error) {
        return { success: false, error: toFailure(error) }
      }
    })
  }

  async cancelRun(input: CancelScheduledTaskRunInput): Promise<ScheduledTaskRunResult> {
    return this.enqueue(async () => {
      try {
        const context = await this.resolveWorkspace(input.workspacePath, false)
        const run = this.runStore.get(input.runId)
        if (!run || run.workspaceRef.path !== context.workspacePath) {
          throw new ScheduledTaskServiceError(
            'SCHEDULED_TASK_RUN_NOT_FOUND',
            '找不到要取消的运行',
            '刷新运行历史后重试',
          )
        }
        if (run.status === 'queued') {
          const index = this.runQueue.indexOf(run.id)
          if (index >= 0) this.runQueue.splice(index, 1)
          await this.updateRun(run, {
            status: 'cancelled',
            currentStep: '已由用户取消',
            finishedAt: this.now(),
          })
        } else if (run.status === 'running') {
          await this.updateRun(run, {
            status: 'cancelled',
            currentStep: '已由用户取消',
            finishedAt: this.now(),
          })
          await this.runExecutor?.cancel(run.id)
          if (this.currentRunId === run.id) this.currentRunId = null
          void this.processQueue()
        }
        return { success: true, run: this.runStore.get(run.id) ?? run }
      } catch (error) {
        return { success: false, error: toFailure(error) }
      }
    })
  }

  async listRuns(workspacePath: string, taskId: string): Promise<ScheduledTaskRunListResult> {
    try {
      this.assertRunStoreAvailable()
      const context = await this.resolveWorkspace(workspacePath, false)
      await this.readDefinition(context.workspacePath, taskId)
      return { success: true, runs: this.runStore.list(context.workspacePath, taskId) }
    } catch (error) {
      return { success: false, runs: [], error: toFailure(error) }
    }
  }

  getRuntimeStatus(): ScheduledTaskRuntimeStatus {
    return {
      state: this.runtimeState,
      startedAt: this.runtimeStartedAt,
      timerDueAt: this.timerDueAt,
      queuedCount: this.runQueue.length,
      runningRunId: this.currentRunId,
      enabledCount: Object.values(this.activationFile.activations).filter(
        (activation) => activation.enabled,
      ).length,
      ...(this.lastRuntimeError ? { lastError: this.lastRuntimeError } : {}),
      systemScheduler: 'none',
    }
  }

  async flush(): Promise<void> {
    await this.mutationQueue.catch(() => {})
    if (!this.runStoreLoadError) await this.runStore.flush()
  }

  private async reconcileMissedOccurrences(): Promise<void> {
    const timestamp = this.now()
    for (const activation of Object.values(this.activationFile.activations)) {
      if (
        !activation.enabled ||
        activation.nextRunAt === null ||
        activation.nextRunAt > timestamp
      ) {
        continue
      }
      try {
        const definition = await this.readDefinition(
          activation.workspaceRef.path,
          activation.taskId,
        )
        const scheduledFor = latestDueOccurrence(definition, activation.nextRunAt, timestamp)
        const key = occurrenceKey(definition.id, scheduledFor)
        if (!this.runStore.findOccurrence(key)) {
          if (
            definition.schedule.kind !== 'once' &&
            timestamp - scheduledFor <= activation.catchUpPolicy.windowMinutes * 60_000
          ) {
            const run = await this.claimRun(
              definition,
              activation.workspaceId,
              'catch-up',
              scheduledFor,
              key,
            )
            this.queueRun(run)
          } else {
            await this.recordMissed(definition, activation.workspaceId, scheduledFor, key)
          }
        }
        activation.lastEvaluatedAt = timestamp
        activation.nextRunAt =
          definition.schedule.kind === 'once'
            ? null
            : calculateNextRunAt(definition.schedule, timestamp)
      } catch (error) {
        this.lastRuntimeError = toFailure(error)
      }
    }
    await this.writeActivationFile()
  }

  private armScheduler(): void {
    this.clearSchedulerTimer()
    if (this.runtimeState !== 'ready') return
    const nextRunAt = Object.values(this.activationFile.activations)
      .filter(
        (activation): activation is ScheduledTaskActivation & { nextRunAt: number } =>
          activation.enabled && activation.nextRunAt !== null,
      )
      .reduce<number | null>(
        (earliest, activation) =>
          earliest === null || activation.nextRunAt < earliest ? activation.nextRunAt : earliest,
        null,
      )
    if (nextRunAt === null) return
    this.timerDueAt = nextRunAt
    const delay = Math.max(0, Math.min(nextRunAt - this.now(), 2_147_000_000))
    this.schedulerTimer = setTimeout(() => {
      this.schedulerTimer = null
      this.timerDueAt = null
      void this.handleDueOccurrences()
    }, delay)
  }

  private clearSchedulerTimer(): void {
    if (this.schedulerTimer) clearTimeout(this.schedulerTimer)
    this.schedulerTimer = null
    this.timerDueAt = null
  }

  private async handleDueOccurrences(): Promise<void> {
    await this.enqueue(async () => {
      if (this.runtimeState !== 'ready') return
      const timestamp = this.now()
      const due = Object.values(this.activationFile.activations)
        .filter(
          (activation): activation is ScheduledTaskActivation & { nextRunAt: number } =>
            activation.enabled &&
            activation.nextRunAt !== null &&
            activation.nextRunAt <= timestamp,
        )
        .sort(
          (left, right) =>
            left.nextRunAt - right.nextRunAt || left.taskId.localeCompare(right.taskId),
        )
      for (const activation of due) {
        try {
          const definition = await this.readDefinition(
            activation.workspaceRef.path,
            activation.taskId,
          )
          const scheduledFor = activation.nextRunAt
          const key = occurrenceKey(definition.id, scheduledFor)
          const mutableActivation: ScheduledTaskActivation = activation
          mutableActivation.lastEvaluatedAt = timestamp
          mutableActivation.nextRunAt =
            definition.schedule.kind === 'once'
              ? null
              : calculateNextRunAt(definition.schedule, scheduledFor)
          if (!this.runStore.findOccurrence(key)) {
            const run = await this.claimRun(
              definition,
              activation.workspaceId,
              'scheduled',
              scheduledFor,
              key,
            )
            this.queueRun(run)
          }
        } catch (error) {
          this.lastRuntimeError = toFailure(error)
        }
      }
      await this.writeActivationFile()
      this.armScheduler()
    })
  }

  private async claimRun(
    definition: ScheduledTaskDefinition,
    workspaceId: string,
    trigger: ScheduledTaskRunTrigger,
    scheduledFor: number | null,
    key: string,
  ): Promise<ScheduledTaskRun> {
    const existing = this.runStore.findOccurrence(key)
    if (existing) return existing
    const timestamp = this.now()
    const id = randomUUID()
    const run: ScheduledTaskRun = {
      schemaVersion: 1,
      id,
      occurrenceKey: key,
      taskId: definition.id,
      taskRevision: definition.revision,
      workspaceId,
      workspaceRef: definition.workspaceRef,
      conversationId: `scheduled-task:${id}`,
      trigger,
      scheduledFor,
      status: 'queued',
      currentStep: '等待本地 Agent',
      createdAt: timestamp,
      startedAt: null,
      finishedAt: null,
    }
    await this.runStore.put(run)
    this.notifyChanged(definition.workspaceRef.path)
    return run
  }

  private queueRun(run: ScheduledTaskRun): void {
    if (run.status !== 'queued' || this.runQueue.includes(run.id) || this.currentRunId === run.id) {
      return
    }
    this.runQueue.push(run.id)
    void this.processQueue()
  }

  private async processQueue(): Promise<void> {
    if (
      this.currentRunId ||
      this.runtimeState !== 'ready' ||
      !this.runExecutor ||
      this.runQueue.length === 0
    ) {
      return
    }
    const runId = this.runQueue.shift()
    if (!runId) return
    const run = this.runStore.get(runId)
    if (!run || run.status !== 'queued') {
      void this.processQueue()
      return
    }
    this.currentRunId = run.id
    const definition = await this.readDefinition(run.workspaceRef.path, run.taskId).catch(
      () => null,
    )
    if (!definition || definition.revision !== run.taskRevision) {
      await this.updateRun(run, {
        status: 'failed',
        currentStep: '固定 revision 已不可用',
        finishedAt: this.now(),
        error: {
          code: 'SCHEDULED_TASK_REVISION_CONFLICT',
          message: '运行固定的任务 revision 已不可用',
          recovery: '保存任务后重新运行',
        },
      })
      this.currentRunId = null
      void this.processQueue()
      return
    }
    const unsupportedCapability = findUnsupportedCapability(definition.instruction)
    if (unsupportedCapability) {
      await this.updateRun(run, {
        status: 'failed',
        currentStep: `首版不支持 ${unsupportedCapability}`,
        finishedAt: this.now(),
        error: {
          code: 'SCHEDULED_TASK_INVALID',
          message: `定时任务首版不支持 ${unsupportedCapability}，没有执行任何外部动作`,
          recovery: '改为只读取工作空间资料并生成 Markdown 后重试',
        },
      })
      this.currentRunId = null
      void this.processQueue()
      return
    }
    if (this.runtimeState !== 'ready') {
      this.currentRunId = null
      return
    }
    await this.updateRun(run, {
      status: 'running',
      currentStep: 'Agent 正在执行任务',
      startedAt: this.now(),
    })
    const runnable = this.runStore.get(run.id)
    if (
      this.runtimeState !== 'ready' ||
      this.currentRunId !== run.id ||
      runnable?.status !== 'running'
    ) {
      if (this.currentRunId === run.id) this.currentRunId = null
      void this.processQueue()
      return
    }
    try {
      const result = await this.runExecutor.run({
        runId: run.id,
        conversationId: run.conversationId,
        definition,
        scheduledFor: run.scheduledFor,
      })
      const current = this.runStore.get(run.id)
      if (current?.status === 'running') {
        await this.updateRun(current, {
          status: 'completed',
          currentStep: '任务已完成，运行结果已保存',
          finishedAt: this.now(),
          artifact: result.artifact,
        })
      }
    } catch (error) {
      const current = this.runStore.get(run.id)
      if (current?.status === 'running') {
        await this.updateRun(current, {
          status: 'failed',
          currentStep: '运行失败',
          finishedAt: this.now(),
          error: classifyRunFailure(error),
        })
      }
    } finally {
      if (this.currentRunId === run.id) this.currentRunId = null
      void this.processQueue()
    }
  }

  private async updateRun(
    run: ScheduledTaskRun,
    updates: Partial<ScheduledTaskRun>,
  ): Promise<ScheduledTaskRun> {
    const next = { ...run, ...updates }
    await this.runStore.put(next)
    this.notifyChanged(next.workspaceRef.path)
    return next
  }

  private async recordMissed(
    definition: ScheduledTaskDefinition,
    workspaceId: string,
    scheduledFor: number,
    key: string,
  ): Promise<void> {
    if (this.runStore.findOccurrence(key)) return
    const timestamp = this.now()
    const run: ScheduledTaskRun = {
      schemaVersion: 1,
      id: randomUUID(),
      occurrenceKey: key,
      taskId: definition.id,
      taskRevision: definition.revision,
      workspaceId,
      workspaceRef: definition.workspaceRef,
      conversationId: '',
      trigger: 'scheduled',
      scheduledFor,
      status: 'missed',
      currentStep: 'App 未运行或恢复时已超过 30 分钟补执行窗口',
      createdAt: timestamp,
      startedAt: null,
      finishedAt: timestamp,
    }
    await this.runStore.put(run)
    this.notifyChanged(definition.workspaceRef.path)
  }

  private latestRun(workspacePath: string, taskId: string): ScheduledTaskRun | undefined {
    if (this.runStoreLoadError) return undefined
    return this.runStore.list(workspacePath, taskId)[0]
  }

  private notifyChanged(workspacePath: string): void {
    for (const listener of this.changeListeners) listener(workspacePath)
  }

  private async resolveWorkspace(
    workspacePath: string,
    requireWritable: boolean,
  ): Promise<{ workspacePath: string; workspaceId: string }> {
    const resolved = await this.workspaceStateService.resolveLocalWorkspace(workspacePath)
    if (!resolved.valid || !resolved.workspacePath) {
      throw new ScheduledTaskServiceError(
        'SCHEDULED_TASK_WORKSPACE_UNAVAILABLE',
        '当前工作空间不可用',
        '重新打开本地工作空间后重试',
      )
    }
    const workspaceId = await this.workspaceStateService.getLocalProjectId(resolved.workspacePath)
    if (!workspaceId) {
      throw new ScheduledTaskServiceError(
        requireWritable
          ? 'SCHEDULED_TASK_WORKSPACE_READ_ONLY'
          : 'SCHEDULED_TASK_WORKSPACE_UNAVAILABLE',
        requireWritable ? '当前工作空间不可写，无法保存定时任务' : '工作空间身份不可用',
        '确认工作空间可写后重新打开',
      )
    }
    return { workspacePath: resolved.workspacePath, workspaceId }
  }

  private async readDefinitions(workspacePath: string): Promise<ScheduledTaskDefinition[]> {
    const directory = definitionsDirectory(workspacePath)
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
    const definitions: ScheduledTaskDefinition[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const taskId = parseScheduledTaskId(entry.name.slice(0, -5))
        definitions.push(await this.readDefinition(workspacePath, taskId))
      } catch {
        throw new ScheduledTaskServiceError(
          'SCHEDULED_TASK_STORE_INVALID',
          '工作空间中的定时任务定义损坏',
          '修复 .cclink-studio/scheduled-tasks 中的 JSON 后重试',
        )
      }
    }
    return definitions
  }

  private async readDefinition(
    workspacePath: string,
    taskId: string,
  ): Promise<ScheduledTaskDefinition> {
    parseScheduledTaskId(taskId)
    try {
      const raw = JSON.parse(
        await readFile(join(definitionsDirectory(workspacePath), `${taskId}.json`), 'utf-8'),
      )
      const definition = parseScheduledTaskDefinition(raw)
      if (definition.id !== taskId || definition.workspaceRef.path !== workspacePath) {
        throw new Error('任务身份或工作空间不匹配')
      }
      return definition
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new ScheduledTaskServiceError(
          'SCHEDULED_TASK_NOT_FOUND',
          '定时任务不存在',
          '刷新侧栏后重试',
        )
      }
      if (error instanceof ScheduledTaskServiceError) throw error
      throw new ScheduledTaskServiceError(
        'SCHEDULED_TASK_STORE_INVALID',
        '定时任务定义不可读取',
        '检查工作空间中的任务定义文件后重试',
      )
    }
  }

  private async writeDefinition(
    workspacePath: string,
    definition: ScheduledTaskDefinition,
  ): Promise<void> {
    const directory = definitionsDirectory(workspacePath)
    const filePath = join(directory, `${definition.id}.json`)
    const backupPath = `${filePath}.bak`
    const tempPath = `${filePath}.${process.pid}.tmp`
    try {
      await mkdir(directory, { recursive: true })
      await this.ensureDefinitionExcluded(workspacePath)
      try {
        if ((await stat(filePath)).isFile()) await copyFile(filePath, backupPath)
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
      await writeFile(tempPath, `${JSON.stringify(definition, null, 2)}\n`, 'utf-8')
      await rename(tempPath, filePath)
    } catch (error) {
      console.error('[ScheduledTaskService] 定时任务定义写入失败:', error)
      throw new ScheduledTaskServiceError(
        'SCHEDULED_TASK_WRITE_FAILED',
        '定时任务定义写入失败',
        '确认工作空间可写且磁盘空间充足后重试',
      )
    }
  }

  private async ensureDefinitionExcluded(workspacePath: string): Promise<void> {
    const dotGitPath = join(workspacePath, '.git')
    let dotGitStat
    try {
      dotGitStat = await stat(dotGitPath)
    } catch (error) {
      if (isMissingFileError(error)) return
      throw error
    }

    let gitDirectory: string
    if (dotGitStat.isDirectory()) {
      gitDirectory = await realpath(dotGitPath)
    } else if (dotGitStat.isFile()) {
      const pointer = (await readFile(dotGitPath, 'utf-8')).trim()
      const match = /^gitdir:\s*(.+)$/i.exec(pointer)
      if (!match || pointer.length > 4096) throw new Error('Git worktree 元数据无效')
      const candidate = match[1]
      gitDirectory = await realpath(
        isAbsolute(candidate) ? candidate : resolve(workspacePath, candidate),
      )
      try {
        const commonDirectory = (await readFile(join(gitDirectory, 'commondir'), 'utf-8')).trim()
        if (commonDirectory) {
          gitDirectory = await realpath(
            isAbsolute(commonDirectory) ? commonDirectory : resolve(gitDirectory, commonDirectory),
          )
        }
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
    } else {
      return
    }

    const canonicalHomePath = await realpath(this.homePath)
    if (!isPathWithin(canonicalHomePath, gitDirectory)) {
      throw new Error('Git 元数据不在用户主目录下')
    }
    const excludePath = join(gitDirectory, 'info', 'exclude')
    await mkdir(dirname(excludePath), { recursive: true })
    let current = ''
    try {
      current = await readFile(excludePath, 'utf-8')
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
    const patterns = ['/.cclink-studio/scheduled-tasks/', '/.cclink-studio/scheduled-task-results/']
    const existing = new Set(current.split(/\r?\n/).map((line) => line.trim()))
    const missing = patterns.filter((pattern) => !existing.has(pattern))
    if (missing.length === 0) return
    const prefix = current && !current.endsWith('\n') ? '\n' : ''
    await appendFile(
      excludePath,
      `${prefix}# CCLink Studio scheduled task data\n${missing.join('\n')}\n`,
      'utf-8',
    )
  }

  private createSnapshot(
    definition: ScheduledTaskDefinition,
    workspaceId: string,
  ): ScheduledTaskSnapshot {
    const existing = this.activationFile.activations[activationKey(workspaceId, definition.id)]
    return {
      definition,
      activation: existing ?? this.createActivation(definition, workspaceId, false),
      latestRun: this.latestRun(definition.workspaceRef.path, definition.id),
    }
  }

  private createActivation(
    definition: ScheduledTaskDefinition,
    workspaceId: string,
    enabled: boolean,
    previous?: ScheduledTaskActivation,
  ): ScheduledTaskActivation {
    return {
      taskId: definition.id,
      workspaceId,
      workspaceRef: definition.workspaceRef,
      enabled,
      catchUpPolicy: { mode: 'latest-within-window', windowMinutes: 30 },
      lastEvaluatedAt: previous?.lastEvaluatedAt ?? null,
      nextRunAt: enabled ? calculateNextRunAt(definition.schedule, this.now()) : null,
    }
  }

  private assertActivationStoreAvailable(): void {
    if (!this.activationLoadError) return
    throw new ScheduledTaskServiceError(
      'SCHEDULED_TASK_STORE_INVALID',
      '本机定时任务启用状态损坏，已阻止静默覆盖',
      '修复或移走 userData/scheduled-tasks/activations.json 后重启',
    )
  }

  private assertRunStoreAvailable(): void {
    if (!this.runStoreLoadError) return
    throw new ScheduledTaskServiceError(
      'SCHEDULED_TASK_STORE_INVALID',
      '定时任务运行账本损坏，已阻止运行',
      '修复或移走 userData/scheduled-tasks/runs.json 后重启',
    )
  }

  private async writeActivationFile(): Promise<void> {
    try {
      await mkdir(dirname(this.activationFilePath), { recursive: true })
      try {
        if ((await stat(this.activationFilePath)).isFile()) {
          await copyFile(this.activationFilePath, this.activationBackupPath)
        }
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
      await writeFile(
        this.activationTempPath,
        `${JSON.stringify(this.activationFile, null, 2)}\n`,
        { encoding: 'utf-8', mode: 0o600 },
      )
      await rename(this.activationTempPath, this.activationFilePath)
    } catch {
      throw new ScheduledTaskServiceError(
        'SCHEDULED_TASK_WRITE_FAILED',
        '本机启用状态写入失败',
        '确认磁盘空间充足后重试',
      )
    }
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

function definitionsDirectory(workspacePath: string): string {
  return join(workspacePath, '.cclink-studio', 'scheduled-tasks')
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const root = resolve(rootPath)
  const candidate = resolve(candidatePath)
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function activationKey(workspaceId: string, taskId: string): string {
  return `${workspaceId}:${taskId}`
}

function occurrenceKey(taskId: string, scheduledFor: number): string {
  return `scheduled:${taskId}:${scheduledFor}`
}

function latestDueOccurrence(
  definition: ScheduledTaskDefinition,
  firstDueAt: number,
  now: number,
): number {
  if (definition.schedule.kind === 'once') return firstDueAt
  let latest = firstDueAt
  for (let count = 0; count < 10_000; count += 1) {
    const next = calculateNextRunAt(definition.schedule, latest)
    if (next === null || next > now) return latest
    latest = next
  }
  return latest
}

function parseActivationFile(value: unknown): ActivationFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('本机启用状态不是对象')
  }
  const input = value as Partial<ActivationFile>
  assertExactKeys(input as Record<string, unknown>, ['schemaVersion', 'activations'])
  if (input.schemaVersion !== 1 || !input.activations || typeof input.activations !== 'object') {
    throw new Error('本机启用状态版本无效')
  }
  const activations: Record<string, ScheduledTaskActivation> = {}
  for (const [key, raw] of Object.entries(input.activations)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('本机启用记录无效')
    }
    const activation = raw as ScheduledTaskActivation
    assertExactKeys(activation as unknown as Record<string, unknown>, [
      'taskId',
      'workspaceId',
      'workspaceRef',
      'enabled',
      'catchUpPolicy',
      'lastEvaluatedAt',
      'nextRunAt',
    ])
    const workspaceRef = activation.workspaceRef as unknown as Record<string, unknown>
    const catchUpPolicy = activation.catchUpPolicy as unknown as Record<string, unknown>
    assertExactKeys(workspaceRef, ['kind', 'path'])
    assertExactKeys(catchUpPolicy, ['mode', 'windowMinutes'])
    if (
      typeof activation.workspaceId !== 'string' ||
      activation.workspaceRef?.kind !== 'local' ||
      typeof activation.workspaceRef.path !== 'string' ||
      typeof activation.enabled !== 'boolean' ||
      activation.catchUpPolicy?.mode !== 'latest-within-window' ||
      activation.catchUpPolicy.windowMinutes !== 30 ||
      (activation.lastEvaluatedAt !== null &&
        (typeof activation.lastEvaluatedAt !== 'number' ||
          !Number.isSafeInteger(activation.lastEvaluatedAt))) ||
      (activation.nextRunAt !== null &&
        (typeof activation.nextRunAt !== 'number' || !Number.isSafeInteger(activation.nextRunAt)))
    ) {
      throw new Error('本机启用记录无效')
    }
    parseScheduledTaskId(activation.taskId)
    parseWorkspacePath(activation.workspaceRef.path)
    if (key !== activationKey(activation.workspaceId, activation.taskId)) {
      throw new Error('本机启用记录键无效')
    }
    activations[key] = activation
  }
  return { schemaVersion: 1, activations }
}

function assertExactKeys(value: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys)
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error('持久化记录包含未知字段')
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function toFailure(error: unknown): ScheduledTaskFailure {
  if (error instanceof ScheduledTaskServiceError) {
    return { code: error.code, message: error.message, recovery: error.recovery }
  }
  console.error('[ScheduledTaskService] 未分类错误:', error)
  return {
    code: 'SCHEDULED_TASK_WRITE_FAILED',
    message: '定时任务操作失败',
    recovery: '刷新任务列表后重试',
  }
}

function classifyRunFailure(error: unknown): ScheduledTaskFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('create-only') || message.includes('已存在')) {
    return {
      code: 'SCHEDULED_TASK_OUTPUT_EXISTS',
      message: '输出文件已存在，create-only 任务未覆盖它',
      recovery: '调整文件名模板或移走已有文件后重试',
    }
  }
  if (
    message.includes('输出') ||
    message.includes('Markdown') ||
    message.includes('逃逸') ||
    message.includes('读取路径')
  ) {
    return {
      code: 'SCHEDULED_TASK_OUTPUT_INVALID',
      message,
      recovery: '检查绑定资源和输出目录后重试',
    }
  }
  return {
    code: 'SCHEDULED_TASK_AGENT_UNAVAILABLE',
    message,
    recovery: '检查 Agent 配置与网络后重试',
  }
}

function findUnsupportedCapability(instruction: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [/(?:运行|执行|调用|使用|打开).{0,16}(?:terminal|终端|shell|命令)/i, 'Terminal'],
    [/(?:运行|执行|调用|使用|打开).{0,16}(?:browser|浏览器)/i, 'Browser'],
    [/(?:运行|执行|调用|使用|连接).{0,16}(?:android|安卓|手机)/i, 'Android'],
    [/(?:运行|执行|调用|使用|提交).{0,16}\bgit\b/i, 'Git'],
    [/(?:运行|执行|调用|使用|查询).{0,16}(?:数据源|database|数据库)/i, '数据源'],
  ]
  return patterns.find(([pattern]) => pattern.test(instruction))?.[1] ?? null
}
