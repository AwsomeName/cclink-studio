/**
 * SettingsService — 应用设置持久化服务
 *
 * 将 AppSettings 保存到 {userData}/settings.json。
 * 参照 SyncService 的 JSON 文件读写模式。
 */

import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { DEFAULT_SETTINGS, type AppSettings } from './types'
import {
  SettingsCredentialStore,
  type SettingsSecretKey,
  type SettingsSecrets,
} from './settings-credential-store'
import type { SettingsSecretStatus } from '../../shared/ipc/settings'

/** AppSettings 的合法 key 集合，用于过滤 IPC 传入的未知字段 */
const SETTINGS_KEYS = new Set<string>(Object.keys(DEFAULT_SETTINGS))
const SECRET_KEYS = new Set<string>(['apiKey', 'meshyApiKey'])
const EMPTY_SECRETS: SettingsSecrets = { apiKey: '', meshyApiKey: '' }

/** 每个 key 的合法值集合（用于校验 IPC 传入的数据；数值/字符串字段不在此列） */
const VALID_VALUES: Record<string, Set<string>> = {
  backendType: new Set<string>(['claude-code', 'http-api']),
  permissionMode: new Set<string>(['auto', 'categorized', 'strict']),
  defaultZoomMode: new Set<string>(['fit', 'manual']),
  defaultDeviceMode: new Set<string>(['desktop', 'mobile']),
  agentEngine: new Set<string>(['local-claude-code']),
  provider: new Set<string>([
    'anthropic',
    'deepseek',
    'glm',
    'qwen',
    'moonshot',
    'siliconflow',
    'openai',
    'custom',
  ]),
  apiFormat: new Set<string>(['anthropic', 'openai']),
  cadBackend: new Set<string>(['none', 'local-freecad', 'managed-freecad', 'occt-experimental']),
}

export class SettingsService {
  private storeFilePath: string
  private store: AppSettings
  private secrets: SettingsSecrets = { ...EMPTY_SECRETS }
  private migrationBlocked = false
  private readonly credentialStore: SettingsCredentialStore

  constructor(credentialStore = new SettingsCredentialStore()) {
    this.storeFilePath = join(app.getPath('userData'), 'settings.json')
    this.store = { ...DEFAULT_SETTINGS }
    this.credentialStore = credentialStore
  }

  /**
   * 从磁盘加载设置
   *
   * 合并策略：以 DEFAULT_SETTINGS 为基底，用文件中读到的值覆盖。
   * 这样未来新增字段时，旧文件不会缺少新字段的值。
   */
  async loadState(): Promise<void> {
    let parsed: Record<string, unknown> = {}
    let settingsFileExists = false
    try {
      const raw = await readFile(this.storeFilePath, 'utf-8')
      const value: unknown = JSON.parse(raw)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>
        settingsFileExists = true
      }
    } catch (err: unknown) {
      const isEnoent =
        err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
      if (!isEnoent) {
        console.warn('[SettingsService] 设置文件读取失败，使用默认值:', err)
      }
    }

    this.store = { ...DEFAULT_SETTINGS }
    this.applyPersistedSettings(parsed)

    const legacySecrets = extractLegacySecrets(parsed)
    const hasLegacySecretFields = Object.keys(parsed).some((key) => SECRET_KEYS.has(key))
    try {
      await this.credentialStore.load()
      const encryptedSecrets = await this.credentialStore.getAll()
      const mergedSecrets: SettingsSecrets = {
        apiKey: encryptedSecrets.apiKey || legacySecrets.apiKey,
        meshyApiKey: encryptedSecrets.meshyApiKey || legacySecrets.meshyApiKey,
      }
      if (hasAnySecret(legacySecrets)) {
        await this.credentialStore.setSecrets(mergedSecrets)
      }
      this.secrets = mergedSecrets
      this.migrationBlocked = false
      if (settingsFileExists && hasLegacySecretFields) {
        await this.saveState()
        console.log('[SettingsService] 旧版明文凭证已迁移到系统加密存储')
      }
    } catch (error) {
      this.secrets = legacySecrets
      this.migrationBlocked = hasAnySecret(legacySecrets)
      console.warn(
        '[SettingsService] 加密凭证加载或迁移失败，已保留旧配置且不会覆盖:',
        error instanceof Error ? error.message : String(error),
      )
    }

