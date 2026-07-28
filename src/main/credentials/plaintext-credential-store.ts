import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { CredentialKind } from '../../shared/ipc/credentials'
import { parseCredentialFieldName, parseCredentialId } from '../../shared/ipc/credentials-schema'

const MAX_FILE_BYTES = 1_048_576
const MAX_RECORDS = 256
const MAX_FIELDS = 32
const MAX_FIELD_LENGTH = 65_536
const MISSING_DIGEST = 'missing'
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const VALID_KINDS = new Set<CredentialKind>(['api-key', 'token', 'basic', 'bearer', 'generic'])

export interface StoredCredentialRecord {
  kind: CredentialKind
  fields: Record<string, string>
  updatedAt: string
}

export interface CredentialFileState {
  schemaVersion: 1
  records: Record<string, StoredCredentialRecord>
}

export type CredentialStoreErrorCode =
  | 'INVALID_FILE'
  | 'UNSUPPORTED_VERSION'
  | 'FILE_TOO_LARGE'
  | 'CONFLICT'
  | 'READ_FAILED'
  | 'WRITE_FAILED'

export class CredentialStoreError extends Error {
  constructor(
    readonly code: CredentialStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'CredentialStoreError'
  }
}

export class PlaintextCredentialStore {
  readonly filePath: string
  private loadedDigest: string | null = null

  constructor(filePath = join(app.getPath('userData'), 'credentials/credentials.json')) {
    this.filePath = filePath
  }

  async load(): Promise<CredentialFileState> {
    try {
      const buffer = await readFile(this.filePath)
      if (buffer.byteLength > MAX_FILE_BYTES) {
        throw new CredentialStoreError('FILE_TOO_LARGE', '本地凭证文件超过 1 MB 限制')
      }
      const state = parseCredentialFile(buffer.toString('utf-8'))
      this.loadedDigest = digest(buffer)
      return cloneState(state)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loadedDigest = MISSING_DIGEST
        return emptyState()
      }
      if (error instanceof CredentialStoreError) throw error
      throw new CredentialStoreError(
        'READ_FAILED',
        '本地凭证文件读取失败',
        error instanceof Error ? { cause: error } : undefined,
      )
    }
  }

  async save(state: CredentialFileState): Promise<void> {
    if (this.loadedDigest === null) {
      throw new CredentialStoreError('WRITE_FAILED', '本地凭证文件尚未加载')
    }
    const normalized = validateCredentialState(state)
    const currentDigest = await this.readDiskDigest()
    if (currentDigest !== this.loadedDigest) {
      throw new CredentialStoreError(
        'CONFLICT',
        '本地凭证文件已被外部修改，请重新加载磁盘版本后再保存',
      )
    }

    const serialized = `${JSON.stringify(normalized, null, 2)}\n`
    const bytes = Buffer.byteLength(serialized, 'utf-8')
    if (bytes > MAX_FILE_BYTES) {
      throw new CredentialStoreError('FILE_TOO_LARGE', '本地凭证文件超过 1 MB 限制')
    }

    const directory = dirname(this.filePath)
    const temporaryPath = join(directory, `.credentials.${process.pid}.${randomUUID()}.tmp`)
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
      await writeFile(temporaryPath, serialized, { encoding: 'utf-8', mode: 0o600 })
      const latestDigest = await this.readDiskDigest()
      if (latestDigest !== this.loadedDigest) {
        throw new CredentialStoreError(
          'CONFLICT',
          '本地凭证文件已被外部修改，请重新加载磁盘版本后再保存',
        )
      }
      await rename(temporaryPath, this.filePath)
      await chmod(this.filePath, 0o600)
      this.loadedDigest = digest(Buffer.from(serialized, 'utf-8'))
    } catch (error: unknown) {
      if (error instanceof CredentialStoreError) throw error
      throw new CredentialStoreError(
        'WRITE_FAILED',
        '本地凭证文件写入失败',
        error instanceof Error ? { cause: error } : undefined,
      )
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  async ensureDirectory(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
  }

  private async readDiskDigest(): Promise<string> {
    try {
      const buffer = await readFile(this.filePath)
      return digest(buffer)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return MISSING_DIGEST
      throw new CredentialStoreError(
        'READ_FAILED',
        '无法检查本地凭证文件是否被外部修改',
        error instanceof Error ? { cause: error } : undefined,
      )
    }
  }
}

