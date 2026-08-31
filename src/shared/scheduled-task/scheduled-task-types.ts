import type { LocalWorkspaceRef } from '../workspace-ref'

export type ScheduledTaskErrorCode =
  | 'SCHEDULED_TASK_INVALID'
  | 'SCHEDULED_TASK_NOT_FOUND'
  | 'SCHEDULED_TASK_REVISION_CONFLICT'
  | 'SCHEDULED_TASK_DEFINITION_CONFLICT'
  | 'SCHEDULED_TASK_DEFINITION_CHANGED'
  | 'SCHEDULED_TASK_DEFINITION_REMOVED'
  | 'SCHEDULED_TASK_RUN_LEDGER_CONFLICT'
  | 'SCHEDULED_TASK_CONFIRMATION_REQUIRED'
  | 'SCHEDULED_TASK_WORKSPACE_UNAVAILABLE'
  | 'SCHEDULED_TASK_WORKSPACE_READ_ONLY'
  | 'SCHEDULED_TASK_STORE_INVALID'
  | 'SCHEDULED_TASK_WRITE_FAILED'
  | 'SCHEDULED_TASK_AGENT_UNAVAILABLE'
  | 'SCHEDULED_TASK_ALREADY_RUNNING'
  | 'SCHEDULED_TASK_RUN_NOT_FOUND'
  | 'SCHEDULED_TASK_OUTPUT_EXISTS'
  | 'SCHEDULED_TASK_OUTPUT_INVALID'
  | 'SCHEDULED_TASK_STOPPING'

export interface ScheduledTaskFailure {
  code: ScheduledTaskErrorCode
  message: string
  recovery?: string
}

export type ScheduledTaskSchedule =
  | {
      kind: 'once'
      runAt: number
      timezone: string
    }
  | {
      kind: 'daily'
      time: string
      timezone: string
    }
  | {
      kind: 'weekdays'
      time: string
      timezone: string
    }
  | {
      kind: 'weekly'
      time: string
      weekdays: number[]
      timezone: string
    }

export type ScheduledTaskResourceRef =
  | { kind: 'workspace' }
  | { kind: 'file' | 'directory'; path: string }

export interface ScheduledTaskOutputPolicy {
  directory: string
  fileNameTemplate: string
  mode: 'create-only'
}

export interface ScheduledTaskDefinition {
  schemaVersion: 2
  id: string
  workspaceRef: LocalWorkspaceRef
  source: ScheduledTaskDefinitionSource
  executionDigest: string
  revision: number
  title: string
  instruction: string
  schedule: ScheduledTaskSchedule
  resources: ScheduledTaskResourceRef[]
  outputPolicy: ScheduledTaskOutputPolicy
  createdAt: number
  updatedAt: number
}

export type ScheduledTaskDefinitionSource = 'local' | 'shared'

/** Git 可同步的 v2 磁盘记录；工作空间绝对路径只在读取时注入运行时定义。 */
export interface StoredScheduledTaskDefinitionV2 {
  schemaVersion: 2
  id: string
  revision: number
  title: string
  instruction: string
  schedule: ScheduledTaskSchedule
  resources: ScheduledTaskResourceRef[]
  outputPolicy: ScheduledTaskOutputPolicy
  createdAt: number
  updatedAt: number
}

export interface ScheduledTaskActivation {
  taskId: string
  workspaceId: string
  workspaceRef: LocalWorkspaceRef
  enabled: boolean
  confirmedTaskRevision: number | null
  confirmedExecutionDigest: string | null
  suspensionReason:
    | 'definition-changed'
    | 'definition-removed'
    | 'definition-conflict'
    | 'migration-conflict'
    | null
  catchUpPolicy: {
    mode: 'latest-within-window'
    windowMinutes: 30
  }
  lastEvaluatedAt: number | null
  nextRunAt: number | null
}

export interface ScheduledTaskSnapshot {
  definition: ScheduledTaskDefinition
  activation: ScheduledTaskActivation
  latestRun?: ScheduledTaskRun
}

export type ScheduledTaskRunTrigger = 'manual' | 'scheduled' | 'catch-up'

