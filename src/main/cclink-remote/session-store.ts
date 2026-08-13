import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

interface PersistedSession {
  schemaVersion: 1
  refreshToken: string
  expiresAt: number
  updatedAt: number
}

export class CclinkSessionStore {
  private readonly filePath: string

  constructor(private readonly userDataPath: string) {
    this.filePath = join(userDataPath, 'cclink-session.json')
  }

  load(): PersistedSession | null {
    if (!existsSync(this.filePath)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<PersistedSession>
      if (
        parsed.schemaVersion !== 1 ||
        typeof parsed.refreshToken !== 'string' ||
        parsed.refreshToken.length === 0 ||
        parsed.refreshToken.length > 4096 ||
        typeof parsed.expiresAt !== 'number' ||
        typeof parsed.updatedAt !== 'number'
      ) {
        this.quarantine()
        return null
      }
      ensurePrivate(this.filePath)
      return parsed as PersistedSession
    } catch {
      this.quarantine()
      return null
    }
  }

  save(refreshToken: string, expiresAt: number): void {
    const token = refreshToken.trim()
    if (!token || token.length > 4096 || !Number.isFinite(expiresAt)) {
      throw new Error('CCLink Session 数据无效')
    }
    mkdirSync(this.userDataPath, { recursive: true })
    const temporaryPath = join(
      this.userDataPath,
      `.cclink-session.${process.pid}.${randomUUID()}.tmp`,
    )
    const data: PersistedSession = {
      schemaVersion: 1,
      refreshToken: token,
      expiresAt,
      updatedAt: Date.now(),
    }
    let descriptor: number | null = null
    try {
      descriptor = openSync(temporaryPath, 'wx', 0o600)
      writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      fsyncSync(descriptor)
      closeSync(descriptor)
      descriptor = null
      renameSync(temporaryPath, this.filePath)
      ensurePrivate(this.filePath)
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor)
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
      throw error
    }
  }

  clear(): void {
    if (existsSync(this.filePath)) unlinkSync(this.filePath)
  }

  private quarantine(): void {
    if (!existsSync(this.filePath)) return
    mkdirSync(this.userDataPath, { recursive: true })
    const target = join(
      this.userDataPath,
      `cclink-session.relogin-${Date.now()}-${randomUUID()}.json`,
    )
    try {
      renameSync(this.filePath, target)
      ensurePrivate(target)
    } catch {
      // 损坏/旧密文只隔离，不尝试解密或迁移。
    }
  }
}

function ensurePrivate(path: string): void {
  try {
    chmodSync(path, 0o600)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
}
