export type {
  BackendType,
  PermissionMode,
  ZoomMode,
  DeviceMode,
  AgentEngine,
  CadBackend,
  Provider,
  ApiFormat,
  ProviderPreset,
  AppSettings,
} from '../settings-constants'

export { PROVIDER_PRESETS, DEFAULT_SETTINGS, getPresetBaseUrl } from '../settings-constants'

import type { AppSettings } from '../settings-constants'
import { defineIpcCall } from './contract'

export interface SettingsOperationResult {
  success: boolean
  error?: string
  settings?: AppSettings
}

export type SettingsSecretKey = 'apiKey' | 'meshyApiKey'

export interface SettingsSecretStatus {
  apiKeyConfigured: boolean
  meshyApiKeyConfigured: boolean
  encryptionAvailable: boolean
  migrationBlocked: boolean
}

export interface SettingsSecretOperationResult {
  success: boolean
  error?: string
  status?: SettingsSecretStatus
}

export interface ClaudeCodeStatus {
  installed: boolean
  path: string | null
  source: 'configured' | 'known-path' | 'shell-path' | 'spawn-path' | 'not-found'
  error?: string
}

export interface ClaudeCodeDetectionResult {
  success: boolean
  error?: string
  status?: ClaudeCodeStatus
}

export interface SettingsApiContract {
  getAll(): Promise<AppSettings>
  getSecretStatus(): Promise<SettingsSecretStatus>
  set(updates: Partial<AppSettings>): Promise<SettingsOperationResult>
  setSecret(key: SettingsSecretKey, value: string): Promise<SettingsSecretOperationResult>
  clearSecret(key: SettingsSecretKey): Promise<SettingsSecretOperationResult>
  reset(): Promise<SettingsOperationResult>
  resetKey(key: keyof AppSettings): Promise<SettingsOperationResult>
  detectClaudeCode(): Promise<ClaudeCodeDetectionResult>
}

export const settingsIpc = {
  getAll: defineIpcCall<[], AppSettings>('settings:getAll'),
  getSecretStatus: defineIpcCall<[], SettingsSecretStatus>('settings:getSecretStatus'),
  set: defineIpcCall<[Partial<AppSettings>], SettingsOperationResult>('settings:set'),
  setSecret: defineIpcCall<[SettingsSecretKey, string], SettingsSecretOperationResult>(
    'settings:setSecret',
  ),
  clearSecret: defineIpcCall<[SettingsSecretKey], SettingsSecretOperationResult>(
    'settings:clearSecret',
  ),
  reset: defineIpcCall<[], SettingsOperationResult>('settings:reset'),
  resetKey: defineIpcCall<[keyof AppSettings], SettingsOperationResult>('settings:resetKey'),
  detectClaudeCode: defineIpcCall<[], ClaudeCodeDetectionResult>('settings:detectClaudeCode'),
} as const
