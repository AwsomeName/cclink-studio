import { app } from 'electron'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import type {
  TerminalSessionCommandRecord,
  TerminalSessionOutputLine,
  TerminalSessionSnapshot,
} from '../../shared/ipc/terminal'
import type {
  TerminalClosePolicy,
  TerminalCommandActor,
  TerminalExecutionEvent,
  TerminalPermissionPolicy,
  TerminalRuntimeRef,
  TerminalStatus,
} from '../../shared/terminal'
import { workspaceRefKey } from '../../shared/workspace-ref'

export interface TerminalSessionRecord extends TerminalSessionSnapshot {
  workspaceKey?: string | null
  attachable: boolean
  outputBuffer: TerminalSessionOutputLine[]
  commandHistory: TerminalSessionCommandRecord[]
}

export interface TerminalSessionStoreState {
  version: 1
  sessions: TerminalSessionRecord[]
  updatedAt: number
}

export interface UpsertTerminalSessionInput {
  sessionId: string
  runtime: TerminalRuntimeRef
  status?: TerminalStatus
  processId?: string | number
  permissionPolicy?: TerminalPermissionPolicy
  closePolicy?: TerminalClosePolicy
  attachable?: boolean
  now?: number
}

export interface PatchTerminalSessionInput {
  sessionId: string
  status?: TerminalStatus
  processId?: string | number
  exitCode?: number
  signal?: string
  exitedAt?: number
  errorMessage?: string
  lastCommand?: string
  attachable?: boolean
  now?: number
}

const EMPTY_STATE: TerminalSessionStoreState = {
  version: 1,
  sessions: [],
  updatedAt: 0,
}

const MAX_SESSIONS = 300
const MAX_OUTPUT_LINES_PER_SESSION = 1200
const MAX_COMMANDS_PER_SESSION = 300

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function isTerminalSessionRecord(value: unknown): value is TerminalSessionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<TerminalSessionRecord>
  return (
    typeof record.sessionId === 'string' &&
    typeof record.runtime === 'object' &&
    typeof record.status === 'string' &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
  )
}

function normalizeLoadedRecord(record: TerminalSessionRecord): TerminalSessionRecord {
  return {
    ...record,
    attachable: Boolean(record.attachable),
    workspaceKey: record.workspaceKey ?? workspaceRefKey(record.runtime.workspaceRef),
    // 旧版本把原始键盘输入也写入了记录，其中可能包含密码提示下的敏感内容。
    outputBuffer: Array.isArray(record.outputBuffer)
      ? record.outputBuffer.filter((line) => line.kind !== 'input')
      : [],
    commandHistory: Array.isArray(record.commandHistory) ? record.commandHistory : [],
  }
}

function byUpdatedAtAsc(a: TerminalSessionRecord, b: TerminalSessionRecord): number {
  return a.updatedAt - b.updatedAt
}

function sanitizeText(text: string, maxLength: number): string {
  return text.replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, '').slice(0, maxLength)
}

