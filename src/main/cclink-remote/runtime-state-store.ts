import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CclinkRemoteMessage, CclinkRemoteSession } from '../../shared/cclink'

export interface CclinkRuntimeState {
  version: 1
  sessions: CclinkRemoteSession[]
  messages: Record<string, CclinkRemoteMessage[]>
}

const EMPTY_STATE: CclinkRuntimeState = { version: 1, sessions: [], messages: {} }

export class CclinkRuntimeStateStore {
  private readonly filePath: string
  private writes: Promise<void> | null = null
  private pendingSnapshot: string | null = null

  constructor(private readonly root: string) {
    this.filePath = join(root, 'cclink-runtime-state.json')
  }

  async load(): Promise<CclinkRuntimeState> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<CclinkRuntimeState>
      if (parsed.version !== 1) return structuredClone(EMPTY_STATE)
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.filter(isSession).map((session) => ({ ...session, status: 'idle' as const }))
        : []
      const sessionIds = new Set(sessions.map((session) => session.id))
      const messages = Object.fromEntries(
        Object.entries(parsed.messages ?? {}).flatMap(([sessionId, items]) =>
          sessionIds.has(sessionId) && Array.isArray(items)
            ? [[sessionId, items.filter(isMessage).slice(-2_000)]]
            : [],
        ),
      )
      return { version: 1, sessions, messages }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[CCLink Studio] 远程会话状态加载失败:', error)
      }
      return structuredClone(EMPTY_STATE)
    }
  }

  save(state: CclinkRuntimeState): Promise<void> {
    this.pendingSnapshot = JSON.stringify(state, null, 2)
    this.writes ??= this.drainWrites().finally(() => {
      this.writes = null
    })
    return this.writes
  }

  private async drainWrites(): Promise<void> {
    while (this.pendingSnapshot !== null) {
      const snapshot = this.pendingSnapshot
      this.pendingSnapshot = null
      try {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const temporary = join(this.root, `.cclink-runtime-state.${process.pid}.${randomUUID()}.tmp`)
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.filePath)
      await chmod(this.filePath, 0o600)
      } catch (error) {
        console.warn('[CCLink Studio] 远程会话状态保存失败:', error)
      }
    }
  }
}

function isSession(value: unknown): value is CclinkRemoteSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<CclinkRemoteSession>
  return (
    typeof session.id === 'string' &&
    typeof session.name === 'string' &&
    typeof session.workspaceId === 'string' &&
    typeof session.workspacePath === 'string' &&
    typeof session.serverId === 'string' &&
    typeof session.createdAt === 'number' &&
    typeof session.updatedAt === 'number'
  )
}

function isMessage(value: unknown): value is CclinkRemoteMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<CclinkRemoteMessage>
  return (
    typeof message.id === 'string' &&
    typeof message.type === 'string' &&
    typeof message.timestamp === 'number'
  )
}
