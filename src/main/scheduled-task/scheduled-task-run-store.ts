import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ScheduledTaskRun } from '../../shared/scheduled-task/scheduled-task-types'

interface RunLedgerFile {
  schemaVersion: 2
  runs: ScheduledTaskRun[]
}

const MAX_RUNS = 500

export class ScheduledTaskRunStore {
  private readonly backupPath: string
  private readonly tempPath: string
  private ledger: RunLedgerFile = { schemaVersion: 2, runs: [] }
  private readonly occurrenceConflictTaskKeys = new Set<string>()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {
    this.backupPath = `${filePath}.bak`
    this.tempPath = `${filePath}.${process.pid}.tmp`
  }

  async load(now: number): Promise<void> {
    try {
      const parsed = parseRunLedger(JSON.parse(await readFile(this.filePath, 'utf-8')))
      this.ledger = parsed.ledger
      this.rebuildOccurrenceConflicts()
      if (parsed.migrated) await this.flush()
    } catch (error) {
      if (!isMissingFileError(error)) throw error
      this.ledger = { schemaVersion: 2, runs: [] }
    }
    let changed = false
    this.ledger.runs = this.ledger.runs.map((run) => {
      if (run.status !== 'queued' && run.status !== 'running') return run
      changed = true
      return {
        ...run,
        status: 'interrupted',
        currentStep: '上次 App 退出或异常终止，运行已中断',
        finishedAt: now,
        error: {
          code: 'SCHEDULED_TASK_STOPPING',
          message: '上次运行未正常收束',
          recovery: '确认输入与输出后手动重试',
        },
      }
    })
    if (changed) await this.flush()
  }

  list(workspacePath?: string, taskId?: string): ScheduledTaskRun[] {
    return this.ledger.runs
      .filter(
        (run) =>
          (!workspacePath || run.workspaceRef.path === workspacePath) &&
          (!taskId || run.taskId === taskId),
      )
      .sort((left, right) => right.createdAt - left.createdAt)
  }

  get(runId: string): ScheduledTaskRun | null {
    return this.ledger.runs.find((run) => run.id === runId) ?? null
  }

  findOccurrence(occurrenceKey: string): ScheduledTaskRun | null {
    return this.ledger.runs.find((run) => run.occurrenceKey === occurrenceKey) ?? null
  }

  hasOccurrenceConflict(workspaceId: string, taskId: string): boolean {
    return this.occurrenceConflictTaskKeys.has(taskKey(workspaceId, taskId))
  }

