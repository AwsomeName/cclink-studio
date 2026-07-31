import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ScheduledTaskRun } from '../../shared/scheduled-task/scheduled-task-types'

interface RunLedgerFile {
  schemaVersion: 1
  runs: ScheduledTaskRun[]
}

const MAX_RUNS = 500

export class ScheduledTaskRunStore {
  private readonly backupPath: string
  private readonly tempPath: string
  private ledger: RunLedgerFile = { schemaVersion: 1, runs: [] }
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {
    this.backupPath = `${filePath}.bak`
    this.tempPath = `${filePath}.${process.pid}.tmp`
  }

  async load(now: number): Promise<void> {
    try {
      this.ledger = parseRunLedger(JSON.parse(await readFile(this.filePath, 'utf-8')))
    } catch (error) {
      if (!isMissingFileError(error)) throw error
      this.ledger = { schemaVersion: 1, runs: [] }
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

  async put(run: ScheduledTaskRun): Promise<void> {
    const index = this.ledger.runs.findIndex((candidate) => candidate.id === run.id)
    if (index === -1) this.ledger.runs.push(run)
    else this.ledger.runs[index] = run
    this.ledger.runs = this.ledger.runs
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_RUNS)
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
}

function parseRunLedger(value: unknown): RunLedgerFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('运行账本不是对象')
  }
  const input = value as Partial<RunLedgerFile>
  if (input.schemaVersion !== 1 || !Array.isArray(input.runs)) {
    throw new Error('运行账本版本无效')
  }
  return { schemaVersion: 1, runs: input.runs as ScheduledTaskRun[] }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
