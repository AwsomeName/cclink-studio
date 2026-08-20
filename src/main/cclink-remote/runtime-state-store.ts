import { randomUUID } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CclinkRemoteMessage, CclinkRemoteSession } from '../../shared/cclink'

export interface CclinkRuntimeState {
  version: 1
  sessions: CclinkRemoteSession[]
  messages: Record<string, CclinkRemoteMessage[]>
}

const EMPTY_STATE: CclinkRuntimeState = { version: 1, sessions: [], messages: {} }
const MAX_STATE_BYTES = 16 * 1024 * 1024

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
      return await readStateFile(this.filePath)
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
        const quarantinePath = `${this.filePath}.corrupt-${Date.now()}`
        await rename(this.filePath, quarantinePath).catch(() => undefined)
        try {
          const recovered = await readStateFile(`${this.filePath}.bak`)
          await this.save(recovered)
          return recovered
        } catch {
          // Backup is optional; a corrupt primary remains quarantined for manual recovery.
        }
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
    this.pendingSnapshot = JSON.stringify(sanitizeState(state), null, 2)
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
        await copyFile(this.filePath, `${this.filePath}.bak`).catch(() => undefined)
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
    typeof session.workspaceId !== 'string' ||
    !session.workspaceId.trim() ||
    typeof session.workspacePath !== 'string' ||
    typeof session.serverId !== 'string' ||
    typeof session.createdAt !== 'number' ||
    typeof session.updatedAt !== 'number'
  )
    return null
  return {
    id: session.id,
    name: session.name,
    workspaceId: session.workspaceId,
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
          ? { input: redactSecrets(tool['input']) as Record<string, unknown> }
          : {}),
        ...(typeof (tool['output'] ?? tool['result']) === 'string'
          ? { output: redactString(String(tool['output'] ?? tool['result'])) }
          : {}),
        ...(typeof tool['error'] === 'string' ? { error: redactString(tool['error']) } : {}),
        ...(tool['requiresApproval'] === true ? { requiresApproval: true } : {}),
        ...(typeof tool['approvalReason'] === 'string'
          ? { approvalReason: redactString(tool['approvalReason']) }
          : {}),
        ...(typeof tool['expiresAt'] === 'number' ? { expiresAt: tool['expiresAt'] } : {}),
        ...(typeof tool['requestId'] === 'string' ? { requestId: tool['requestId'] } : {}),
      },
    }
  }
  if (
    message['type'] === 'userQuestion' &&
    typeof message['requestId'] === 'string' &&
    typeof message['toolUseId'] === 'string' &&
    Array.isArray(message['questions'])
  ) {
    const questions = message['questions'].flatMap((value, index) => {
      if (!value || typeof value !== 'object') return []
      const question = value as Record<string, unknown>
      if (typeof question['question'] !== 'string') return []
      return [
        {
          id: typeof question['id'] === 'string' ? question['id'] : `question-${index + 1}`,
          ...(typeof question['header'] === 'string' ? { header: question['header'] } : {}),
          question: question['question'],
          ...(question['multiSelect'] === true ? { multiSelect: true } : {}),
          ...(Array.isArray(question['options'])
            ? {
                options: question['options'].flatMap((option) => {
                  if (!option || typeof option !== 'object') return []
                  const item = option as Record<string, unknown>
                  return typeof item['label'] === 'string'
                    ? [
                        {
                          label: item['label'],
                          ...(typeof item['description'] === 'string'
                            ? { description: item['description'] }
                            : {}),
                        },
                      ]
                    : []
                }),
              }
            : {}),
        },
      ]
    })
    return {
      type: 'userQuestion',
      id: message['id'],
      timestamp: message['timestamp'],
      requestId: message['requestId'],
      toolUseId: message['toolUseId'],
      questions,
      ...(message['answered'] === true ? { answered: true } : {}),
    }
  }
  return null
}

async function readStateFile(filePath: string): Promise<CclinkRuntimeState> {
  const info = await stat(filePath)
  if (info.size > MAX_STATE_BYTES) throw new Error('远程会话状态超过安全大小限制')
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<CclinkRuntimeState>
  if (parsed.version !== 1) return structuredClone(EMPTY_STATE)
  return sanitizeState(parsed)
}

function sanitizeState(state: Partial<CclinkRuntimeState>): CclinkRuntimeState {
  const sessions = Array.isArray(state.sessions)
    ? state.sessions.flatMap((session) => {
        const sanitized = sanitizeSession(session)
        return sanitized ? [sanitized] : []
      })
    : []
  const sessionIds = new Set(sessions.map((session) => session.id))
  const messages = Object.fromEntries(
    Object.entries(state.messages ?? {}).flatMap(([sessionId, items]) =>
      sessionIds.has(sessionId) && Array.isArray(items)
        ? [
            [
              sessionId,
              collapseRepeatedTerminalMessages(
                items.flatMap((item) => {
                  const sanitized = sanitizeMessage(item)
                  return sanitized ? [sanitized] : []
                }),
              ).slice(-2_000),
            ],
          ]
        : [],
    ),
  )
  return { version: 1, sessions, messages }
}

function collapseRepeatedTerminalMessages(messages: CclinkRemoteMessage[]): CclinkRemoteMessage[] {
  const collapsed: CclinkRemoteMessage[] = []
  for (const message of messages) {
    const previous = collapsed.at(-1)
    if (
      previous?.type === 'agentText' &&
      message.type === 'agentText' &&
      previous.content === message.content &&
      isSegmentOf(previous.id, message.id)
    ) {
      collapsed[collapsed.length - 1] = message
      continue
    }
    collapsed.push(message)
  }
  return collapsed
}

function isSegmentOf(segmentMessageId: string, terminalMessageId: string): boolean {
  const prefix = `${terminalMessageId}-seg`
  return segmentMessageId.startsWith(prefix) && /^\d+$/u.test(segmentMessageId.slice(prefix.length))
}

const SENSITIVE_KEY =
  /(password|passcode|token|authorization|api.?key|secret|usersig|cookie|session.?key|验证码)/iu

function redactSecrets(value: unknown, keyName = ''): unknown {
  if (SENSITIVE_KEY.test(keyName)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactSecrets(item, key),
      ]),
    )
  }
  return typeof value === 'string' ? redactString(value) : value
}

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, 'Bearer [REDACTED]')
    .replace(/\b(sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gu, '[REDACTED]')
}

function isToolState(
  value: string,
): value is 'pending' | 'executing' | 'completed' | 'failed' | 'denied' {
  return ['pending', 'executing', 'completed', 'failed', 'denied'].includes(value)
}
