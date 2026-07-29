import { app, clipboard, shell } from 'electron'
import { access, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  CredentialMetadata,
  CredentialServiceStatus,
  CredentialStatus,
  SetCredentialInput,
} from '../../shared/ipc/credentials'
import { parseSetCredentialInput } from '../../shared/ipc/credentials-schema'
import {
  CredentialStoreError,
  PlaintextCredentialStore,
  type CredentialFileState,
  type StoredCredentialRecord,
} from './plaintext-credential-store'

const LEGACY_FILES = [
  'settings/secrets.enc',
  'git-backup/secrets.enc',
  'data-source/secrets.enc',
] as const

interface CredentialServiceDependencies {
  copyText?: (value: string) => void
  openPath?: (path: string) => Promise<string>
  now?: () => Date
  userDataPath?: string
}

export class CredentialService {
  private records: Record<string, StoredCredentialRecord> = Object.create(null)
  private state: CredentialStatus = 'unavailable'
  private message: string | undefined
  private legacyEncryptedFiles: string[] = []
  private loaded = false
  private pendingMutation: Promise<void> = Promise.resolve()
  private readonly copyText: (value: string) => void
  private readonly openPath: (path: string) => Promise<string>
  private readonly now: () => Date
  private readonly userDataPath: string

  constructor(
    private readonly store = new PlaintextCredentialStore(),
    dependencies: CredentialServiceDependencies = {},
  ) {
    this.copyText = dependencies.copyText ?? ((value) => clipboard.writeText(value))
    this.openPath = dependencies.openPath ?? ((path) => shell.openPath(path))
    this.now = dependencies.now ?? (() => new Date())
    this.userDataPath = dependencies.userDataPath ?? app.getPath('userData')
  }

