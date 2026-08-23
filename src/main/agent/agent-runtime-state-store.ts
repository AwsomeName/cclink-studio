import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentRuntimeRunRecord, AgentRuntimeRunStatus } from '../../shared/agent-protocol'

const SCHEMA_VERSION = 1
const MAX_RUNS = 500

export interface TrustedAgentSessionRecord {
  conversationId: string
  sessionId: string
  compatibilityFingerprint: string
  workspaceKey: string | null
  runtimeBindingKey: string
  updatedAt: number
}

interface AgentRuntimeStateSnapshot {
  schemaVersion: 1
  runs: AgentRuntimeRunRecord[]
  sessions: TrustedAgentSessionRecord[]
}

function runKey(conversationId: string, runId: string): string {
  return `${conversationId}\0${runId}`
}

function isTerminal(status: AgentRuntimeRunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

/**
 * Main-process source of truth for recent Agent runs and resumable Runtime sessions.
 * Tests may omit filePath to use the same state machine without touching disk.
 */
export class AgentRuntimeStateStore {
  private readonly runs = new Map<string, AgentRuntimeRunRecord>()
  private readonly sessions = new Map<string, TrustedAgentSessionRecord>()
  private writeQueue: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(private readonly filePath?: string) {
    this.loaded = !filePath
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    if (!this.filePath) return

    let snapshot: AgentRuntimeStateSnapshot | null = null
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
      snapshot = normalizeSnapshot(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(
          '[AgentRuntimeStateStore] 状态加载失败，使用空状态:',
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    if (!snapshot) return
    const now = Date.now()
    let repaired = false
    for (const stored of snapshot.runs.slice(-MAX_RUNS)) {
      const record = structuredClone(stored)
      if (!isTerminal(record.status)) {
        record.status = 'failed'
        record.updatedAt = now
        record.completedAt = now
        record.errorCode = 'runtime_owner_lost'
        record.errorMessage = 'Studio 上次退出时任务尚未结束，原 Runtime 已失去主进程所有权'
        repaired = true
      }
      this.runs.set(runKey(record.conversationId, record.runId), record)
    }
    for (const session of snapshot.sessions) {
      this.sessions.set(session.conversationId, structuredClone(session))
    }
    if (repaired) await this.persist()
  }

  async beginRun(input: {
    conversationId: string
    runId: string
    workspaceKey: string | null
  }): Promise<AgentRuntimeRunRecord> {
    this.assertLoaded()
    const key = runKey(input.conversationId, input.runId)
    if (this.runs.has(key)) throw new Error(`Agent runId 已存在: ${input.runId}`)
    const active = [...this.runs.values()].find(
      (record) => record.conversationId === input.conversationId && !isTerminal(record.status),
    )
    if (active) {
      throw new Error(`Agent 当前 Thread 已有活动任务: ${active.runId}`)
    }
    const now = Date.now()
    const record: AgentRuntimeRunRecord = {
      ...input,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    }
    this.runs.set(key, record)
    this.trimRuns()
    if (this.runs.size > MAX_RUNS) {
      this.runs.delete(key)
      throw new Error('Agent run 账本已满，请先结束现有任务')
    }
    try {
      await this.persist()
    } catch (error) {
      if (this.runs.get(key) === record) this.runs.delete(key)
      throw error
    }
    return structuredClone(record)
  }

  async markCancelling(
    conversationId: string,
    runId: string,
  ): Promise<AgentRuntimeRunRecord | null> {
    this.assertLoaded()
    const current = this.runs.get(runKey(conversationId, runId))
    if (!current || isTerminal(current.status)) return current ? structuredClone(current) : null
    if (current.status !== 'cancelling') {
      current.status = 'cancelling'
      current.updatedAt = Date.now()
      await this.persist()
    }
    return structuredClone(current)
  }

  async finishRun(
    conversationId: string,
    runId: string,
    status: Extract<AgentRuntimeRunStatus, 'succeeded' | 'failed' | 'cancelled'>,
    failure?: { code?: string; message?: string },
  ): Promise<AgentRuntimeRunRecord | null> {
    this.assertLoaded()
    const current = this.runs.get(runKey(conversationId, runId))
    if (!current) return null
    // Only the caller that wins the non-terminal -> terminal transition may publish it.
    // Returning null for an existing terminal makes completion/cancellation races idempotent.
    if (isTerminal(current.status)) return null
    const now = Date.now()
    current.status = status
    current.updatedAt = now
    current.completedAt = now
    if (failure?.code) current.errorCode = failure.code.slice(0, 128)
    if (failure?.message) current.errorMessage = failure.message.slice(0, 2_000)
    await this.persist()
    return structuredClone(current)
  }

  getRun(conversationId: string, runId: string): AgentRuntimeRunRecord | null {
    this.assertLoaded()
    const record = this.runs.get(runKey(conversationId, runId))
    return record ? structuredClone(record) : null
  }

  rememberSession(record: TrustedAgentSessionRecord): Promise<void> {
    this.assertLoaded()
    this.sessions.set(record.conversationId, structuredClone(record))
    return this.persist()
  }

  getSession(conversationId: string): TrustedAgentSessionRecord | null {
    this.assertLoaded()
    const record = this.sessions.get(conversationId)
    return record ? structuredClone(record) : null
  }

  clearSession(conversationId: string): Promise<void> {
    this.assertLoaded()
    if (!this.sessions.delete(conversationId)) return Promise.resolve()
    return this.persist()
  }

  async clearConversation(conversationId: string): Promise<void> {
    this.assertLoaded()
    this.sessions.delete(conversationId)
    await this.persist()
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new Error('Agent Runtime 状态仓库尚未加载')
  }

  private trimRuns(): void {
    if (this.runs.size <= MAX_RUNS) return
    const terminal = [...this.runs.entries()]
      .filter(([, record]) => isTerminal(record.status))
      .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    for (const [key] of terminal) {
      if (this.runs.size <= MAX_RUNS) break
      this.runs.delete(key)
    }
  }

  private persist(): Promise<void> {
    if (!this.filePath) return Promise.resolve()
    const snapshot: AgentRuntimeStateSnapshot = {
      schemaVersion: SCHEMA_VERSION,
      runs: [...this.runs.values()].map((record) => structuredClone(record)),
      sessions: [...this.sessions.values()].map((record) => structuredClone(record)),
    }
    const operation = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath!), { recursive: true, mode: 0o700 })
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      })
      await chmod(temporaryPath, 0o600)
      await rename(temporaryPath, this.filePath!)
    })
    this.writeQueue = operation.catch(() => undefined)
    return operation
  }
}