    console.log('[SettingsService] 设置已加载')
  }

  /** 保存当前设置到磁盘 */
  private async saveState(settings: AppSettings = this.store): Promise<void> {
    if (this.migrationBlocked) {
      throw new Error('系统加密存储不可用，旧版明文凭证尚未迁移，拒绝覆盖设置文件')
    }
    const json = JSON.stringify(withoutSecrets(settings), null, 2)
    await writeFile(this.storeFilePath, json, 'utf-8')
  }

  /** 获取所有设置（浅拷贝） */
  getAll(): AppSettings {
    return { ...this.store, ...EMPTY_SECRETS }
  }

  /** 仅供主进程服务使用，禁止通过 IPC 暴露。 */
  getRuntimeSettings(): AppSettings {
    return { ...this.store, ...this.secrets }
  }

  getSecretStatus(): SettingsSecretStatus {
    return {
      apiKeyConfigured: this.secrets.apiKey.length > 0,
      meshyApiKeyConfigured: this.secrets.meshyApiKey.length > 0,
      encryptionAvailable: this.credentialStore.isEncryptionAvailable(),
      migrationBlocked: this.migrationBlocked,
    }
  }

  async setSecret(key: SettingsSecretKey, value: string): Promise<SettingsSecretStatus> {
    const next = { ...this.secrets, [key]: value }
    await this.credentialStore.setSecrets(next)
    this.secrets = await this.credentialStore.getAll()
    this.migrationBlocked = false
    await this.saveState()
    return this.getSecretStatus()
  }

  async clearSecret(key: SettingsSecretKey): Promise<SettingsSecretStatus> {
    const next = { ...this.secrets, [key]: '' }
    await this.credentialStore.setSecrets(next)
    this.secrets = await this.credentialStore.getAll()
    this.migrationBlocked = false
    await this.saveState()
    return this.getSecretStatus()
  }

  /**
   * 更新部分设置并持久化
   *
   * @param partial - 要更新的字段
   * @returns 更新后的完整设置
   */
  async set(partial: Partial<AppSettings>): Promise<AppSettings> {
    if (Object.keys(partial).some((key) => SECRET_KEYS.has(key))) {
      throw new Error('敏感设置必须通过专用凭证接口更新')
    }
    // 只保留合法 key + 合法值，过滤掉 IPC 传入的无关字段和无效值
    const filtered: Partial<AppSettings> = {}
    for (const key of Object.keys(partial)) {
      if (!SETTINGS_KEYS.has(key)) continue
      const val = (partial as Record<string, unknown>)[key]
      if (key === 'disabledAgentToolModules') {
        ;(filtered as unknown as Record<string, unknown>)[key] = normalizeModuleIds(val)
        continue
      }
      // 对有枚举约束的字段做值校验；数值字段（如 maxBudgetUsd）跳过枚举检查
      const validSet = VALID_VALUES[key]
      if (validSet && typeof val === 'string' && !validSet.has(val)) {
        console.warn(`[SettingsService] 忽略无效值: ${key}=${val}`)
        continue
      }
      ;(filtered as Record<string, unknown>)[key] = val
    }
    const nextStore = { ...this.store, ...filtered }
    await this.saveState(nextStore)
    this.store = nextStore
    return this.getAll()
  }

  /**
   * 恢复所有设置到默认值
   *
   * @returns 默认设置
   */
  async reset(): Promise<AppSettings> {
    await this.credentialStore.clear()
    this.secrets = { ...EMPTY_SECRETS }
    this.migrationBlocked = false
    const nextStore = { ...DEFAULT_SETTINGS }
    await this.saveState(nextStore)
    this.store = nextStore
    return this.getAll()
  }

  /**
   * 重置单个设置到默认值
   *
   * @param key - 要重置的设置 key
   * @returns 更新后的完整设置
   */
  async resetKey(key: keyof AppSettings): Promise<AppSettings> {
    if (!SETTINGS_KEYS.has(key)) {
      throw new Error(`Unknown setting key: ${key}`)
    }
    if (SECRET_KEYS.has(key)) {
      await this.clearSecret(key as SettingsSecretKey)
      return this.getAll()
    }
    const nextStore = { ...this.store, [key]: DEFAULT_SETTINGS[key] }
    await this.saveState(nextStore)
    this.store = nextStore
    return this.getAll()
  }

  private applyPersistedSettings(parsed: Record<string, unknown>): void {
    for (const key of Object.keys(parsed)) {
      if (!SETTINGS_KEYS.has(key) || SECRET_KEYS.has(key)) continue
      const val = parsed[key]
      if (key === 'disabledAgentToolModules') {
        this.store.disabledAgentToolModules = normalizeModuleIds(val)
        continue
      }
      const validSet = VALID_VALUES[key]
      if (validSet && typeof val === 'string' && !validSet.has(val)) {
        console.warn(`[SettingsService] 加载配置时忽略无效值: ${key}=${val}`)
        continue
      }
      ;(this.store as unknown as Record<string, unknown>)[key] = val
    }
  }
}

function extractLegacySecrets(parsed: Record<string, unknown>): SettingsSecrets {
  return {
    apiKey: normalizeLegacySecret(parsed.apiKey),
    meshyApiKey: normalizeLegacySecret(parsed.meshyApiKey),
  }
}

function normalizeLegacySecret(value: unknown): string {
  return typeof value === 'string' && value.length <= 8192 ? value.trim() : ''
}

function hasAnySecret(secrets: SettingsSecrets): boolean {
  return secrets.apiKey.length > 0 || secrets.meshyApiKey.length > 0
}

function withoutSecrets(settings: AppSettings): Omit<AppSettings, SettingsSecretKey> {
  const { apiKey: _apiKey, meshyApiKey: _meshyApiKey, ...persisted } = settings
  return persisted
}

function normalizeModuleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
    ),
  )
}
