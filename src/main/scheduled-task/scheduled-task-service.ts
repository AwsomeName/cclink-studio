import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import {
  materializeScheduledTaskDefinition,
  parseStoredScheduledTaskDefinition,
  parseScheduledTaskId,
  parseWorkspacePath,
} from '../../shared/scheduled-task/scheduled-task-schema'
import type {
  CancelScheduledTaskRunInput,
  DeleteScheduledTaskInput,
  RunScheduledTaskInput,
  SaveScheduledTaskInput,
  ScheduledTaskActivation,
  ScheduledTaskDefinition,
  ScheduledTaskDefinitionIssue,
  ScheduledTaskDefinitionSource,
  ScheduledTaskErrorCode,
  ScheduledTaskFailure,
  ScheduledTaskListResult,
  ScheduledTaskOperationResult,
  ScheduledTaskRun,
  ScheduledTaskRunListResult,
  ScheduledTaskRunResult,
  ScheduledTaskRunTrigger,
  ScheduledTaskRuntimeStatus,
  ScheduledTaskWorkspaceRuntimeStatusResult,
  ScheduledTaskSnapshot,
  SetScheduledTaskEnabledInput,
  StoredScheduledTaskDefinitionV2,
} from '../../shared/scheduled-task/scheduled-task-types'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import type { AgentBridge } from '../agent/agent-bridge'
import { calculateNextRunAt } from '../../shared/scheduled-task/schedule-calculator'
import {
  ScheduledTaskAgentRunner,
  type ScheduledTaskRunExecutor,
} from './scheduled-task-agent-runner'
import { ScheduledTaskRunStore } from './scheduled-task-run-store'
import { computeScheduledTaskExecutionDigest } from './scheduled-task-definition-digest'
import {
  containsObviousSecretText,
  updateCclinkStudioExcludeBlock,
} from '../git/cclink-studio-path-policy'

interface ActivationFile {
  schemaVersion: 2
  activations: Record<string, ScheduledTaskActivation>
}

interface DefinitionListReadResult {
  definitions: ScheduledTaskDefinition[]
  issues: ScheduledTaskDefinitionIssue[]
}

