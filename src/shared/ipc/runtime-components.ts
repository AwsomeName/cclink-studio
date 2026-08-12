import { defineIpcCall } from './contract'

export type ManagedClaudeInstallPhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'installed'
  | 'failed'

export type ManagedClaudeInstallErrorCode =
  | 'PLATFORM_UNSUPPORTED'
  | 'DOWNLOAD_FAILED'
  | 'DOWNLOAD_TOO_LARGE'
  | 'PACKAGE_INTEGRITY_FAILED'
  | 'PACKAGE_CONTENT_INVALID'
  | 'BINARY_INTEGRITY_FAILED'
  | 'BINARY_SIGNATURE_FAILED'
  | 'RUNTIME_VERSION_MISMATCH'
  | 'INSTALL_BUSY'
  | 'INSTALL_FAILED'

export interface ManagedClaudeInstallProgress {
  receivedBytes: number
  totalBytes: number | null
  percent: number | null
}

export interface ManagedClaudeInstallFailure {
  code: ManagedClaudeInstallErrorCode
  message: string
}

export interface ManagedClaudeRuntimeStatus {
  componentId: 'claude-runtime'
  platform: string
  arch: string
  supported: boolean
  constrainedVersion: string | null
  availableVersion: string | null
  installedVersions: string[]
  phase: ManagedClaudeInstallPhase
  progress: ManagedClaudeInstallProgress | null
  failure: ManagedClaudeInstallFailure | null
}

export interface ManagedClaudeRuntimeOperationResult {
  success: boolean
  status: ManagedClaudeRuntimeStatus
  error?: string
}

export type RuntimeResourceComponentId =
  | 'occt-runtime'
  | 'scrcpy-server'
  | 'agent-device-android-helpers'

export interface RuntimeResourceStatus {
  componentId: RuntimeResourceComponentId
  displayName: string
  constrainedVersion: string
  availableVersion: string
  installedVersion: string | null
  phase: ManagedClaudeInstallPhase
  activation: 'domain-managed' | 'awaiting-host'
  progress: ManagedClaudeInstallProgress | null
  failure: ManagedClaudeInstallFailure | null
}

export interface RuntimeResourceOperationResult {
  success: boolean
  status: RuntimeResourceStatus
  error?: string
}

export interface RuntimeComponentsApiContract {
  getManagedClaudeStatus(): Promise<ManagedClaudeRuntimeStatus>
  installManagedClaude(): Promise<ManagedClaudeRuntimeOperationResult>
  listRuntimeResources(): Promise<RuntimeResourceStatus[]>
  installRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<RuntimeResourceOperationResult>
}

export const runtimeComponentsIpc = {
  getManagedClaudeStatus: defineIpcCall<[], ManagedClaudeRuntimeStatus>(
    'runtime-components:getManagedClaudeStatus',
  ),
  installManagedClaude: defineIpcCall<[], ManagedClaudeRuntimeOperationResult>(
    'runtime-components:installManagedClaude',
  ),
  listRuntimeResources: defineIpcCall<[], RuntimeResourceStatus[]>(
    'runtime-components:listRuntimeResources',
  ),
  installRuntimeResource: defineIpcCall<
    [componentId: RuntimeResourceComponentId],
    RuntimeResourceOperationResult
  >('runtime-components:installRuntimeResource'),
} as const