function parseCredentialFile(raw: string): CredentialFileState {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new CredentialStoreError(
      'INVALID_FILE',
      '本地凭证文件不是有效 JSON',
      error instanceof Error ? { cause: error } : undefined,
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CredentialStoreError('INVALID_FILE', '本地凭证文件结构无效')
  }
  const root = value as Record<string, unknown>
  if (Object.keys(root).some((key) => key !== 'schemaVersion' && key !== 'records')) {
    throw new CredentialStoreError('INVALID_FILE', '本地凭证文件包含未知顶层字段')
  }
  if (root.schemaVersion !== 1) {
    throw new CredentialStoreError('UNSUPPORTED_VERSION', '不支持的本地凭证文件版本')
  }
  return validateCredentialState({
    schemaVersion: 1,
    records: root.records as Record<string, StoredCredentialRecord>,
  })
}

function validateCredentialState(state: CredentialFileState): CredentialFileState {
  if (
    state.schemaVersion !== 1 ||
    !state.records ||
    typeof state.records !== 'object' ||
    Array.isArray(state.records)
  ) {
    throw new CredentialStoreError('INVALID_FILE', '本地凭证文件结构无效')
  }
  const entries = Object.entries(state.records)
  if (entries.length > MAX_RECORDS) {
    throw new CredentialStoreError('INVALID_FILE', '本地凭证记录数量超过限制')
  }
  const records: Record<string, StoredCredentialRecord> = Object.create(null)
  for (const [rawId, rawRecord] of entries) {
    if (DANGEROUS_KEYS.has(rawId)) {
      throw new CredentialStoreError('INVALID_FILE', '本地凭证文件包含危险键名')
    }
    let id: string
    try {
      id = parseCredentialId(rawId)
    } catch {
      throw new CredentialStoreError('INVALID_FILE', `本地凭证 ID 无效: ${rawId}`)
    }
    if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
      throw new CredentialStoreError('INVALID_FILE', `本地凭证记录无效: ${id}`)
    }
    const record = rawRecord as Partial<StoredCredentialRecord>
    if (
      Object.keys(record).some((key) => key !== 'kind' && key !== 'fields' && key !== 'updatedAt')
    ) {
      throw new CredentialStoreError('INVALID_FILE', `本地凭证记录包含未知字段: ${id}`)
    }
    if (typeof record.kind !== 'string' || !VALID_KINDS.has(record.kind as CredentialKind)) {
      throw new CredentialStoreError('INVALID_FILE', `本地凭证类型无效: ${id}`)
    }
    if (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) {
      throw new CredentialStoreError('INVALID_FILE', `本地凭证字段无效: ${id}`)
    }
    const fieldEntries = Object.entries(record.fields)
    if (fieldEntries.length === 0 || fieldEntries.length > MAX_FIELDS) {
      throw new CredentialStoreError('INVALID_FILE', `本地凭证字段数量无效: ${id}`)
    }
    const fields: Record<string, string> = Object.create(null)
    for (const [rawField, rawValue] of fieldEntries) {
      let field: string
      try {
        field = parseCredentialFieldName(rawField)
      } catch {
        throw new CredentialStoreError('INVALID_FILE', `本地凭证字段名无效: ${id}`)
      }
      if (
        typeof rawValue !== 'string' ||
        rawValue.length === 0 ||
        rawValue.length > MAX_FIELD_LENGTH
      ) {
        throw new CredentialStoreError('INVALID_FILE', `本地凭证字段值无效: ${id}.${field}`)
      }
      fields[field] = rawValue
    }
    if (typeof record.updatedAt !== 'string' || !isIsoDate(record.updatedAt)) {
      throw new CredentialStoreError('INVALID_FILE', `本地凭证更新时间无效: ${id}`)
    }
    records[id] = {
      kind: record.kind as CredentialKind,
      fields,
      updatedAt: record.updatedAt,
    }
  }
  return { schemaVersion: 1, records }
}

function emptyState(): CredentialFileState {
  return { schemaVersion: 1, records: Object.create(null) }
}

function cloneState(state: CredentialFileState): CredentialFileState {
  return {
    schemaVersion: 1,
    records: Object.fromEntries(
      Object.entries(state.records).map(([id, record]) => [
        id,
        { ...record, fields: { ...record.fields } },
      ]),
    ),
  }
}

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function isIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