interface DefinitionMigrationJournal {
  schemaVersion: 1
  operationId: string
  workspaceId: string
  taskId: string
  from: ScheduledTaskDefinitionSource
  to: ScheduledTaskDefinitionSource
  sourceRelativePath: string
  sourceBackupRelativePath: string
  targetRelativePath: string
  sourceRevision: number
  sourceFileSha256: string
  targetRevision: number
  targetFileSha256: string
  phase: 'prepared' | 'target-written' | 'source-removed'
  createdAt: number
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
  private activationFile: ActivationFile = { schemaVersion: 2, activations: {} }
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
  /** null 表示 Runtime 全局错误；路径表示只属于该工作空间。 */
  private lastRuntimeErrorWorkspacePath: string | null = null

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
      const parsed = parseActivationFile(
        JSON.parse(await readFile(this.activationFilePath, 'utf-8')),
      )
      this.activationFile = parsed.file
      if (parsed.migrated) await this.writeActivationFile()
    } catch (error) {
      if (isMissingFileError(error)) {
        this.activationFile = { schemaVersion: 2, activations: {} }
      } else {
        this.activationLoadError = error instanceof Error ? error : new Error(String(error))
        this.activationFile = { schemaVersion: 2, activations: {} }
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
      this.lastRuntimeErrorWorkspacePath = null
      return
    }
    this.runExecutor ??= new ScheduledTaskAgentRunner(agentBridge)
    this.runtimeState = 'ready'
    this.runtimeStartedAt = this.now()
    this.lastRuntimeError = undefined
    this.lastRuntimeErrorWorkspacePath = null
    try {
      await this.reconcileMissedOccurrences()
      this.armScheduler()
    } catch (error) {
      this.runtimeState = 'degraded'
      this.lastRuntimeError = toFailure(error)
      this.lastRuntimeErrorWorkspacePath = null
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
    this.lastRuntimeErrorWorkspacePath = null
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
      const { definitions, issues } = await this.readDefinitions(context.workspacePath)
      await this.reconcileDefinitionActivations(context.workspaceId, definitions, issues)
      return {
        success: true,
        ...(issues.length ? { issues } : {}),
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
      await this.reconcileDefinitionActivations(context.workspaceId, [definition], [])
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
          ((input.expectedRevision !== undefined && previous.revision !== input.expectedRevision) ||
            (input.expectedExecutionDigest !== undefined &&
              previous.executionDigest !== input.expectedExecutionDigest))
        ) {
          throw new ScheduledTaskServiceError(
            'SCHEDULED_TASK_REVISION_CONFLICT',
            '任务已在其他位置更新，未覆盖不同 revision 或内容摘要的版本',
            '重新打开任务并合并修改后再保存',
          )
        }

        const timestamp = this.now()
        const source = input.definitionSource ?? previous?.source ?? 'local'
        const storedDefinition: StoredScheduledTaskDefinitionV2 = {
          schemaVersion: 2,
          id: previous?.id ?? randomUUID(),
          revision: previous ? previous.revision + 1 : 1,
          title: input.title,
          instruction: input.instruction,
          schedule: input.schedule,
          resources: input.resources,
          outputPolicy: input.outputPolicy,
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
        }
        const definition = materializeScheduledTaskDefinition(
          storedDefinition,
          context.workspacePath,
          source,
          computeScheduledTaskExecutionDigest(storedDefinition),
        )
        if (source === 'shared' && containsObviousSecret(storedDefinition)) {
          throw new ScheduledTaskServiceError(
            'SCHEDULED_TASK_INVALID',
            '共享任务定义疑似包含密码、Token 或密钥，已阻止保存',
            '移除秘密值，改为由当前设备的凭证配置提供后重试',
          )
        }
        await this.writeDefinition(context.workspacePath, definition, previous?.source)
        await this.cancelQueuedRunsForChangedDefinition(definition)

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

  async delete(input: DeleteScheduledTaskInput): Promise<ScheduledTaskOperationResult> {
    return this.enqueue(async () => {
      try {
        const context = await this.resolveWorkspace(input.workspacePath, true)
        this.assertActivationStoreAvailable()
        const definition = await this.readDefinition(context.workspacePath, input.taskId)
        if (definition.revision !== input.expectedRevision) {
          throw new ScheduledTaskServiceError(
            'SCHEDULED_TASK_REVISION_CONFLICT',
            '任务已更新，未删除较新的版本',
            '重新打开任务并确认后再删除',
          )
        }
        await this.cancelQueuedRuns(
          context.workspaceId,
          definition.id,
          '任务已删除',
          'SCHEDULED_TASK_DEFINITION_REMOVED',
          '运行历史仍会保留；需要继续执行时请重新创建任务',
        )
        await unlink(
          join(
            definitionsDirectory(context.workspacePath, definition.source),
            `${definition.id}.json`,
          ),
        )
        delete this.activationFile.activations[activationKey(context.workspaceId, definition.id)]
        await this.writeActivationFile()
        this.armScheduler()
        this.notifyChanged(context.workspacePath)
        return {
          success: true,
          task: {
            definition,
            activation: this.createActivation(definition, context.workspaceId, false),
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
        const activation =
          this.activationFile.activations[activationKey(context.workspaceId, definition.id)]
        if (definition.source === 'shared' && !isActivationRunnable(activation, definition)) {
          throw new ScheduledTaskServiceError(
            'SCHEDULED_TASK_CONFIRMATION_REQUIRED',
            '共享任务尚未在当前设备确认，不能运行',
            '检查任务内容后点击“在此设备启用”',
          )
        }
        const duplicate = this.runStore
          .list(context.workspacePath, definition.id)
          .find((run) => run.status === 'queued' || run.status === 'running')
        if (duplicate) return { success: true, run: duplicate }
        const run = await this.claimRun(
          definition,
          context.workspaceId,
          'manual',
          null,
          `manual:${context.workspaceId}:${definition.id}:${randomUUID()}`,
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

  async getWorkspaceRuntimeStatus(
    workspacePath: string,
  ): Promise<ScheduledTaskWorkspaceRuntimeStatusResult> {
    try {
      const context = await this.resolveWorkspace(workspacePath, false)
      const activations = Object.values(this.activationFile.activations).filter(
        (activation) =>
          activation.workspaceId === context.workspaceId &&
          activation.workspaceRef.path === context.workspacePath,
      )
      const queuedRuns = this.runQueue
        .map((runId) => this.runStore.get(runId))
        .filter((run) => run?.workspaceRef.path === context.workspacePath)
      const runningRun = this.currentRunId ? this.runStore.get(this.currentRunId) : undefined
      const timerDueAt =
        this.runtimeState === 'ready'
          ? (activations
              .filter((activation) => activation.enabled && activation.nextRunAt !== null)
              .map((activation) => activation.nextRunAt as number)
              .sort((left, right) => left - right)[0] ?? null)
          : null
      return {
        success: true,
        runtime: {
          scope: 'workspace',
          state: this.runtimeState,
          startedAt: this.runtimeStartedAt,
          timerDueAt,
          queuedCount: queuedRuns.length,
          runningRunId:
            runningRun?.workspaceRef.path === context.workspacePath ? runningRun.id : null,
          enabledCount: activations.filter((activation) => activation.enabled).length,
          ...(this.lastRuntimeError &&
          (this.lastRuntimeErrorWorkspacePath === null ||
            this.lastRuntimeErrorWorkspacePath === context.workspacePath)
            ? { lastError: this.lastRuntimeError }
            : {}),
          systemScheduler: 'none',
        },
      }
    } catch (error) {
      return { success: false, error: toFailure(error) }
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
        if (!isActivationRunnable(activation, definition)) {
          await this.suspendActivationForDefinitionChange(activation, definition)
          continue
        }
        if (this.runStore.hasOccurrenceConflict(activation.workspaceId, activation.taskId)) {
          await this.suspendActivationForOccurrenceConflict(activation)
          continue
        }
        const scheduledFor = latestDueOccurrence(definition, activation.nextRunAt, timestamp)
        const key = occurrenceKey(activation.workspaceId, definition.id, scheduledFor)
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
        activation.enabled = false
        activation.nextRunAt = null
        activation.suspensionReason = 'definition-conflict'
        await this.cancelQueuedRuns(activation.workspaceId, activation.taskId, '任务定义不可用')
        this.lastRuntimeError = toFailure(error)
        this.lastRuntimeErrorWorkspacePath = activation.workspaceRef.path
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
          if (!isActivationRunnable(activation, definition)) {
            await this.suspendActivationForDefinitionChange(activation, definition)
            continue
          }
          if (this.runStore.hasOccurrenceConflict(activation.workspaceId, activation.taskId)) {
            await this.suspendActivationForOccurrenceConflict(activation)
            continue
          }
          const scheduledFor = activation.nextRunAt
          const key = occurrenceKey(activation.workspaceId, definition.id, scheduledFor)
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
          const mutableActivation = activation as ScheduledTaskActivation
          mutableActivation.enabled = false
          mutableActivation.nextRunAt = null
          mutableActivation.suspensionReason = 'definition-conflict'
          await this.cancelQueuedRuns(activation.workspaceId, activation.taskId, '任务定义不可用')
          this.lastRuntimeError = toFailure(error)
          this.lastRuntimeErrorWorkspacePath = activation.workspaceRef.path
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
    if (this.runStore.hasOccurrenceConflict(workspaceId, definition.id)) {
      throw new ScheduledTaskServiceError(
        'SCHEDULED_TASK_DEFINITION_CONFLICT',
        '运行账本存在重复 occurrence，已禁止创建新的运行',
        '导出诊断并修复 userData/scheduled-tasks/runs.json 后重试',
      )
    }
    const existing = this.runStore.findOccurrence(key)
    if (existing) return existing
    const timestamp = this.now()
    const id = randomUUID()
    const run: ScheduledTaskRun = {
      schemaVersion: 2,
      id,
      occurrenceKey: key,
      taskId: definition.id,
      taskRevision: definition.revision,
      taskExecutionDigest: definition.executionDigest,
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
    let definition = await this.readDefinition(run.workspaceRef.path, run.taskId).catch(() => null)
    const activation = this.activationFile.activations[activationKey(run.workspaceId, run.taskId)]
    if (
      !definition ||
      definition.revision !== run.taskRevision ||
      definition.executionDigest !== run.taskExecutionDigest ||
      (definition.source === 'shared' && !isActivationRunnable(activation, definition))
    ) {
      await this.updateRun(run, {
        status: 'cancelled',
        currentStep: '任务定义或本机确认已变化，排队运行已取消',
        finishedAt: this.now(),
        error: {
          code: 'SCHEDULED_TASK_REVISION_CONFLICT',
          message: '运行固定的任务 revision/digest 已不可用或尚未确认',
          recovery: '检查当前任务内容并重新确认后运行',
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
    const preparedDefinition = await this.enqueue(async () => {
      const queued = this.runStore.get(run.id)
      if (!queued || queued.status !== 'queued') return null
      const latestDefinition = await this.readDefinition(run.workspaceRef.path, run.taskId).catch(
        () => null,
      )
      const latestActivation =
        this.activationFile.activations[activationKey(run.workspaceId, run.taskId)]
      if (
        !latestDefinition ||
        latestDefinition.revision !== run.taskRevision ||
        latestDefinition.executionDigest !== run.taskExecutionDigest ||
        (latestDefinition.source === 'shared' &&
          !isActivationRunnable(latestActivation, latestDefinition))
      ) {
        if (latestDefinition?.source === 'shared' && latestActivation) {
          await this.suspendActivationForDefinitionChange(latestActivation, latestDefinition)
          await this.writeActivationFile()
          this.armScheduler()
        }
        await this.updateRun(queued, {
          status: 'cancelled',
          currentStep: '执行前复验发现任务定义或本机确认已变化',
          finishedAt: this.now(),
          error: {
            code: 'SCHEDULED_TASK_REVISION_CONFLICT',
            message: '排队运行绑定的 revision/digest 已失效',
            recovery: '检查任务内容并重新确认后运行',
          },
        })
        return null
      }
      await this.updateRun(queued, {
        status: 'running',
        currentStep: 'Agent 正在执行任务',
        startedAt: this.now(),
      })
      return latestDefinition
    })
    if (!preparedDefinition) {
      this.currentRunId = null
      void this.processQueue()
      return
    }
    definition = preparedDefinition
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
      schemaVersion: 2,
      id: randomUUID(),
      occurrenceKey: key,
      taskId: definition.id,
      taskRevision: definition.revision,
      taskExecutionDigest: definition.executionDigest,
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

  private async readDefinitions(workspacePath: string): Promise<DefinitionListReadResult> {
    const migrationIssues = await this.recoverDefinitionMigrations(workspacePath)
    const blockedTaskIds = new Set(migrationIssues.flatMap((issue) => issue.taskId ?? []))
    const candidates = new Map<
      string,
      Array<{ source: ScheduledTaskDefinitionSource; filePath: string; relativePath: string }>
    >()
    const issues: ScheduledTaskDefinitionIssue[] = [...migrationIssues]
    for (const source of ['local', 'shared'] as const) {
      const directory = definitionsDirectory(workspacePath, source)
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch (error) {
        if (isMissingFileError(error)) continue
        throw error
      }
      for (const entry of entries) {
        if (!entry.name.endsWith('.json')) continue
        const relativePath = definitionRelativePath(source, entry.name)
        if (!entry.isFile()) {
          issues.push({
            relativePath,
            kind: 'invalid-definition',
            message: '任务定义必须是普通 JSON 文件，不能是目录或符号链接',
          })
          continue
        }
        let taskId: string
        try {
          taskId = parseScheduledTaskId(entry.name.slice(0, -5))
        } catch {
          issues.push({
            relativePath,
            kind: 'invalid-definition',
            message: '任务定义文件名不是合法任务 ID',
          })
          continue
        }
        const values = candidates.get(taskId) ?? []
        values.push({ source, filePath: join(directory, entry.name), relativePath })
        candidates.set(taskId, values)
      }
    }

    const definitions: ScheduledTaskDefinition[] = []
    for (const [taskId, values] of candidates) {
      if (blockedTaskIds.has(taskId)) continue
      if (values.length !== 1) {
        issues.push({
          taskId,
          relativePath: values.map((value) => value.relativePath).join(', '),
          kind: 'duplicate-definition',
          message: '同一任务同时存在本机和共享定义，已禁止调度',
        })
        continue
      }
      try {
        definitions.push(
          await this.readDefinitionFile(
            workspacePath,
            taskId,
            values[0].source,
            values[0].filePath,
          ),
        )
      } catch (error) {
        issues.push({
          taskId,
          relativePath: values[0].relativePath,
          kind: 'invalid-definition',
          message: error instanceof Error ? error.message : '任务定义不可读取',
        })
      }
    }
    return { definitions, issues }
  }

  private async readDefinition(
    workspacePath: string,
    taskId: string,
  ): Promise<ScheduledTaskDefinition> {
    parseScheduledTaskId(taskId)
    const migrationIssues = await this.recoverDefinitionMigrations(workspacePath)
    if (migrationIssues.some((issue) => issue.taskId === taskId)) {
      throw new ScheduledTaskServiceError(
        'SCHEDULED_TASK_DEFINITION_CONFLICT',
        '任务定义转换存在冲突，已禁止调度',
        '保留两份定义并手动解决转换冲突',
      )
    }
    const matches: Array<{ source: ScheduledTaskDefinitionSource; filePath: string }> = []
    for (const source of ['local', 'shared'] as const) {
      const filePath = join(definitionsDirectory(workspacePath, source), `${taskId}.json`)
      try {
        const metadata = await lstat(filePath)
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('任务定义不是普通文件')
        matches.push({ source, filePath })
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw new ScheduledTaskServiceError(
            'SCHEDULED_TASK_STORE_INVALID',
            '定时任务定义不可读取',
            '检查任务定义是否为普通 JSON 文件',
          )
        }
      }
    }
    if (matches.length > 1) {
      throw new ScheduledTaskServiceError(
        'SCHEDULED_TASK_DEFINITION_CONFLICT',
        '同一任务同时存在本机和共享定义，已禁止调度',
        '保留两份文件并手动选择正确版本后再删除另一份',
      )
    }
    if (matches.length === 0) {
      throw new ScheduledTaskServiceError(
        'SCHEDULED_TASK_NOT_FOUND',
        '定时任务不存在',
        '刷新侧栏后重试',
      )
    }
    try {
      return await this.readDefinitionFile(
        workspacePath,
        taskId,
        matches[0].source,
        matches[0].filePath,
      )
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
    previousSource?: ScheduledTaskDefinitionSource,
  ): Promise<void> {
    const directory = definitionsDirectory(workspacePath, definition.source)
    const filePath = join(directory, `${definition.id}.json`)
    const backupPath = `${filePath}.bak`
    const tempPath = `${filePath}.${process.pid}.tmp`
    try {
      await mkdir(directory, { recursive: true })
      await assertDefinitionDirectorySafe(workspacePath, directory)
      await this.ensureDefinitionExcluded(workspacePath)
      const stored = toStoredDefinition(definition)
      const serialized = `${JSON.stringify(stored, null, 2)}\n`
      if (previousSource && previousSource !== definition.source) {
        await this.convertDefinition(workspacePath, definition, previousSource, serialized)
        return
      }
      try {
        if ((await stat(filePath)).isFile()) await copyFile(filePath, backupPath)
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }
      await writeFile(tempPath, serialized, 'utf-8')
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

  private async readDefinitionFile(
    workspacePath: string,
    taskId: string,
    source: ScheduledTaskDefinitionSource,
    filePath: string,
  ): Promise<ScheduledTaskDefinition> {
    await assertDefinitionPathSafe(workspacePath, source, filePath)
    const contents = await readFile(filePath, 'utf-8')
    if (Buffer.byteLength(contents, 'utf-8') > 128 * 1024) throw new Error('任务定义超过 128 KiB')
    const stored = parseStoredScheduledTaskDefinition(JSON.parse(contents))
    if (stored.id !== taskId) throw new Error('任务定义 ID 与文件名不匹配')
    if (source === 'shared' && stored.schemaVersion !== 2) {
      throw new Error('共享任务只允许可移植的 v2 定义')
    }
    const portable = stored.schemaVersion === 1 ? toPortableStoredDefinition(stored) : stored
    return materializeScheduledTaskDefinition(
      portable,
      workspacePath,
      source,
      computeScheduledTaskExecutionDigest(portable),
    )
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
    const next = updateCclinkStudioExcludeBlock(current)
    if (next === current) return
    if (current) await copyFile(excludePath, `${excludePath}.cclink-studio.bak`)
    const tempExcludePath = `${excludePath}.${process.pid}.cclink-studio.tmp`
    await writeFile(tempExcludePath, next, 'utf-8')
    await rename(tempExcludePath, excludePath)
  }

  private async convertDefinition(
    workspacePath: string,
    definition: ScheduledTaskDefinition,
    previousSource: ScheduledTaskDefinitionSource,
    targetContents: string,
  ): Promise<void> {
    const sourcePath = join(
      definitionsDirectory(workspacePath, previousSource),
      `${definition.id}.json`,
    )
    const targetPath = join(
      definitionsDirectory(workspacePath, definition.source),
      `${definition.id}.json`,
    )
    const migrationDirectory = join(workspacePath, '.cclink-studio', 'scheduled-task-migrations')
    const journalPath = join(migrationDirectory, `${definition.id}.json`)
    const backupPath = join(migrationDirectory, `${definition.id}.source.bak`)
    await assertDefinitionPathSafe(workspacePath, previousSource, sourcePath)
    await assertDefinitionDirectorySafe(workspacePath, dirname(targetPath))
    const sourceContents = await readFile(sourcePath, 'utf-8')
    const workspaceId = await this.workspaceStateService.getLocalProjectId(workspacePath)
    if (!workspaceId) throw new Error('工作空间身份不可用')
    const journal: DefinitionMigrationJournal = {
      schemaVersion: 1,
      operationId: randomUUID(),
      workspaceId,
      taskId: definition.id,
      from: previousSource,
      to: definition.source,
      sourceRelativePath: definitionRelativePath(previousSource, `${definition.id}.json`),
      sourceBackupRelativePath: `.cclink-studio/scheduled-task-migrations/${definition.id}.source.bak`,
      targetRelativePath: definitionRelativePath(definition.source, `${definition.id}.json`),
      sourceRevision: definition.revision - 1,
      sourceFileSha256: hashContents(sourceContents),
      targetRevision: definition.revision,
      targetFileSha256: hashContents(targetContents),
      phase: 'prepared',
      createdAt: this.now(),
    }
    await mkdir(migrationDirectory, { recursive: true })
    await assertDefinitionDirectorySafe(workspacePath, migrationDirectory)
    await writeFile(backupPath, sourceContents, { encoding: 'utf-8', mode: 0o600 })
    await writeJsonAtomically(journalPath, journal)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeTextAtomically(targetPath, targetContents)
    journal.phase = 'target-written'
    await writeJsonAtomically(journalPath, journal)
    await unlink(sourcePath)
    journal.phase = 'source-removed'
    await writeJsonAtomically(journalPath, journal)
    await unlink(backupPath).catch((error) => {
      if (!isMissingFileError(error)) throw error
    })
    await unlink(journalPath)
  }

  private async recoverDefinitionMigrations(
    workspacePath: string,
  ): Promise<ScheduledTaskDefinitionIssue[]> {
    const directory = join(workspacePath, '.cclink-studio', 'scheduled-task-migrations')
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (isMissingFileError(error)) return []
      throw error
    }
    const issues: ScheduledTaskDefinitionIssue[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const journalPath = join(directory, entry.name)
      let journal: DefinitionMigrationJournal
      try {
        journal = parseDefinitionMigrationJournal(JSON.parse(await readFile(journalPath, 'utf-8')))
      } catch (error) {
        issues.push({
          relativePath: `.cclink-studio/scheduled-task-migrations/${entry.name}`,
          kind: 'migration-conflict',
          message: error instanceof Error ? error.message : '转换日志损坏',
        })
        continue
      }
      const sourcePath = join(workspacePath, journal.sourceRelativePath)
      const targetPath = join(workspacePath, journal.targetRelativePath)
      const sourceContents = await readOptionalRegularFile(sourcePath)
      const targetContents = await readOptionalRegularFile(targetPath)
      const sourceMatches =
        sourceContents !== null && hashContents(sourceContents) === journal.sourceFileSha256
      const targetMatches =
        targetContents !== null && hashContents(targetContents) === journal.targetFileSha256

      if (
        sourceContents !== null &&
        targetContents === null &&
        sourceMatches &&
        journal.phase === 'prepared'
      ) {
        await cleanupConversionTemps(targetPath)
        await this.cleanupMigrationJournal(workspacePath, journal, journalPath)
        continue
      }
      if (sourceContents !== null && targetContents !== null && sourceMatches && targetMatches) {
        await unlink(sourcePath)
        await this.cleanupMigrationJournal(workspacePath, journal, journalPath)
        continue
      }
      if (sourceContents === null && targetContents !== null && targetMatches) {
        await cleanupConversionTemps(targetPath)
        await this.cleanupMigrationJournal(workspacePath, journal, journalPath)
        continue
      }
      issues.push({
        taskId: journal.taskId,
        relativePath: `.cclink-studio/scheduled-task-migrations/${entry.name}`,
        kind: 'migration-conflict',
        message: '转换源或目标 hash 不匹配，已保留两份文件并禁止调度',
      })
    }
    return issues
  }

  private async cleanupMigrationJournal(
    workspacePath: string,
    journal: DefinitionMigrationJournal,
    journalPath: string,
  ): Promise<void> {
    await cleanupConversionTemps(join(workspacePath, journal.targetRelativePath))
    await unlink(join(workspacePath, journal.sourceBackupRelativePath)).catch((error) => {
      if (!isMissingFileError(error)) throw error
    })
    await unlink(journalPath)
  }

  private async reconcileDefinitionActivations(
    workspaceId: string,
    definitions: ScheduledTaskDefinition[],
    issues: ScheduledTaskDefinitionIssue[],
  ): Promise<void> {
    let changed = false
    const byId = new Map(definitions.map((definition) => [definition.id, definition]))
    const conflictingIds = new Set(issues.flatMap((issue) => issue.taskId ?? []))
    for (const activation of Object.values(this.activationFile.activations)) {
      if (activation.workspaceId !== workspaceId) continue
      const definition = byId.get(activation.taskId)
      if (!definition || conflictingIds.has(activation.taskId)) {
        if (!definition && !conflictingIds.has(activation.taskId)) {
          issues.push({
            taskId: activation.taskId,
            relativePath: `(task ${activation.taskId})`,
            kind: 'definition-removed',
            message: '任务定义已从项目删除；本机启用已失效，运行历史仍保留',
          })
        }
        const suspensionReason =
          !definition && !conflictingIds.has(activation.taskId)
            ? 'definition-removed'
            : 'definition-conflict'
        if (
          activation.enabled ||
          activation.nextRunAt !== null ||
          activation.suspensionReason !== suspensionReason
        ) {
          activation.enabled = false
          activation.nextRunAt = null
          activation.suspensionReason = suspensionReason
          changed = true
          await this.cancelQueuedRuns(
            activation.workspaceId,
            activation.taskId,
            '任务定义已删除或冲突',
            suspensionReason === 'definition-removed'
              ? 'SCHEDULED_TASK_DEFINITION_REMOVED'
              : 'SCHEDULED_TASK_DEFINITION_CONFLICT',
            suspensionReason === 'definition-removed'
              ? '运行历史仍会保留；需要继续执行时请恢复定义并重新确认'
              : '解决任务定义冲突后重新确认',
          )
        }
        continue
      }
      if (definition.source === 'shared' && !isActivationRunnable(activation, definition)) {
        if (
          activation.enabled ||
          activation.nextRunAt !== null ||
          activation.suspensionReason !== 'definition-changed'
        ) {
          activation.enabled = false
          activation.nextRunAt = null
          activation.suspensionReason = 'definition-changed'
          changed = true
          await this.cancelQueuedRuns(
            activation.workspaceId,
            activation.taskId,
            '共享任务定义已变化',
          )
        }
      }
    }
    if (changed) {
      await this.writeActivationFile()
      this.armScheduler()
    }
  }

  private async cancelQueuedRunsForChangedDefinition(
    definition: ScheduledTaskDefinition,
  ): Promise<void> {
    const activation = Object.values(this.activationFile.activations).find(
      (candidate) =>
        candidate.taskId === definition.id &&
        candidate.workspaceRef.path === definition.workspaceRef.path,
    )
    if (!activation) return
    await this.cancelQueuedRuns(
      activation.workspaceId,
      definition.id,
      '任务定义已更新',
      'SCHEDULED_TASK_DEFINITION_CHANGED',
      '检查新版本内容并在此设备重新确认',
    )
  }

  private async cancelQueuedRuns(
    workspaceId: string,
    taskId: string,
    reason: string,
    code: ScheduledTaskErrorCode = 'SCHEDULED_TASK_REVISION_CONFLICT',
    recovery = '检查任务内容并重新确认后运行',
  ): Promise<void> {
    const queuedIds = this.runQueue.filter((runId) => {
      const run = this.runStore.get(runId)
      return run?.workspaceId === workspaceId && run.taskId === taskId && run.status === 'queued'
    })
    for (const runId of queuedIds) {
      const index = this.runQueue.indexOf(runId)
      if (index >= 0) this.runQueue.splice(index, 1)
      const run = this.runStore.get(runId)
      if (!run || run.status !== 'queued') continue
      await this.updateRun(run, {
        status: 'cancelled',
        currentStep: `${reason}，排队运行已取消`,
        finishedAt: this.now(),
        error: {
          code,
          message: reason,
          recovery,
        },
      })
    }
  }

  private async suspendActivationForDefinitionChange(
    activation: ScheduledTaskActivation,
    definition: ScheduledTaskDefinition,
  ): Promise<void> {
    activation.enabled = false
    activation.nextRunAt = null
    activation.suspensionReason = 'definition-changed'
    await this.cancelQueuedRuns(
      activation.workspaceId,
      definition.id,
      '共享任务定义已变化',
      'SCHEDULED_TASK_DEFINITION_CHANGED',
      '检查新版本内容并在此设备重新确认',
    )
  }

  private async suspendActivationForOccurrenceConflict(
    activation: ScheduledTaskActivation,
  ): Promise<void> {
    activation.enabled = false
    activation.nextRunAt = null
    activation.suspensionReason = 'definition-conflict'
    await this.cancelQueuedRuns(
      activation.workspaceId,
      activation.taskId,
      '运行账本 occurrence 冲突',
      'SCHEDULED_TASK_RUN_LEDGER_CONFLICT',
      '修复运行账本冲突后再重新启用任务',
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
      confirmedTaskRevision: definition.source === 'shared' && enabled ? definition.revision : null,
      confirmedExecutionDigest:
        definition.source === 'shared' && enabled ? definition.executionDigest : null,
      suspensionReason: null,
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

function definitionsDirectory(
  workspacePath: string,
  source: ScheduledTaskDefinitionSource,
): string {
  return source === 'local'
    ? join(workspacePath, '.cclink-studio', 'scheduled-tasks')
    : join(workspacePath, '.cclink-studio', 'shared', 'scheduled-tasks')
}

function definitionRelativePath(source: ScheduledTaskDefinitionSource, fileName: string): string {
  return source === 'local'
    ? `.cclink-studio/scheduled-tasks/${fileName}`
    : `.cclink-studio/shared/scheduled-tasks/${fileName}`
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const root = resolve(rootPath)
  const candidate = resolve(candidatePath)
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

async function assertDefinitionDirectorySafe(
  workspacePath: string,
  directory: string,
): Promise<void> {
  const canonicalWorkspace = await realpath(workspacePath)
  const canonicalDirectory = await realpath(directory)
  if (!isPathWithin(canonicalWorkspace, canonicalDirectory)) {
    throw new Error('任务定义目录通过符号链接逃逸工作空间')
  }
}

async function assertDefinitionPathSafe(
  workspacePath: string,
  source: ScheduledTaskDefinitionSource,
  filePath: string,
): Promise<void> {
  const directory = definitionsDirectory(workspacePath, source)
  await assertDefinitionDirectorySafe(workspacePath, directory)
  const metadata = await lstat(filePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('任务定义不是普通文件')
  const canonicalDirectory = await realpath(directory)
  const canonicalFile = await realpath(filePath)
  if (!isPathWithin(canonicalDirectory, canonicalFile)) {
    throw new Error('任务定义通过符号链接逃逸定义目录')
  }
}

function activationKey(workspaceId: string, taskId: string): string {
  return `${workspaceId}:${taskId}`
}

function occurrenceKey(workspaceId: string, taskId: string, scheduledFor: number): string {
  return `scheduled:${workspaceId}:${taskId}:${scheduledFor}`
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

function parseActivationFile(value: unknown): { file: ActivationFile; migrated: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('本机启用状态不是对象')
  }
  const input = value as { schemaVersion?: unknown; activations?: unknown }
  assertExactKeys(input as Record<string, unknown>, ['schemaVersion', 'activations'])
  if (
    (input.schemaVersion !== 1 && input.schemaVersion !== 2) ||
    !input.activations ||
    typeof input.activations !== 'object'
  ) {
    throw new Error('本机启用状态版本无效')
  }
  const migrated = input.schemaVersion === 1
  const activations: Record<string, ScheduledTaskActivation> = {}
  for (const [key, raw] of Object.entries(input.activations as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('本机启用记录无效')
    }
    const rawActivation = raw as Record<string, unknown>
    assertExactKeys(rawActivation, [
      'taskId',
      'workspaceId',
      'workspaceRef',
      'enabled',
      ...(migrated
        ? []
        : ['confirmedTaskRevision', 'confirmedExecutionDigest', 'suspensionReason']),
      'catchUpPolicy',
      'lastEvaluatedAt',
      'nextRunAt',
    ])
    const activation = {
      ...rawActivation,
      confirmedTaskRevision: migrated ? null : rawActivation.confirmedTaskRevision,
      confirmedExecutionDigest: migrated ? null : rawActivation.confirmedExecutionDigest,
      suspensionReason: migrated ? null : rawActivation.suspensionReason,
    } as unknown as ScheduledTaskActivation
    const workspaceRef = activation.workspaceRef as unknown as Record<string, unknown>
    const catchUpPolicy = activation.catchUpPolicy as unknown as Record<string, unknown>
    assertExactKeys(workspaceRef, ['kind', 'path'])
    assertExactKeys(catchUpPolicy, ['mode', 'windowMinutes'])
    if (
      typeof activation.workspaceId !== 'string' ||
      activation.workspaceRef?.kind !== 'local' ||
      typeof activation.workspaceRef.path !== 'string' ||
      typeof activation.enabled !== 'boolean' ||
      (activation.confirmedTaskRevision !== null &&
        (typeof activation.confirmedTaskRevision !== 'number' ||
          !Number.isSafeInteger(activation.confirmedTaskRevision))) ||
      (activation.confirmedExecutionDigest !== null &&
        (typeof activation.confirmedExecutionDigest !== 'string' ||
          !/^[0-9a-f]{64}$/i.test(activation.confirmedExecutionDigest))) ||
      (activation.suspensionReason !== null &&
        activation.suspensionReason !== 'definition-changed' &&
        activation.suspensionReason !== 'definition-removed' &&
        activation.suspensionReason !== 'definition-conflict' &&
        activation.suspensionReason !== 'migration-conflict') ||
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
  return { file: { schemaVersion: 2, activations }, migrated }
}

function isActivationRunnable(
  activation: ScheduledTaskActivation | undefined,
  definition: ScheduledTaskDefinition,
): boolean {
  if (!activation?.enabled || activation.suspensionReason !== null) return false
  if (definition.source === 'local') return true
  return (
    activation.confirmedTaskRevision === definition.revision &&
    activation.confirmedExecutionDigest === definition.executionDigest
  )
}

function toStoredDefinition(definition: ScheduledTaskDefinition): StoredScheduledTaskDefinitionV2 {
  return {
    schemaVersion: 2,
    id: definition.id,
    revision: definition.revision,
    title: definition.title,
    instruction: definition.instruction,
    schedule: definition.schedule,
    resources: definition.resources,
    outputPolicy: definition.outputPolicy,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  }
}

function toPortableStoredDefinition(
  definition: ReturnType<typeof parseStoredScheduledTaskDefinition>,
): StoredScheduledTaskDefinitionV2 {
  return {
    schemaVersion: 2,
    id: definition.id,
    revision: definition.revision,
    title: definition.title,
    instruction: definition.instruction,
    schedule: definition.schedule,
    resources: definition.resources,
    outputPolicy: definition.outputPolicy,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  }
}

function hashContents(contents: string): string {
  return createHash('sha256').update(contents, 'utf8').digest('hex')
}

function containsObviousSecret(definition: StoredScheduledTaskDefinitionV2): boolean {
  const candidate = JSON.stringify({
    instruction: definition.instruction,
    resources: definition.resources,
    outputPolicy: definition.outputPolicy,
  })
  return containsObviousSecretText(candidate)
}

async function writeTextAtomically(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, contents, 'utf-8')
  await rename(tempPath, filePath)
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function readOptionalRegularFile(filePath: string): Promise<string | null> {
  try {
    const metadata = await lstat(filePath)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('转换文件不是普通文件')
    return await readFile(filePath, 'utf-8')
  } catch (error) {
    if (isMissingFileError(error)) return null
    throw error
  }
}

async function cleanupConversionTemps(targetPath: string): Promise<void> {
  let entries
  try {
    entries = await readdir(dirname(targetPath), { withFileTypes: true })
  } catch (error) {
    if (isMissingFileError(error)) return
    throw error
  }
  const prefix = `${basename(targetPath)}.`
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.tmp')) continue
    await unlink(join(dirname(targetPath), entry.name))
  }
}

function parseDefinitionMigrationJournal(value: unknown): DefinitionMigrationJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('任务转换日志不是对象')
  }
  const journal = value as DefinitionMigrationJournal
  assertExactKeys(journal as unknown as Record<string, unknown>, [
    'schemaVersion',
    'operationId',
    'workspaceId',
    'taskId',
    'from',
    'to',
    'sourceRelativePath',
    'sourceBackupRelativePath',
    'targetRelativePath',
    'sourceRevision',
    'sourceFileSha256',
    'targetRevision',
    'targetFileSha256',
    'phase',
    'createdAt',
  ])
  parseScheduledTaskId(journal.taskId)
  const expectedSource = definitionRelativePath(journal.from, `${journal.taskId}.json`)
  const expectedTarget = definitionRelativePath(journal.to, `${journal.taskId}.json`)
  const expectedBackup = `.cclink-studio/scheduled-task-migrations/${journal.taskId}.source.bak`
  if (
    journal.schemaVersion !== 1 ||
    typeof journal.operationId !== 'string' ||
    typeof journal.workspaceId !== 'string' ||
    (journal.from !== 'local' && journal.from !== 'shared') ||
    (journal.to !== 'local' && journal.to !== 'shared') ||
    journal.from === journal.to ||
    journal.sourceRelativePath !== expectedSource ||
    journal.targetRelativePath !== expectedTarget ||
    journal.sourceBackupRelativePath !== expectedBackup ||
    typeof journal.sourceFileSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(journal.sourceFileSha256) ||
    typeof journal.targetFileSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(journal.targetFileSha256) ||
    !Number.isSafeInteger(journal.sourceRevision) ||
    !Number.isSafeInteger(journal.targetRevision) ||
    !Number.isSafeInteger(journal.createdAt) ||
    (journal.phase !== 'prepared' &&
      journal.phase !== 'target-written' &&
      journal.phase !== 'source-removed')
  ) {
    throw new Error('任务转换日志字段无效')
  }
  return journal
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
