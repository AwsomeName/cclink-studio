import { z } from 'zod'
import type { AppSettings } from '../settings-constants'
import {
  APP_ZOOM_LEVEL_MAX,
  APP_ZOOM_LEVEL_MIN,
  SUPPORTED_AGENT_PROVIDERS,
} from '../settings-constants'
import { MAX_BINDINGS_PER_COMMAND, MAX_KEYBINDING_OVERRIDES } from '../keybindings'

const shortString = z.string().max(4096)
const pathString = z.string().max(32_768)

const settingsUpdateSchema = z
  .object({
    componentSetupPageSeenVersion: z.number().int().min(0).max(1_000),
    updateTrack: z.enum(['stable', 'beta']),
    agentEngine: z.literal('local-claude-code'),
    backendType: z.literal('claude-code'),
    permissionMode: z.enum(['auto', 'categorized', 'strict']),
    disabledAgentToolModules: z.array(z.string().min(1).max(256)).max(128),
    defaultAgentRoleRef: z
      .object({
        roleId: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9._-]+$/),
        version: z.number().int().positive().max(1_000_000),
      })
      .strict(),
    claudeRuntimeSource: z.enum(['bundled', 'managed', 'system', 'custom']),
    claudeCodePath: pathString,
    claudeManagedVersion: z
      .string()
      .max(64)
      .regex(/^$|^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
    codexAcpPath: pathString,
    defaultZoomMode: z.enum(['fit', 'manual']),
    defaultDeviceMode: z.enum(['desktop', 'mobile']),
    provider: z.enum(SUPPORTED_AGENT_PROVIDERS),
    apiFormat: z.literal('anthropic'),
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
    appZoomLevel: z.number().finite().min(APP_ZOOM_LEVEL_MIN).max(APP_ZOOM_LEVEL_MAX),
    uiFontSize: z.number().finite().min(8).max(48),
    recentWorkspacePaths: z.array(pathString).max(100),
    gitBackupUsername: z.string().max(256),
    showHiddenFiles: z.boolean(),
    keybindingOverrides: z
      .array(
        z
          .object({
            commandId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
            bindings: z
              .array(
                z
                  .object({
                    code: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,31}$/),
                    modifiers: z.array(z.enum(['primary', 'control', 'alt', 'shift'])).max(4),
                  })
                  .strict(),
              )
              .max(MAX_BINDINGS_PER_COMMAND),
          })
          .strict(),
      )
      .max(MAX_KEYBINDING_OVERRIDES),
  })
  .strict()
  .partial()

const settingsSecretKeySchema = z.enum(['apiKey', 'codexApiKey', 'meshyApiKey'])
const settingsSecretValueSchema = z.string().max(8192)
const claudeRuntimeSelectionSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('bundled') }).strict(),
  z
    .object({
      source: z.literal('managed'),
      version: z
        .string()
        .min(1)
        .max(64)
        .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
    })
    .strict(),
  z.object({ source: z.literal('system') }).strict(),
  z.object({ source: z.literal('custom'), customPath: pathString }).strict(),
])
const settingsKeys = new Set<string>([
  ...settingsUpdateSchema.keyof().options,
  'apiKey',
  'codexApiKey',
  'meshyApiKey',
])
const settingsKeySchema = z.custom<keyof AppSettings>(
  (value) => typeof value === 'string' && settingsKeys.has(value),
  'Unknown settings key',
)

export function parseSettingsUpdate(value: unknown): Partial<AppSettings> {
  return settingsUpdateSchema.parse(value) as Partial<AppSettings>
}

export function parseSettingsSecretKey(value: unknown): 'apiKey' | 'codexApiKey' | 'meshyApiKey' {
  return settingsSecretKeySchema.parse(value)
}

export function parseSettingsSecretValue(value: unknown): string {
  return settingsSecretValueSchema.parse(value)
}

export function parseSettingsKey(value: unknown): keyof AppSettings {
  return settingsKeySchema.parse(value)
}

export function parseClaudeRuntimeSelection(value: unknown) {
  return claudeRuntimeSelectionSchema.parse(value)
}

export function parseCodexAcpPath(value: unknown): string {
  return pathString.parse(value)
}
