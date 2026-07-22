export type {
  BackendType,
  PermissionMode,
  ZoomMode,
  DeviceMode,
  AgentEngine,
  ClaudeRuntimeSource,
  CadBackend,
  Provider,
  ApiFormat,
  ProviderPreset,
  AppSettings,
} from '../settings-constants'

export { PROVIDER_PRESETS, DEFAULT_SETTINGS, getPresetBaseUrl } from '../settings-constants'

import type { AppSettings } from '../settings-constants'
import type {
  ClaudeRuntimeProbeResult,
  ClaudeRuntimeSelection,
  ClaudeRuntimeStatus,
} from '../claude-runtime'
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
  source: 'bundled' | 'configured' | 'known-path' | 'shell-path' | 'spawn-path' | 'not-found'
  error?: string
}

export interface ClaudeRuntimeStatusResult {
  success: boolean
  error?: string
  status?: ClaudeRuntimeStatus
}

export interface ClaudeRuntimeProbeOperationResult {
  success: boolean
  error?: string
  result?: ClaudeRuntimeProbeResult
}

export type ClaudeModelConnectionErrorCode =
  | 'AUTH_REQUIRED'
  | 'API_FORMAT_UNSUPPORTED'
  | 'MODEL_REQUIRED'
  | 'RUNTIME_UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROXY_GATEWAY_ERROR'
  | 'NETWORK_UNAVAILABLE'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_FAILED'

export type ClaudeModelConnectionTestResult =
  | {
      success: true
      message: string
      model: string
      durationMs: number
      totalCostUsd?: number
    }
  | {
      success: false
      code: ClaudeModelConnectionErrorCode
      message: string
      durationMs: number
    }

export interface ClaudeModelConnectionTestOperationResult {
  success: boolean
  error?: string
  result?: ClaudeModelConnectionTestResult
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
  getClaudeRuntimeStatus(): Promise<ClaudeRuntimeStatusResult>
  probeClaudeRuntime(selection: ClaudeRuntimeSelection): Promise<ClaudeRuntimeProbeOperationResult>
  testClaudeModelConnection(
    selection: ClaudeRuntimeSelection,
  ): Promise<ClaudeModelConnectionTestOperationResult>
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
  getClaudeRuntimeStatus: defineIpcCall<[], ClaudeRuntimeStatusResult>(
    'settings:getClaudeRuntimeStatus',
  ),
  probeClaudeRuntime: defineIpcCall<[ClaudeRuntimeSelection], ClaudeRuntimeProbeOperationResult>(
    'settings:probeClaudeRuntime',
  ),
  testClaudeModelConnection: defineIpcCall<
    [ClaudeRuntimeSelection],
    ClaudeModelConnectionTestOperationResult
  >('settings:testClaudeModelConnection'),
} as const
