import { z } from 'zod'
import type { AppSettings } from '../settings-constants'

const shortString = z.string().max(4096)
const pathString = z.string().max(32_768)

const settingsUpdateSchema = z
  .object({
    agentEngine: z.literal('local-claude-code'),
    backendType: z.enum(['claude-code', 'http-api']),
    permissionMode: z.enum(['auto', 'categorized', 'strict']),
    disabledAgentToolModules: z.array(z.string().min(1).max(256)).max(128),
    maxBudgetUsd: z.number().finite().min(0).max(10_000),
    claudeCodePath: pathString,
    defaultZoomMode: z.enum(['fit', 'manual']),
    defaultDeviceMode: z.enum(['desktop', 'mobile']),
    provider: z.enum([
      'anthropic',
      'deepseek',
      'glm',
      'qwen',
      'moonshot',
      'siliconflow',
      'openai',
      'custom',
    ]),
    apiFormat: z.enum(['anthropic', 'openai']),
    apiBaseUrl: shortString,
    modelName: shortString,
    cadBackend: z.enum(['none', 'local-freecad', 'managed-freecad', 'occt-experimental']),
    freecadPath: pathString,
    cadCacheEnabled: z.boolean(),
    cadCacheLimitMb: z.number().finite().int().min(128).max(1_048_576),
    editorFontFamily: z.string().max(1024),
    editorFontSize: z.number().finite().min(6).max(96),
    editorTabSize: z.number().finite().int().min(1).max(16),
    editorWordWrap: z.boolean(),
    editorLineNumbers: z.boolean(),
    appZoomLevel: z.number().finite().min(-5).max(5),
    uiFontSize: z.number().finite().min(8).max(48),
    lastWorkspacePath: pathString,
    recentWorkspacePaths: z.array(pathString).max(100),
    gitBackupUsername: z.string().max(256),
    showHiddenFiles: z.boolean(),
  })
  .strict()
  .partial()

const settingsSecretKeySchema = z.enum(['apiKey', 'meshyApiKey'])
const settingsSecretValueSchema = z.string().max(8192)
const settingsKeys = new Set<string>([
  ...settingsUpdateSchema.keyof().options,
  'apiKey',
  'meshyApiKey',
])
const settingsKeySchema = z.custom<keyof AppSettings>(
  (value) => typeof value === 'string' && settingsKeys.has(value),
  'Unknown settings key',
)

export function parseSettingsUpdate(value: unknown): Partial<AppSettings> {
  return settingsUpdateSchema.parse(value) as Partial<AppSettings>
}

export function parseSettingsSecretKey(value: unknown): 'apiKey' | 'meshyApiKey' {
  return settingsSecretKeySchema.parse(value)
}

export function parseSettingsSecretValue(value: unknown): string {
  return settingsSecretValueSchema.parse(value)
}

export function parseSettingsKey(value: unknown): keyof AppSettings {
  return settingsKeySchema.parse(value)
}
