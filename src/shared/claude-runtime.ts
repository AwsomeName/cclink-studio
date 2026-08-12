import type { ClaudeRuntimeSource } from './settings-constants'

export type { ClaudeRuntimeSource } from './settings-constants'

export type ClaudeRuntimeState = 'ready' | 'degraded' | 'unavailable' | 'failed'

export type ClaudeRuntimeErrorCode =
  | 'BUNDLED_RUNTIME_MISSING'
  | 'BUNDLED_RUNTIME_INTEGRITY_FAILED'
  | 'MANAGED_RUNTIME_MISSING'
  | 'MANAGED_RUNTIME_INTEGRITY_FAILED'
  | 'RUNTIME_ARCH_MISMATCH'
  | 'RUNTIME_NOT_EXECUTABLE'
  | 'RUNTIME_VERSION_MISMATCH'
  | 'SYSTEM_RUNTIME_NOT_FOUND'
  | 'CUSTOM_RUNTIME_INVALID'
  | 'RUNTIME_PROBE_TIMEOUT'
  | 'AUTH_REQUIRED'
  | 'RUNTIME_SWITCH_PENDING'
  | 'RUNTIME_SESSION_INCOMPATIBLE'

export type ClaudeRuntimeSelection =
  | { source: 'bundled' }
  | { source: 'managed'; version: string }
  | { source: 'system' }
  | { source: 'custom'; customPath: string }

export interface BundledClaudeRuntimeManifest {
  schemaVersion: 1
  source: 'anthropic-agent-sdk-platform-package'
  sdkPackage: '@anthropic-ai/claude-agent-sdk'
  sdkVersion: string
  claudeCodePackage: string
  claudeCodeVersion: string
  platform: 'darwin'
  arch: 'arm64' | 'x64'
  executable: 'claude'
  sha256: string
  size: number
}

export interface ResolvedClaudeRuntime {
  source: ClaudeRuntimeSource
  executablePath: string
  claudeCodeVersion: string
  sdkVersion?: string
  fingerprint: string
  integrity: 'manifest-sha256' | 'catalog-sha256' | 'filesystem-probe'
  probedAt: number
}

/** Safe runtime facts exposed to renderer status and copied diagnostics. */
export interface ClaudeRuntimeProvenance {
  source: ClaudeRuntimeSource
  sdkVersion: string | null
  claudeCodeVersion: string
}

export interface ClaudeRuntimeFailure {
  code: ClaudeRuntimeErrorCode
  message: string
}

export type ClaudeRuntimeProbeResult =
  | { success: true; runtime: ResolvedClaudeRuntime }
  | { success: false; failure: ClaudeRuntimeFailure }

export interface ClaudeRuntimeStatus {
  state: ClaudeRuntimeState
  selection: ClaudeRuntimeSelection
  active: ResolvedClaudeRuntime | null
  pending: ClaudeRuntimeSelection | null
  failure: ClaudeRuntimeFailure | null
  generation: number
  updatedAt: number
}