  async load(): Promise<void> {
    await this.enqueueMutation(async () => {
      await this.loadFromDisk()
    })
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  async reload(): Promise<CredentialServiceStatus> {
    await this.enqueueMutation(async () => {
      await this.loadFromDisk()
    })
    return this.getStatus()
  }

  getStatus(): CredentialServiceStatus {
    return {
      status: this.state,
      filePath: this.store.filePath,
      configuredCount: Object.keys(this.records).length,
      ...(this.message ? { message: this.message } : {}),
      legacyEncryptedFiles: [...this.legacyEncryptedFiles],
    }
  }

  listMetadata(): CredentialMetadata[] {
    return Object.entries(this.records)
      .map(([id, record]) => ({
        id,
        kind: record.kind,
        configured: Object.values(record.fields).some((value) => value.length > 0),
        fieldNames: Object.keys(record.fields).sort(),
        updatedAt: record.updatedAt,
        consumers: consumersFor(id),
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  async setCredential(input: SetCredentialInput): Promise<CredentialServiceStatus> {
    const normalized = parseSetCredentialInput(input)
    await this.enqueueMutation(async () => {
      this.assertWritable()
      const next = cloneRecords(this.records)
      next[normalized.id] = {
        kind: normalized.kind,
        fields: { ...normalized.fields },
        updatedAt: this.now().toISOString(),
      }
      await this.save(next)
    })
    return this.getStatus()
  }

  async removeCredential(id: string): Promise<CredentialServiceStatus> {
    await this.enqueueMutation(async () => {
      this.assertWritable()
      if (!this.records[id]) return
      const next = cloneRecords(this.records)
      delete next[id]
      await this.save(next)
    })
    return this.getStatus()
  }

  async clearAll(): Promise<CredentialServiceStatus> {
    await this.enqueueMutation(async () => {
      this.assertWritable()
      await this.save(Object.create(null))
    })
    return this.getStatus()
  }

  async removeLegacyFiles(): Promise<CredentialServiceStatus> {
    await this.enqueueMutation(async () => {
      for (const relativePath of LEGACY_FILES) {
        await rm(join(this.userDataPath, relativePath), { force: true })
      }
      this.legacyEncryptedFiles = await this.detectLegacyFiles()
      if (this.state === 'ready' || this.state === 'conflict') this.message = undefined
    })
    return this.getStatus()
  }

  resolveCredential(id: string): Readonly<Record<string, string>> | null {
    this.assertReadable()
    const record = this.records[id]
    return record ? Object.freeze({ ...record.fields }) : null
  }

  revealField(id: string, field: string): string {
    const record = this.resolveCredential(id)
    const value = record?.[field]
    if (!value) throw new Error('凭证字段不存在')
    return value
  }

  copyField(id: string, field: string): void {
    this.copyText(this.revealField(id, field))
  }

  async openDirectory(): Promise<void> {
    await this.store.ensureDirectory()
    const error = await this.openPath(dirname(this.store.filePath))
    if (error) throw new Error(error)
  }

  private async loadFromDisk(): Promise<void> {
    this.legacyEncryptedFiles = await this.detectLegacyFiles()
    try {
      const snapshot = await this.store.load()
      this.records = cloneRecords(snapshot.records)
      this.state = 'ready'
      this.message =
        this.legacyEncryptedFiles.length > 0
          ? '检测到旧版加密凭证文件，请重新输入对应凭证后手动删除旧文件'
          : undefined
      this.loaded = true
    } catch (error) {
      this.records = Object.create(null)
      this.loaded = true
      if (error instanceof CredentialStoreError) {
        this.state = error.code === 'CONFLICT' ? 'conflict' : 'degraded'
        this.message = error.message
        return
      }
      this.state = 'failed'
      this.message = error instanceof Error ? error.message : String(error)
    }
  }

  private async save(records: Record<string, StoredCredentialRecord>): Promise<void> {
    const state: CredentialFileState = { schemaVersion: 1, records }
    try {
      await this.store.save(state)
      this.records = cloneRecords(records)
      this.state = 'ready'
      this.message =
        this.legacyEncryptedFiles.length > 0
          ? '检测到旧版加密凭证文件，请重新输入对应凭证后手动删除旧文件'
          : undefined
    } catch (error) {
      if (error instanceof CredentialStoreError && error.code === 'CONFLICT') {
        this.state = 'conflict'
        this.message = error.message
      }
      throw error
    }
  }

  private assertReadable(): void {
    if (!this.loaded || this.state === 'unavailable' || this.state === 'failed') {
      throw new Error('本地凭证服务尚未就绪')
    }
    if (this.state === 'degraded') {
      throw new Error(this.message ?? '本地凭证文件不可用')
    }
  }

  private assertWritable(): void {
    this.assertReadable()
    if (this.state === 'conflict') {
      throw new Error(this.message ?? '本地凭证文件存在外部修改冲突')
    }
  }

  private async detectLegacyFiles(): Promise<string[]> {
    const found: string[] = []
    await Promise.all(
      LEGACY_FILES.map(async (relativePath) => {
        const filePath = join(this.userDataPath, relativePath)
        try {
          await access(filePath)
          found.push(filePath)
        } catch {
          // Missing legacy files are the expected steady state.
        }
      }),
    )
    return found.sort()
  }

  private async enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const next = this.pendingMutation.catch(() => undefined).then(operation)
    this.pendingMutation = next
    await next
  }
}

function cloneRecords(
  records: Record<string, StoredCredentialRecord>,
): Record<string, StoredCredentialRecord> {
  return Object.fromEntries(
    Object.entries(records).map(([id, record]) => [
      id,
      { ...record, fields: { ...record.fields } },
    ]),
  )
}

function consumersFor(id: string): string[] {
  if (id.startsWith('agent:')) return ['Agent']
  if (id.startsWith('git:')) return ['Git 备份']
  if (id.startsWith('data-source:')) return ['数据源']
  if (id.startsWith('extension:webdav:')) return ['云同步']
  if (id.startsWith('extension:meshy:')) return ['Meshy']
  if (id.startsWith('extension:jimeng:')) return ['即梦图片生成']
  if (id.startsWith('extension:')) return ['扩展']
  return []
}
