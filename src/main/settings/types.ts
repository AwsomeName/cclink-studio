/**
 * AppSettings — 主进程设置类型
 *
 * 类型、常量、工具函数统一从 src/shared/settings-constants 导入，
 * 此文件仅做 re-export，保持现有 import 路径兼容。
 */

export type {
  BackendType,
  PermissionMode,
  ZoomMode,
  DeviceMode,
  Provider,
  ApiFormat,
  AgentEngine,
  ClaudeRuntimeSource,
  CadBackend,
  UpdateTrack,
  AppSettings,
  ProviderPreset,
} from '../../shared/settings-constants'

export {
  PROVIDER_PRESETS,
  DEFAULT_SETTINGS,
  MANAGED_CLAUDE_RUNTIME_VERSION,
  getPresetBaseUrl,
  normalizeClaudeRuntimeSettingsUpdate,
} from '../../shared/settings-constants'