export class TerminalSessionStore {
  private readonly filePath: string
  private state: TerminalSessionStoreState = { ...EMPTY_STATE, sessions: [] }
  private loaded = false
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(filename = 'terminal-sessions.json') {
    this.filePath = join(app.getPath('userData'), filename)
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<TerminalSessionStoreState>
      this.state = {
        version: 1,
        sessions: Array.isArray(parsed.sessions)
          ? parsed.sessions.filter(isTerminalSessionRecord).map(normalizeLoadedRecord)
          : [],
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      }
      await this.save()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[TerminalSessionStore] 加载失败:', (error as Error).message)
      }
      this.state = { ...EMPTY_STATE, sessions: [] }
      await this.save()
    }
    this.loaded = true
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  private async save(): Promise<void> {
    this.state.updatedAt = Date.now()
    this.state.sessions = [...this.state.sessions].sort(byUpdatedAtAsc).slice(-MAX_SESSIONS)
    const serialized = JSON.stringify(this.state, null, 2)
    const temporaryPath = `${this.filePath}.tmp`
    const persist = async (): Promise<void> => {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(temporaryPath, serialized, 'utf-8')
      await rename(temporaryPath, this.filePath)
    }
    const pendingSave = this.saveQueue.then(persist, persist)
    this.saveQueue = pendingSave.catch(() => undefined)
    try {
      await pendingSave
    } catch (error) {
      console.warn('[TerminalSessionStore] 保存失败:', (error as Error).message)
    }
  }

  async upsertSession(input: UpsertTerminalSessionInput): Promise<TerminalSessionRecord> {
    await this.ensureLoaded()
    const now = input.now ?? Date.now()
    const existing = this.state.sessions.find((session) => session.sessionId === input.sessionId)
    const next: TerminalSessionRecord = {
      ...(existing ?? {
        sessionId: input.sessionId,
        runtime: input.runtime,
        status: input.status ?? 'idle',
        createdAt: now,
        updatedAt: now,
        attachable: false,
        outputBuffer: [],
        commandHistory: [],
      }),
      runtime: input.runtime,
      status: input.status ?? existing?.status ?? 'idle',
      updatedAt: now,
      processId: input.processId ?? existing?.processId,
      workspaceKey: workspaceRefKey(input.runtime.workspaceRef),
      permissionPolicy: input.permissionPolicy ?? existing?.permissionPolicy,
      closePolicy: input.closePolicy ?? existing?.closePolicy,
      attachable: input.attachable ?? existing?.attachable ?? false,
    }
    this.state.sessions = [
      ...this.state.sessions.filter((session) => session.sessionId !== input.sessionId),
      next,
    ]
    await this.save()
    return next
  }

  async patchSession(input: PatchTerminalSessionInput): Promise<TerminalSessionRecord | null> {
    await this.ensureLoaded()
    const existing = this.state.sessions.find((session) => session.sessionId === input.sessionId)
    if (!existing) return null
    const now = input.now ?? Date.now()
    const next: TerminalSessionRecord = {
      ...existing,
      status: input.status ?? existing.status,
      updatedAt: now,
      processId: input.processId ?? existing.processId,
      exitCode: input.exitCode ?? existing.exitCode,
      signal: input.signal ?? existing.signal,
      exitedAt: input.exitedAt ?? existing.exitedAt,
      errorMessage: input.errorMessage ?? existing.errorMessage,
      lastCommand: input.lastCommand ?? existing.lastCommand,
      attachable: input.attachable ?? existing.attachable,
    }
    this.state.sessions = [
      ...this.state.sessions.filter((session) => session.sessionId !== input.sessionId),
      next,
    ]
    await this.save()
    return next
  }

  async appendExecutionEvent(event: TerminalExecutionEvent): Promise<void> {
    await this.ensureLoaded()
    const record = this.state.sessions.find((session) => session.sessionId === event.sessionId)
    if (!record) return
    if (event.kind === 'started') {
      await this.patchSession({
        sessionId: event.sessionId,
        status: 'running',
        processId: event.processId,
        attachable: true,
        now: event.timestamp,
      })
      await this.appendOutputLine(event.sessionId, {
        kind: 'system',
        text: `Terminal 进程已启动${event.processId ? `：${event.processId}` : ''}\n`,
        timestamp: event.timestamp,
      })
      return
    }
    if (event.kind === 'output') {
      await this.appendOutputLine(event.sessionId, {
        kind: event.stream,
        text: event.data,
        timestamp: event.timestamp,
      })
      return
    }
    if (event.kind === 'exit') {
      await this.patchSession({
        sessionId: event.sessionId,
        status: 'exited',
        exitCode: event.exitCode,
        signal: event.signal,
        exitedAt: event.timestamp,
        attachable: false,
        errorMessage: event.signal ? `signal: ${event.signal}` : undefined,
        now: event.timestamp,
      })
      await this.appendOutputLine(event.sessionId, {
        kind: 'system',
        text: `\nTerminal 进程已退出${typeof event.exitCode === 'number' ? `，退出码 ${event.exitCode}` : ''}${event.signal ? `，信号 ${event.signal}` : ''}\n`,
        timestamp: event.timestamp,
      })
      return
    }
    if (event.kind === 'error') {
      await this.patchSession({
        sessionId: event.sessionId,
        status: 'error',
        errorMessage: event.message,
        attachable: false,
        now: event.timestamp,
      })
      await this.appendOutputLine(event.sessionId, {
        kind: 'error',
        text: `${event.message}\n`,
        timestamp: event.timestamp,
      })
    }
  }

  async appendCommand(
    sessionId: string,
    command: string,
    actor: TerminalCommandActor,
    timestamp = Date.now(),
  ): Promise<void> {
    await this.ensureLoaded()
    const record = this.state.sessions.find((session) => session.sessionId === sessionId)
    if (!record) return
    const next: TerminalSessionRecord = {
      ...record,
      updatedAt: timestamp,
      lastCommand: command,
      commandHistory: [
        ...record.commandHistory,
        {
          id: createId('terminal-command'),
          command: sanitizeText(command, 4000),
          actor,
          timestamp,
        },
      ].slice(-MAX_COMMANDS_PER_SESSION),
    }
    this.state.sessions = [
      ...this.state.sessions.filter((session) => session.sessionId !== sessionId),
      next,
    ]
    await this.save()
  }

  async appendOutputLine(
    sessionId: string,
    line: Omit<TerminalSessionOutputLine, 'id'>,
  ): Promise<void> {
    await this.ensureLoaded()
    const record = this.state.sessions.find((session) => session.sessionId === sessionId)
    if (!record) return
    const next: TerminalSessionRecord = {
      ...record,
      updatedAt: line.timestamp,
      outputBuffer: [
        ...record.outputBuffer,
        {
          id: createId('terminal-output'),
          kind: line.kind,
          text: sanitizeText(line.text, 100_000),
          timestamp: line.timestamp,
        },
      ].slice(-MAX_OUTPUT_LINES_PER_SESSION),
    }
    this.state.sessions = [
      ...this.state.sessions.filter((session) => session.sessionId !== sessionId),
      next,
    ]
    await this.save()
  }

  async listSessions(): Promise<TerminalSessionRecord[]> {
    await this.ensureLoaded()
    return [...this.state.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getSession(sessionId: string): Promise<TerminalSessionRecord | null> {
    await this.ensureLoaded()
    return this.state.sessions.find((session) => session.sessionId === sessionId) ?? null
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.ensureLoaded()
    this.state.sessions = this.state.sessions.filter((session) => session.sessionId !== sessionId)
    await this.save()
  }

  async clearAll(): Promise<void> {
    await this.ensureLoaded()
    this.state = { ...EMPTY_STATE, sessions: [] }
    await this.save()
  }
}
