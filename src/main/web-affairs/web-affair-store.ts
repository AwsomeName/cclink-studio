import { app } from 'electron'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  EMPTY_WEB_AFFAIR_SNAPSHOT,
  type WebAffairSnapshot,
} from '../../shared/web-affairs/web-affair-types'
import { parseWebAffairSnapshot } from '../../shared/web-affairs/web-affair-schema'

const MAX_STORE_BYTES = 8 * 1024 * 1024

type SnapshotReadResult =
  | { kind: 'valid'; snapshot: WebAffairSnapshot }
  | { kind: 'missing' }
  | { kind: 'invalid'; error: Error }

export class WebAffairStore {
  readonly filePath: string
  readonly backupPath: string
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(filePath = join(app.getPath('userData'), 'web-affairs', 'web-affairs.json')) {
    this.filePath = filePath
    this.backupPath = `${filePath}.bak`
  }

  async load(): Promise<WebAffairSnapshot> {
    const primary = await this.readSnapshot(this.filePath)
    if (primary.kind === 'valid') return primary.snapshot

    const backup = await this.readSnapshot(this.backupPath)
    if (backup.kind === 'valid') {
      await this.persist(backup.snapshot, false)
      return backup.snapshot
    }

    if (primary.kind === 'invalid' || backup.kind === 'invalid') {
      throw new Error('事务数据文件损坏；原文件已保留，请从诊断或备份恢复')
    }
    return structuredClone(EMPTY_WEB_AFFAIR_SNAPSHOT)
  }

  async save(snapshot: WebAffairSnapshot): Promise<void> {
    await this.persist(parseWebAffairSnapshot(snapshot), true)
  }

  async flush(): Promise<void> {
    await this.saveQueue
  }

  private async readSnapshot(path: string): Promise<SnapshotReadResult> {
    try {
      const metadata = await stat(path)
      if (metadata.size > MAX_STORE_BYTES) {
        throw new Error(`事务文件超过 ${MAX_STORE_BYTES} 字节限制`)
      }
      return {
        kind: 'valid',
        snapshot: parseWebAffairSnapshot(JSON.parse(await readFile(path, 'utf8'))),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
      const normalized = error instanceof Error ? error : new Error(String(error))
      console.warn(`[WebAffairStore] 无法读取 ${path}:`, normalized.message)
      return { kind: 'invalid', error: normalized }
    }
  }

  private async persist(snapshot: WebAffairSnapshot, preservePrimary: boolean): Promise<void> {
    const serialized = JSON.stringify(snapshot, null, 2)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
      throw new Error(`事务文件超过 ${MAX_STORE_BYTES} 字节限制`)
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
