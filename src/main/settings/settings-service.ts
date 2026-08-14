/**
 * SettingsService — 应用设置持久化服务
 *
 * 将 AppSettings 保存到 {userData}/settings.json。
 * 参照 SyncService 的 JSON 文件读写模式。
 */

import { app } from 'electron'
import { join } from 'path'
import { readFile, rename, unlink, writeFile } from 'fs/promises'
import {
  DEFAULT_SETTINGS,
  MANAGED_CLAUDE_RUNTIME_VERSION,
  normalizeClaudeRuntimeSettingsUpdate,
  type AppSettings,
} from './types'
import type { SettingsSecretKey } from '../../shared/ipc/settings'
import type { SettingsSecretStatus } from '../../shared/ipc/settings'
import { CredentialService } from '../credentials/credential-service'
import type { AgentRoleRef } from '../../shared/agent-role'
import { normalizeKeybindingOverrides } from '../../shared/keybindings'

/** AppSettings 的合法 key 集合，用于过滤 IPC 传入的未知字段 */
const SETTINGS_KEYS = new Set<string>(Object.keys(DEFAULT_SETTINGS))
const SECRET_KEYS = new Set<string>(['apiKey', 'meshyApiKey'])
const EMPTY_SECRETS = { apiKey: '', meshyApiKey: '' }
const AGENT_CREDENTIAL_ID = 'agent:default'
const MESHY_CREDENTIAL_ID = 'extension:meshy:default'