export type ScheduledTaskRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'missed'
  | 'skipped'

export interface ScheduledTaskArtifact {
  relativePath: string
  bytes: number
  sha256: string
}

export interface ScheduledTaskRun {
  schemaVersion: 2
  id: string
  occurrenceKey: string
  taskId: string
  taskRevision: number
  taskExecutionDigest: string
  workspaceId: string
  workspaceRef: LocalWorkspaceRef
  conversationId: string
  trigger: ScheduledTaskRunTrigger
  scheduledFor: number | null
  status: ScheduledTaskRunStatus
  currentStep: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  artifact?: ScheduledTaskArtifact
  error?: ScheduledTaskFailure
}

export interface SaveScheduledTaskInput {
  workspacePath: string
  taskId?: string
  expectedRevision?: number
  expectedExecutionDigest?: string
  title: string
  instruction: string
  schedule: ScheduledTaskSchedule
  resources: ScheduledTaskResourceRef[]
  outputPolicy: ScheduledTaskOutputPolicy
  definitionSource?: ScheduledTaskDefinitionSource
  enable: boolean
}

export interface ScheduledTaskDefinitionIssue {
  taskId?: string
  relativePath: string
  kind: 'invalid-definition' | 'duplicate-definition' | 'migration-conflict' | 'definition-removed'
  message: string
}

export interface SetScheduledTaskEnabledInput {
  workspacePath: string
  taskId: string
  enabled: boolean
}

export interface DeleteScheduledTaskInput {
  workspacePath: string
  taskId: string
  expectedRevision: number
}

export interface RunScheduledTaskInput {
  workspacePath: string
  taskId: string
}

export interface CancelScheduledTaskRunInput {
  workspacePath: string
  runId: string
}

export interface ScheduledTaskOperationResult {
  success: boolean
  task?: ScheduledTaskSnapshot
  error?: ScheduledTaskFailure
}

export interface ScheduledTaskListResult {
  success: boolean
  tasks: ScheduledTaskSnapshot[]
  issues?: ScheduledTaskDefinitionIssue[]
  error?: ScheduledTaskFailure
}

export interface ScheduledTaskRunResult {
  success: boolean
  run?: ScheduledTaskRun
  error?: ScheduledTaskFailure
}

export interface ScheduledTaskRunListResult {
  success: boolean
  runs: ScheduledTaskRun[]
  error?: ScheduledTaskFailure
}

export interface ScheduledTaskRuntimeStatus {
  state: 'stopped' | 'ready' | 'degraded' | 'stopping'
  startedAt: number | null
  timerDueAt: number | null
  queuedCount: number
  runningRunId: string | null
  enabledCount: number
  lastError?: ScheduledTaskFailure
  systemScheduler: 'none'
}

/** Agent 查询使用的当前工作空间投影；由 ScheduledTaskService 即时计算，不保存副本。 */
export interface ScheduledTaskWorkspaceRuntimeStatus extends ScheduledTaskRuntimeStatus {
  scope: 'workspace'
}

export interface ScheduledTaskWorkspaceRuntimeStatusResult {
  success: boolean
  runtime?: ScheduledTaskWorkspaceRuntimeStatus
  error?: ScheduledTaskFailure
}

export interface ScheduledTasksApiContract {
  list(workspacePath: string): Promise<ScheduledTaskListResult>
  get(workspacePath: string, taskId: string): Promise<ScheduledTaskOperationResult>
  save(input: SaveScheduledTaskInput): Promise<ScheduledTaskOperationResult>
  delete(input: DeleteScheduledTaskInput): Promise<ScheduledTaskOperationResult>
  setEnabled(input: SetScheduledTaskEnabledInput): Promise<ScheduledTaskOperationResult>
  runNow(input: RunScheduledTaskInput): Promise<ScheduledTaskRunResult>
  cancelRun(input: CancelScheduledTaskRunInput): Promise<ScheduledTaskRunResult>
  listRuns(workspacePath: string, taskId: string): Promise<ScheduledTaskRunListResult>
  getRuntimeStatus(): Promise<ScheduledTaskRuntimeStatus>
  onChanged(callback: (workspacePath: string) => void): () => void
}