function normalizeSnapshot(value: unknown): AgentRuntimeStateSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AgentRuntimeStateSnapshot>
  if (candidate.schemaVersion !== SCHEMA_VERSION) return null
  const runs = Array.isArray(candidate.runs) ? candidate.runs.filter(isAgentRuntimeRunRecord) : []
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions.filter(isTrustedSessionRecord)
    : []
  return { schemaVersion: SCHEMA_VERSION, runs, sessions }
}

function isAgentRuntimeRunRecord(value: unknown): value is AgentRuntimeRunRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AgentRuntimeRunRecord>
  return (
    typeof record.conversationId === 'string' &&
    typeof record.runId === 'string' &&
    (record.status === 'running' ||
      record.status === 'cancelling' ||
      record.status === 'succeeded' ||
      record.status === 'failed' ||
      record.status === 'cancelled') &&
    (record.workspaceKey === null || typeof record.workspaceKey === 'string') &&
    typeof record.startedAt === 'number' &&
    typeof record.updatedAt === 'number' &&
    (record.completedAt === null || typeof record.completedAt === 'number')
  )
}

function isTrustedSessionRecord(value: unknown): value is TrustedAgentSessionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<TrustedAgentSessionRecord>
  return (
    typeof record.conversationId === 'string' &&
    typeof record.sessionId === 'string' &&
    /^[a-f0-9]{64}$/.test(record.compatibilityFingerprint ?? '') &&
    (record.workspaceKey === null || typeof record.workspaceKey === 'string') &&
    typeof record.runtimeBindingKey === 'string' &&
    typeof record.updatedAt === 'number'
  )
}