/** 每个 key 的合法值集合（用于校验 IPC 传入的数据；数值/字符串字段不在此列） */
const VALID_VALUES: Record<string, Set<string>> = {
  updateTrack: new Set<string>(['stable', 'beta']),
  backendType: new Set<string>(['claude-code', 'http-api']),
  permissionMode: new Set<string>(['auto', 'categorized', 'strict']),
  defaultZoomMode: new Set<string>(['fit', 'manual']),
  defaultDeviceMode: new Set<string>(['desktop', 'mobile']),
  agentEngine: new Set<string>(['local-claude-code']),
  claudeRuntimeSource: new Set<string>(['bundled', 'managed', 'system', 'custom']),
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
  private migrationBlocked = false
  private writeQueue: Promise<void> = Promise.resolve()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly credentialService: CredentialService) {
    this.storeFilePath = join(app.getPath('userData'), 'settings.json')
    this.store = { ...DEFAULT_SETTINGS }
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

    const needsClaudeRuntimeMigration =
      settingsFileExists &&
      (typeof parsed.claudeRuntimeSource !== 'string' || parsed.claudeRuntimeSource === 'bundled')

    this.store = { ...DEFAULT_SETTINGS }
    this.applyPersistedSettings(parsed)
    this.migrateClaudeRuntimeSelection(parsed)
    const needsComponentSetupMigration =
      settingsFileExists && typeof parsed.componentSetupPageSeenVersion !== 'number'
    if (needsComponentSetupMigration) {
      // 已有安装升级时不冒充“首次安装”；只有真正没有 settings.json 的新安装显示引导页。
      this.store.componentSetupPageSeenVersion = 1
    }

    const legacySecrets = extractLegacySecrets(parsed)
    const hasLegacySecretFields = Object.keys(parsed).some((key) => SECRET_KEYS.has(key))
    try {
      await this.credentialService.ensureLoaded()
      if (legacySecrets.apiKey) {
        await this.credentialService.setCredential({
          id: AGENT_CREDENTIAL_ID,
          kind: 'api-key',
          fields: { apiKey: legacySecrets.apiKey },
        })
      }
      if (legacySecrets.meshyApiKey) {
        await this.credentialService.setCredential({
          id: MESHY_CREDENTIAL_ID,
          kind: 'api-key',
          fields: { apiKey: legacySecrets.meshyApiKey },
        })
      }
      this.migrationBlocked = false
      if (
        settingsFileExists &&
        (hasLegacySecretFields || needsClaudeRuntimeMigration || needsComponentSetupMigration)
      ) {
        await this.saveState()
        if (hasLegacySecretFields) {
          console.log('[SettingsService] 旧版明文凭证已迁移到统一本地凭证文件')
        }
        if (needsClaudeRuntimeMigration) {
          console.log('[SettingsService] Claude Code 运行时来源设置已迁移')
        }
        if (needsComponentSetupMigration) {
          console.log('[SettingsService] 已有安装的组件配置页状态已迁移')
        }
      }
    } catch (error) {
      this.migrationBlocked = hasAnySecret(legacySecrets)
      console.warn(
        '[SettingsService] 本地凭证加载或迁移失败，已保留旧配置且不会覆盖:',
        error instanceof Error ? error.message : String(error),
      )
    }

    console.log('[SettingsService] 设置已加载')
  }

  /** 保存当前设置到磁盘 */
  private async saveState(settings: AppSettings = this.store): Promise<void> {
    if (this.migrationBlocked) {
      throw new Error('本地凭证文件不可用，旧版明文凭证尚未迁移，拒绝覆盖设置文件')
    }
    const json = JSON.stringify(withoutSecrets(settings), null, 2)
    const write = this.writeQueue.then(async () => {
      const temporaryPath = `${this.storeFilePath}.tmp-${process.pid}-${Date.now()}`
      try {
        await writeFile(temporaryPath, json, { encoding: 'utf-8', mode: 0o600 })
        await rename(temporaryPath, this.storeFilePath)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        throw error
      }
    })
    this.writeQueue = write.catch(() => undefined)
    await write
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** 获取所有设置（浅拷贝） */
  getAll(): AppSettings {
    return {
      ...this.store,
      keybindingOverrides: this.store.keybindingOverrides.map((override) => ({
        commandId: override.commandId,
        bindings: override.bindings.map((binding) => ({
          code: binding.code,
          modifiers: [...binding.modifiers],
        })),
      })),
      ...EMPTY_SECRETS,
    }
  }

  /** 仅供主进程服务使用，禁止通过 IPC 暴露。 */
  getRuntimeSettings(): AppSettings {
    return { ...this.store, ...this.getResolvedSecrets() }
  }

  getSecretStatus(): SettingsSecretStatus {
    const status = this.credentialService.getStatus()
    const secrets = this.getResolvedSecrets()
    return {
      apiKeyConfigured: secrets.apiKey.length > 0,
      meshyApiKeyConfigured: secrets.meshyApiKey.length > 0,
      storageAvailable: status.status === 'ready' || status.status === 'conflict',
      migrationBlocked: this.migrationBlocked,
      legacyCredentialsDetected: status.legacyEncryptedFiles.length > 0,
    }
  }

  async setSecret(key: SettingsSecretKey, value: string): Promise<SettingsSecretStatus> {
    const normalized = normalizeLegacySecret(value)
    if (!normalized) throw new Error('凭证不能为空')
    return this.enqueueMutation(async () => {
      await this.credentialService.setCredential({
        id: credentialIdFor(key),
        kind: 'api-key',
        fields: { apiKey: normalized },
      })
      this.migrationBlocked = false
      await this.saveState()
      return this.getSecretStatus()
    })
  }

  async clearSecret(key: SettingsSecretKey): Promise<SettingsSecretStatus> {
    return this.enqueueMutation(async () => {
      await this.credentialService.removeCredential(credentialIdFor(key))
      this.migrationBlocked = false
      await this.saveState()
      return this.getSecretStatus()
    })
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
      if (key === 'defaultAgentRoleRef') {
        const roleRef = normalizeAgentRoleRef(val)
        if (roleRef) {
          ;(filtered as unknown as Record<string, unknown>)[key] = roleRef
        }
        continue
      }
      if (key === 'keybindingOverrides') {
        ;(filtered as unknown as Record<string, unknown>)[key] = normalizeKeybindingOverrides(val)
        continue
      }
      // 对有枚举约束的字段做值校验；其他数值/字符串字段跳过枚举检查。
      const validSet = VALID_VALUES[key]
      if (validSet && typeof val === 'string' && !validSet.has(val)) {
        console.warn(`[SettingsService] 忽略无效值: ${key}=${val}`)
        continue
      }
      ;(filtered as Record<string, unknown>)[key] = val
    }
    return this.enqueueMutation(async () => {
      const normalized = normalizeClaudeRuntimeSettingsUpdate(this.store, filtered)
      const nextStore = { ...this.store, ...normalized }
      await this.saveState(nextStore)
      this.store = nextStore
      return this.getAll()
    })
  }

  /**
   * 恢复所有设置到默认值
   *
   * @returns 默认设置
   */
  async reset(): Promise<AppSettings> {
    return this.enqueueMutation(async () => {
      await this.credentialService.removeCredential(AGENT_CREDENTIAL_ID)
      await this.credentialService.removeCredential(MESHY_CREDENTIAL_ID)
      this.migrationBlocked = false
      const nextStore = {
        ...DEFAULT_SETTINGS,
        componentSetupPageSeenVersion: this.store.componentSetupPageSeenVersion,
      }
      await this.saveState(nextStore)
      this.store = nextStore
      return this.getAll()
    })
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
    return this.enqueueMutation(async () => {
      const nextStore = { ...this.store, [key]: DEFAULT_SETTINGS[key] }
      await this.saveState(nextStore)
      this.store = nextStore
      return this.getAll()
    })
  }

  private applyPersistedSettings(parsed: Record<string, unknown>): void {
    for (const key of Object.keys(parsed)) {
      if (!SETTINGS_KEYS.has(key) || SECRET_KEYS.has(key)) continue
      const val = parsed[key]
      if (key === 'disabledAgentToolModules') {
        this.store.disabledAgentToolModules = normalizeModuleIds(val)
        continue
      }
      if (key === 'defaultAgentRoleRef') {
        const roleRef = normalizeAgentRoleRef(val)
        if (roleRef) this.store.defaultAgentRoleRef = roleRef
        continue
      }
      if (key === 'keybindingOverrides') {
        this.store.keybindingOverrides = normalizeKeybindingOverrides(val)
        continue
      }
      if (key === 'componentSetupPageSeenVersion') {
        if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 1_000) {
          this.store.componentSetupPageSeenVersion = val
        }
        continue
      }
      if (key === 'claudeManagedVersion') {
        if (typeof val === 'string' && isManagedRuntimeVersion(val)) {
          this.store.claudeManagedVersion = val
        }
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

  private migrateClaudeRuntimeSelection(parsed: Record<string, unknown>): void {
    if (parsed.claudeRuntimeSource === 'bundled') {
      this.store.claudeRuntimeSource = 'managed'
      this.store.claudeManagedVersion = MANAGED_CLAUDE_RUNTIME_VERSION
      this.store.claudeCodePath = ''
      return
    }
    if (typeof parsed.claudeRuntimeSource === 'string') return
    this.store.claudeRuntimeSource = this.store.claudeCodePath.trim() ? 'custom' : 'system'
  }

  private getResolvedSecrets(): typeof EMPTY_SECRETS {
    try {
      return {
        apiKey: this.credentialService.resolveCredential(AGENT_CREDENTIAL_ID)?.apiKey ?? '',
        meshyApiKey: this.credentialService.resolveCredential(MESHY_CREDENTIAL_ID)?.apiKey ?? '',
      }
    } catch {
      return { ...EMPTY_SECRETS }
    }
  }
}

function isManagedRuntimeVersion(value: string): boolean {
  return /^$|^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) && value.length <= 64
}