  async put(run: ScheduledTaskRun): Promise<void> {
    const index = this.ledger.runs.findIndex((candidate) => candidate.id === run.id)
    if (index === -1) this.ledger.runs.push(run)
    else this.ledger.runs[index] = run
    this.ledger.runs = this.ledger.runs
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_RUNS)
    this.rebuildOccurrenceConflicts()
    await this.flush()
  }

  async flush(): Promise<void> {
    const pending = this.writeQueue.then(
      () => this.flushNow(),
      () => this.flushNow(),
    )
    this.writeQueue = pending.catch(() => {})
    await pending
  }

  private async flushNow(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    try {
      if ((await stat(this.filePath)).isFile()) await copyFile(this.filePath, this.backupPath)
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
    await writeFile(this.tempPath, `${JSON.stringify(this.ledger, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    })
    await rename(this.tempPath, this.filePath)
  }

  private rebuildOccurrenceConflicts(): void {
    this.occurrenceConflictTaskKeys.clear()
    const owners = new Map<string, ScheduledTaskRun>()
    for (const run of this.ledger.runs) {
      const previous = owners.get(run.occurrenceKey)
      if (previous && previous.id !== run.id) {
        this.occurrenceConflictTaskKeys.add(taskKey(run.workspaceId, run.taskId))
        this.occurrenceConflictTaskKeys.add(taskKey(previous.workspaceId, previous.taskId))
      } else {
        owners.set(run.occurrenceKey, run)
      }
    }
  }
}

function parseRunLedger(value: unknown): { ledger: RunLedgerFile; migrated: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('运行账本不是对象')
  }
  const input = value as { schemaVersion?: unknown; runs?: unknown }
  if ((input.schemaVersion !== 1 && input.schemaVersion !== 2) || !Array.isArray(input.runs)) {
    throw new Error('运行账本版本无效')
  }
  const migrated = input.schemaVersion === 1
  return {
    ledger: {
      schemaVersion: 2,
      runs: input.runs.map((run) => parseRun(run, migrated)),
    },
    migrated,
  }
}

function parseRun(value: unknown, migrateV1: boolean): ScheduledTaskRun {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('运行记录不是对象')
  }
  const run = value as Record<string, unknown>
  assertAllowedKeys(run, [
    'schemaVersion',
    'id',
    'occurrenceKey',
    'taskId',
    'taskRevision',
    ...(migrateV1 ? [] : ['taskExecutionDigest']),
    'workspaceId',
    'workspaceRef',
    'conversationId',
    'trigger',
    'scheduledFor',
    'status',
    'currentStep',
    'createdAt',
    'startedAt',
    'finishedAt',
    'artifact',
    'error',
  ])
  if (run.schemaVersion !== (migrateV1 ? 1 : 2)) throw new Error('运行记录版本无效')
  const id = requireString(run.id, '运行 ID 无效')
  const taskId = requireString(run.taskId, '任务 ID 无效')
  const workspaceId = requireString(run.workspaceId, '工作空间 ID 无效')
  const taskRevision = requireInteger(run.taskRevision, '任务 revision 无效')
  const scheduledFor =
    run.scheduledFor === null ? null : requireInteger(run.scheduledFor, '计划时间无效')
  const trigger = requireEnum(
    run.trigger,
    ['manual', 'scheduled', 'catch-up'] as const,
    '运行触发类型无效',
  )
  const status = requireEnum(
    run.status,
    [
      'queued',
      'running',
      'completed',
      'failed',
      'cancelled',
      'interrupted',
      'missed',
      'skipped',
    ] as const,
    '运行状态无效',
  )
  const workspaceRef = requireRecord(run.workspaceRef, '运行工作空间引用无效')
  assertAllowedKeys(workspaceRef, ['kind', 'path'])
  if (workspaceRef.kind !== 'local') throw new Error('运行工作空间引用无效')
  const artifact = run.artifact === undefined ? undefined : parseArtifact(run.artifact)
  const error = run.error === undefined ? undefined : parseFailure(run.error)
  const migratedOccurrenceKey =
    trigger === 'manual'
      ? `manual:${workspaceId}:${taskId}:${id}`
      : scheduledFor === null
        ? `legacy:${workspaceId}:${taskId}:${id}`
        : `scheduled:${workspaceId}:${taskId}:${scheduledFor}`
  const taskExecutionDigest =
    typeof run.taskExecutionDigest === 'string' && run.taskExecutionDigest
      ? run.taskExecutionDigest
      : `legacy-revision:${taskRevision}`
  return {
    schemaVersion: 2,
    id,
    occurrenceKey: migrateV1
      ? migratedOccurrenceKey
      : requireString(run.occurrenceKey, '运行 occurrence key 无效'),
    taskId,
    taskRevision,
    taskExecutionDigest,
    workspaceId,
    workspaceRef: {
      kind: 'local',
      path: requireString(workspaceRef.path, '运行工作空间路径无效'),
    },
    conversationId: requireStringAllowEmpty(run.conversationId, '运行会话 ID 无效'),
    trigger,
    scheduledFor,
    status,
    currentStep: requireString(run.currentStep, '运行步骤无效'),
    createdAt: requireInteger(run.createdAt, '运行创建时间无效'),
    startedAt: parseNullableInteger(run.startedAt, '运行开始时间无效'),
    finishedAt: parseNullableInteger(run.finishedAt, '运行结束时间无效'),
    ...(artifact ? { artifact } : {}),
    ...(error ? { error } : {}),
  }
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) throw new Error(message)
  return value
}

function requireStringAllowEmpty(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  return value
}

function requireInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(message)
  return value
}

function parseNullableInteger(value: unknown, message: string): number | null {
  return value === null ? null : requireInteger(value, message)
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[]): void {
  const keys = new Set(allowed)
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('运行记录包含未知字段')
}

function requireEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  message: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error(message)
  return value as T[number]
}

function parseArtifact(value: unknown): NonNullable<ScheduledTaskRun['artifact']> {
  const artifact = requireRecord(value, '运行产物无效')
  assertAllowedKeys(artifact, ['relativePath', 'bytes', 'sha256'])
  return {
    relativePath: requireString(artifact.relativePath, '运行产物路径无效'),
    bytes: requireInteger(artifact.bytes, '运行产物大小无效'),
    sha256: requireString(artifact.sha256, '运行产物摘要无效'),
  }
}

function parseFailure(value: unknown): NonNullable<ScheduledTaskRun['error']> {
  const failure = requireRecord(value, '运行错误无效')
  assertAllowedKeys(failure, ['code', 'message', 'recovery'])
  const recovery =
    failure.recovery === undefined ? undefined : requireString(failure.recovery, '运行恢复建议无效')
  return {
    code: requireString(failure.code, '运行错误码无效') as NonNullable<
      ScheduledTaskRun['error']
    >['code'],
    message: requireString(failure.message, '运行错误消息无效'),
    ...(recovery ? { recovery } : {}),
  }
}

function taskKey(workspaceId: string, taskId: string): string {
  return `${workspaceId}\0${taskId}`
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
