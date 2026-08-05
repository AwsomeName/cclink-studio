import { app } from 'electron'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
  BROWSER_PROFILE_ID_MAX_LENGTH,
  BROWSER_PROFILE_ID_PATTERN,
} from '../../shared/browser-profile'

const MAX_STORE_BYTES = 256 * 1024

export interface WebResourceDraftRecord {
  id: string
  workspaceId: string
  browserProfileId: string
  state: 'open' | 'saving' | 'cleanup-pending'
  createdAt: string
  updatedAt: string
}

interface WebResourceDraftSnapshot {
  schemaVersion: 1
  records: WebResourceDraftRecord[]
}

const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    records: z
      .array(
        z
          .object({
            id: z.uuid(),
            workspaceId: z.uuid(),
            browserProfileId: z
              .string()
              .min(1)
              .max(BROWSER_PROFILE_ID_MAX_LENGTH)
              .regex(BROWSER_PROFILE_ID_PATTERN),
            state: z.enum(['open', 'saving', 'cleanup-pending']),
            createdAt: z.iso.datetime(),
            updatedAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()

export class WebResourceDraftStore {
  readonly filePath: string
  readonly backupPath: string
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(
    filePath = join(app.getPath('userData'), 'web-resources', 'web-resource-drafts.json'),
  ) {
    this.filePath = filePath
    this.backupPath = `${filePath}.bak`
  }

  async load(): Promise<WebResourceDraftRecord[]> {
    const primary = await this.readSnapshot(this.filePath)
    if (primary) return structuredClone(primary.records)
    const backup = await this.readSnapshot(this.backupPath)
    if (backup) {
      await this.persist(backup, false)
      return structuredClone(backup.records)
    }
    return []
  }

  async save(records: WebResourceDraftRecord[]): Promise<void> {
    await this.persist(snapshotSchema.parse({ schemaVersion: 1, records }), true)
  }

  async flush(): Promise<void> {
    await this.saveQueue
  }

  private async readSnapshot(path: string): Promise<WebResourceDraftSnapshot | null> {
    try {
      const metadata = await stat(path)
      if (metadata.size > MAX_STORE_BYTES) throw new Error('网站账号草稿文件过大')
      return snapshotSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[WebResourceDraftStore] 无法读取 ${path}:`, error)
      }
      return null
    }
  }

  private async persist(
    snapshot: WebResourceDraftSnapshot,
    preservePrimary: boolean,
  ): Promise<void> {
    const serialized = JSON.stringify(snapshot, null, 2)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_BYTES) {
      throw new Error('网站账号草稿文件过大')
    }
    const temporaryPath = `${this.filePath}.tmp`
    const persist = async (): Promise<void> => {
      await mkdir(dirname(this.filePath), { recursive: true })
      if (preservePrimary && (await this.readSnapshot(this.filePath))) {
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
