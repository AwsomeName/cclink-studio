import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { SettingsSecretKey } from '../../shared/ipc/settings'

export type { SettingsSecretKey } from '../../shared/ipc/settings'

export interface SettingsSecrets {
  apiKey: string
  meshyApiKey: string
}

interface SecretCrypto {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}

interface SettingsCredentialState {
  version: 1
  secrets: SettingsSecrets
}

const EMPTY_SECRETS: SettingsSecrets = {
  apiKey: '',
  meshyApiKey: '',
}

export class SettingsCredentialStoreError extends Error {
  constructor(
    readonly code: 'ENCRYPTION_UNAVAILABLE' | 'INVALID_SECRET' | 'READ_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SettingsCredentialStoreError'
  }
}

export class SettingsCredentialStore {
  private readonly filePath: string
  private readonly crypto: SecretCrypto
  private secrets: SettingsSecrets = { ...EMPTY_SECRETS }
  private loaded = false
  private pendingMutation: Promise<void> = Promise.resolve()

  constructor(filename = 'settings/secrets.enc', crypto: SecretCrypto = safeStorage) {
    this.filePath = join(app.getPath('userData'), filename)
    this.crypto = crypto
  }

  async load(): Promise<void> {
    try {
      const encryptedBase64 = await readFile(this.filePath, 'utf-8')
      if (!this.isEncryptionAvailable()) {
        throw new SettingsCredentialStoreError(
          'ENCRYPTION_UNAVAILABLE',
          '本机加密存储不可用，无法读取设置凭证',
        )
      }
      const plaintext = this.crypto.decryptString(Buffer.from(encryptedBase64, 'base64'))
      this.secrets = parseState(JSON.parse(plaintext)).secrets
      this.loaded = true
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.secrets = { ...EMPTY_SECRETS }
        this.loaded = true
      } else if (error instanceof SettingsCredentialStoreError) {
        throw error
      } else {
        throw new SettingsCredentialStoreError(
          'READ_FAILED',
          '设置凭证读取失败',
          error instanceof Error ? { cause: error } : undefined,
        )
      }
    }
  }

  isEncryptionAvailable(): boolean {
    if (!this.crypto.isEncryptionAvailable()) return false
    return this.crypto.getSelectedStorageBackend?.() !== 'basic_text'
  }

  async getAll(): Promise<SettingsSecrets> {
    await this.ensureLoaded()
    return { ...this.secrets }
  }

  async setSecret(key: SettingsSecretKey, value: string): Promise<void> {
    await this.setSecrets({ [key]: value })
  }

  async setSecrets(values: Partial<SettingsSecrets>): Promise<void> {
    await this.enqueueMutation(async () => {
      await this.ensureLoaded()
      const next = { ...this.secrets }
      for (const key of Object.keys(values) as SettingsSecretKey[]) {
        next[key] = normalizeSecret(values[key])
      }
      await this.save(next)
    })
  }

  async clearSecret(key: SettingsSecretKey): Promise<void> {
    await this.setSecrets({ [key]: '' })
  }

  async clear(): Promise<void> {
    await this.enqueueMutation(async () => {
      this.secrets = { ...EMPTY_SECRETS }
      this.loaded = true
      await rm(this.filePath, { force: true })
    })
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  private async save(secrets: SettingsSecrets): Promise<void> {
    if (!this.isEncryptionAvailable()) {
      throw new SettingsCredentialStoreError(
        'ENCRYPTION_UNAVAILABLE',
        '本机加密存储不可用，拒绝明文保存设置凭证',
      )
    }
    const state: SettingsCredentialState = { version: 1, secrets }
    await mkdir(dirname(this.filePath), { recursive: true })
    const encrypted = this.crypto.encryptString(JSON.stringify(state))
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, encrypted.toString('base64'), {
        encoding: 'utf-8',
        mode: 0o600,
      })
      await rename(temporaryPath, this.filePath)
      await chmod(this.filePath, 0o600)
    } finally {
      await rm(temporaryPath, { force: true })
    }
    this.secrets = { ...secrets }
    this.loaded = true
  }

  private async enqueueMutation(operation: () => Promise<void>): Promise<void> {
    const next = this.pendingMutation.catch(() => undefined).then(operation)
    this.pendingMutation = next
    await next
  }
}

function parseState(value: unknown): SettingsCredentialState {
  if (!value || typeof value !== 'object') {
    throw new SettingsCredentialStoreError('READ_FAILED', '设置凭证文件格式无效')
  }
  const state = value as Partial<SettingsCredentialState>
  if (state.version !== 1 || !state.secrets || typeof state.secrets !== 'object') {
    throw new SettingsCredentialStoreError('READ_FAILED', '设置凭证文件格式无效')
  }
  return {
    version: 1,
    secrets: {
      apiKey: normalizeStoredSecret(state.secrets.apiKey),
      meshyApiKey: normalizeStoredSecret(state.secrets.meshyApiKey),
    },
  }
}

function normalizeSecret(value: string | undefined): string {
  if (typeof value !== 'string') {
    throw new SettingsCredentialStoreError('INVALID_SECRET', '设置凭证必须是字符串')
  }
  const normalized = value.trim()
  if (normalized.length > 8192) {
    throw new SettingsCredentialStoreError('INVALID_SECRET', '设置凭证长度超过限制')
  }
  return normalized
}

function normalizeStoredSecret(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) {
    throw new SettingsCredentialStoreError('READ_FAILED', '设置凭证文件格式无效')
  }
  return value
}