function normalizeAgentRoleRef(value: unknown): AgentRoleRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as { roleId?: unknown; version?: unknown }
  if (
    typeof candidate.roleId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(candidate.roleId) ||
    typeof candidate.version !== 'number' ||
    !Number.isInteger(candidate.version) ||
    candidate.version < 1 ||
    candidate.version > 1_000_000
  ) {
    return null
  }
  return { roleId: candidate.roleId, version: candidate.version }
}

function extractLegacySecrets(parsed: Record<string, unknown>): typeof EMPTY_SECRETS {
  return {
    apiKey: normalizeLegacySecret(parsed.apiKey),
    meshyApiKey: normalizeLegacySecret(parsed.meshyApiKey),
  }
}

function normalizeLegacySecret(value: unknown): string {
  return typeof value === 'string' && value.length <= 8192 ? value.trim() : ''
}

function hasAnySecret(secrets: typeof EMPTY_SECRETS): boolean {
  return secrets.apiKey.length > 0 || secrets.meshyApiKey.length > 0
}

function withoutSecrets(settings: AppSettings): Omit<AppSettings, SettingsSecretKey> {
  const { apiKey: _apiKey, meshyApiKey: _meshyApiKey, ...persisted } = settings
  return persisted
}

function credentialIdFor(key: SettingsSecretKey): string {
  return key === 'apiKey' ? AGENT_CREDENTIAL_ID : MESHY_CREDENTIAL_ID
}

function normalizeModuleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
    ),
  )
}
