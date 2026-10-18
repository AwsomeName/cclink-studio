import { app } from 'electron'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  EMPTY_WEB_RESOURCE_SNAPSHOT,
  type WebResourceSnapshot,
} from '../../shared/web-resources/web-resource-types'
import { parseWebResourceSnapshot } from '../../shared/web-resources/web-resource-schema'
import {
  classifyWebServiceStartupError,
  WebServiceStartupError,
} from '../diagnostics/web-service-startup-error'

const MAX_STORE_BYTES = 2 * 1024 * 1024

type SnapshotReadResult =
  | { kind: 'valid'; snapshot: WebResourceSnapshot; sourceVersion: number }
  | { kind: 'missing' }
  | { kind: 'invalid'; error: Error }

function cloneSnapshot(snapshot: WebResourceSnapshot): WebResourceSnapshot {
  return structuredClone(snapshot)
}

export class WebResourceStore {
  readonly filePath: string
  readonly backupPath: string
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(filePath = join(app.getPath('userData'), 'web-resources', 'web-resources.json')) {
    this.filePath = filePath
    this.backupPath = `${filePath}.bak`
  }

  async load(): Promise<WebResourceSnapshot> {
    const primary = await this.readSnapshot(this.filePath)
    if (primary.kind === 'valid') {
      if (primary.sourceVersion < 3) {
        try {
          await this.persist(primary.snapshot, true)
        } catch (error) {
          throw classifyWebServiceStartupError(error, 'restore-state')
        }
      }
      return primary.snapshot
    }

    const backup = await this.readSnapshot(this.backupPath)
    if (backup.kind === 'valid') {
      try {
        await this.persist(backup.snapshot, false)
      } catch (error) {
        throw classifyWebServiceStartupError(error, 'restore-state')
      }
      return backup.snapshot
    }

    if (primary.kind === 'invalid' || backup.kind === 'invalid') {
      const error =
        primary.kind === 'invalid'
          ? primary.error
          : backup.kind === 'invalid'
            ? backup.error
            : undefined
      const classified = classifyWebServiceStartupError(error, 'read-state', 'STATE_INVALID')
      throw new WebServiceStartupError(
        classified.stage,
        classified.code,
        '网站与账号数据无法加载；原文件已保留，请根据诊断恢复',
        error,
      )
    }
    return cloneSnapshot(EMPTY_WEB_RESOURCE_SNAPSHOT)
  }

  async save(snapshot: WebResourceSnapshot): Promise<void> {
    const validated = parseWebResourceSnapshot(snapshot)
    await this.persist(validated, true)
  }

  async flush(): Promise<void> {
    await this.saveQueue
  }

  private async readSnapshot(path: string): Promise<SnapshotReadResult> {
    try {
      const metadata = await stat(path)
      if (metadata.size > MAX_STORE_BYTES) {
        throw new WebServiceStartupError(
          'read-state',
          'STATE_TOO_LARGE',
          '资源文件超过安全大小限制',
        )
      }
      const raw = await readFile(path, 'utf8')
      try {
        const decoded = JSON.parse(raw) as { schemaVersion?: unknown }
        const sourceVersion = typeof decoded.schemaVersion === 'number' ? decoded.schemaVersion : 0
        return { kind: 'valid', snapshot: parseWebResourceSnapshot(decoded), sourceVersion }
      } catch (error) {
        throw new WebServiceStartupError(
          'read-state',
          'STATE_INVALID',
          '网站与账号状态格式无效',
          error,
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { kind: 'missing' }
      }
      const normalizedError = classifyWebServiceStartupError(error, 'read-state')
      console.warn(`[WebResourceStore] 无法读取 ${path}:`, normalizedError.message)
      return { kind: 'invalid', error: normalizedError }
    }
  }

  private async persist(snapshot: WebResourceSnapshot, preservePrimary: boolean): Promise<void> {
    const serialized = JSON.stringify(snapshot, null, 2)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
      throw new Error(`资源文件超过 ${MAX_STORE_BYTES} 字节限制`)
    }

    const temporaryPath = `${this.filePath}.tmp`
    const persist = async (): Promise<void> => {
      await mkdir(dirname(this.filePath), { recursive: true })
      if (preservePrimary && (await this.readSnapshot(this.filePath)).kind === 'valid') {
        await copyFile(this.filePath, this.backupPath)
      }
      await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    }

    const pending = this.saveQueue.then(persist, persist)
    this.saveQueue = pending.catch(() => undefined)
    await pending
  }
}
