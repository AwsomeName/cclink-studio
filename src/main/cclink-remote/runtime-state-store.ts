import { createHash, randomUUID } from 'node:crypto'
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

  constructor(
    private readonly root: string,
    private readonly legacyStatePaths: string[] = [],
  ) {
    this.filePath = join(root, 'cclink-runtime-state.json')
  }

  async load(): Promise<CclinkRuntimeState> {
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, 'utf8'),
      ) as Partial<CclinkRuntimeState>
      if (parsed.version !== 1) return structuredClone(EMPTY_STATE)
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.flatMap((session) => {
            const sanitized = sanitizeSession(session)
            return sanitized ? [sanitized] : []
          })
        : []
      const sessionIds = new Set(sessions.map((session) => session.id))
      const messages = Object.fromEntries(
        Object.entries(parsed.messages ?? {}).flatMap(([sessionId, items]) =>
          sessionIds.has(sessionId) && Array.isArray(items)
            ? [
                [
                  sessionId,
                  items
                    .flatMap((message) => {
                      const sanitized = sanitizeMessage(message)
                      return sanitized ? [sanitized] : []
                    })
                    .slice(-2_000),
                ],
              ]
            : [],
        ),
      )
      return { version: 1, sessions, messages }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const imported = await this.readPreviousDesktopState()
        if (imported) {
          await this.save(imported)
          return imported
        }
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[CCLink Studio] 远程会话状态加载失败:', error)
      }
      return structuredClone(EMPTY_STATE)
    }
  }

  private async readPreviousDesktopState(): Promise<CclinkRuntimeState | null> {
    for (const sourcePath of this.legacyStatePaths) {
      try {
        const raw = await readFile(sourcePath, 'utf8')
        if (Buffer.byteLength(raw, 'utf8') > 16 * 1024 * 1024) continue
        const parsed = JSON.parse(raw) as { sessions?: unknown; messages?: unknown }
        const sessions = Array.isArray(parsed.sessions)
          ? parsed.sessions.flatMap((session) => {
              const sanitized = sanitizeSession(session)
              return sanitized ? [sanitized] : []
            })
          : []
        const sessionIds = new Set(sessions.map((session) => session.id))
        const messages =
          parsed.messages && typeof parsed.messages === 'object'
            ? Object.fromEntries(
                Object.entries(parsed.messages).flatMap(([sessionId, items]) =>
                  sessionIds.has(sessionId) && Array.isArray(items)
                    ? [
                        [
                          sessionId,
                          items
                            .flatMap((message) => {
                              const sanitized = sanitizeMessage(message)
                              return sanitized ? [sanitized] : []
                            })
                            .slice(-2_000),
                        ],
                      ]
                    : [],
                ),
              )
            : {}
        if (sessions.length === 0 && Object.keys(messages).length === 0) continue
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        await writeFile(
          join(this.root, 'legacy-runtime-state-import.json'),
          JSON.stringify(
            {
              version: 1,
              sourcePath,
              importedAt: Date.now(),
              sessionCount: sessions.length,
              messageCount: Object.values(messages).reduce(
                (total, items) => total + items.length,
                0,
              ),
            },
            null,
            2,
          ),
          { encoding: 'utf8', mode: 0o600 },
        )
        return { version: 1, sessions, messages }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[CCLink Studio] 旧远程非敏感状态导入失败:', error)
        }
      }
    }
    return null
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
        const temporary = join(
          this.root,
          `.cclink-runtime-state.${process.pid}.${randomUUID()}.tmp`,
        )
        await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, this.filePath)
        await chmod(this.filePath, 0o600)
      } catch (error) {
        console.warn('[CCLink Studio] 远程会话状态保存失败:', error)
      }
    }
  }
}

function sanitizeSession(value: unknown): CclinkRemoteSession | null {
  if (!value || typeof value !== 'object') return null
  const session = value as Partial<CclinkRemoteSession>
  if (
    typeof session.id !== 'string' ||
    typeof session.name !== 'string' ||
    typeof session.workspacePath !== 'string' ||
    typeof session.serverId !== 'string' ||
    typeof session.createdAt !== 'number' ||
    typeof session.updatedAt !== 'number'
  )
    return null
  return {
    id: session.id,
    name: session.name,
    workspaceId:
      typeof session.workspaceId === 'string'
        ? session.workspaceId
        : legacyWorkspaceId(session.serverId, session.workspacePath),
    workspacePath: session.workspacePath,
    serverId: session.serverId,
    status: session.status === 'archived' ? 'archived' : 'idle',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: typeof session.messageCount === 'number' ? session.messageCount : 0,
    contextUsage: typeof session.contextUsage === 'number' ? session.contextUsage : 0,
  }
}

function sanitizeMessage(value: unknown): CclinkRemoteMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if (typeof message['id'] !== 'string' || typeof message['timestamp'] !== 'number') return null
  if (
    (message['type'] === 'user' ||
      message['type'] === 'agentText' ||
      message['type'] === 'system') &&
    typeof message['content'] === 'string'
  ) {
    return {
      type: message['type'],
      id: message['id'],
      content: message['content'],
      timestamp: message['timestamp'],
    }
  }
  if (message['type'] === 'agentTool' && message['tool'] && typeof message['tool'] === 'object') {
    const tool = message['tool'] as Record<string, unknown>
    const rawState = tool['state'] ?? tool['toolState']
    const state = rawState === 'skeleton' ? 'pending' : rawState
    const name =
      typeof tool['name'] === 'string'
        ? tool['name']
        : typeof tool['toolType'] === 'string'
          ? tool['toolType']
          : typeof tool['target'] === 'string'
            ? tool['target']
            : null
    if (!name || typeof state !== 'string' || !isToolState(state)) return null
    return {
      type: 'agentTool',
      id: message['id'],
      timestamp: message['timestamp'],
      tool: {
        id: String(tool['id'] ?? message['id']),
        name,
        state,
        ...(tool['input'] && typeof tool['input'] === 'object'
          ? { input: tool['input'] as Record<string, unknown> }
          : {}),
        ...(typeof (tool['output'] ?? tool['result']) === 'string'
          ? { output: String(tool['output'] ?? tool['result']) }
          : {}),
        ...(typeof tool['error'] === 'string' ? { error: tool['error'] } : {}),
      },
    }
  }
  return null
}

function legacyWorkspaceId(serverId: string, path: string): string {
  return createHash('sha256').update(`${serverId}\0${path}`).digest('hex').slice(0, 24)
}

function isToolState(
  value: string,
): value is 'pending' | 'executing' | 'completed' | 'failed' | 'denied' {
  return ['pending', 'executing', 'completed', 'failed', 'denied'].includes(value)
}
