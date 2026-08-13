import { defineIpcCall } from './contract'

export type ManagedClaudeInstallPhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'uninstalling'
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
  | 'COMPONENT_IN_USE'
  | 'INSTALL_FAILED'

export type RuntimeComponentHealth = 'not-installed' | 'healthy' | 'damaged'

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
  updateAvailable: boolean
  health: RuntimeComponentHealth
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
  updateAvailable: boolean
  health: RuntimeComponentHealth
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
  checkManagedClaude(): Promise<ManagedClaudeRuntimeOperationResult>
  installManagedClaude(): Promise<ManagedClaudeRuntimeOperationResult>
  repairManagedClaude(): Promise<ManagedClaudeRuntimeOperationResult>
  uninstallManagedClaude(): Promise<ManagedClaudeRuntimeOperationResult>
  listRuntimeResources(): Promise<RuntimeResourceStatus[]>
  checkRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<RuntimeResourceOperationResult>
  installRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<RuntimeResourceOperationResult>
  repairRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<RuntimeResourceOperationResult>
  uninstallRuntimeResource(
    componentId: RuntimeResourceComponentId,
  ): Promise<RuntimeResourceOperationResult>
}

export const runtimeComponentsIpc = {
  getManagedClaudeStatus: defineIpcCall<[], ManagedClaudeRuntimeStatus>(
    'runtime-components:getManagedClaudeStatus',
  ),
  checkManagedClaude: defineIpcCall<[], ManagedClaudeRuntimeOperationResult>(
    'runtime-components:checkManagedClaude',
  ),
  installManagedClaude: defineIpcCall<[], ManagedClaudeRuntimeOperationResult>(
    'runtime-components:installManagedClaude',
  ),
  repairManagedClaude: defineIpcCall<[], ManagedClaudeRuntimeOperationResult>(
    'runtime-components:repairManagedClaude',
  ),
  uninstallManagedClaude: defineIpcCall<[], ManagedClaudeRuntimeOperationResult>(
    'runtime-components:uninstallManagedClaude',
  ),
  listRuntimeResources: defineIpcCall<[], RuntimeResourceStatus[]>(
    'runtime-components:listRuntimeResources',
  ),
  installRuntimeResource: defineIpcCall<
    [componentId: RuntimeResourceComponentId],
    RuntimeResourceOperationResult
  >('runtime-components:installRuntimeResource'),
  checkRuntimeResource: defineIpcCall<
    [componentId: RuntimeResourceComponentId],
    RuntimeResourceOperationResult
  >('runtime-components:checkRuntimeResource'),
  repairRuntimeResource: defineIpcCall<
    [componentId: RuntimeResourceComponentId],
    RuntimeResourceOperationResult
  >('runtime-components:repairRuntimeResource'),
  uninstallRuntimeResource: defineIpcCall<
    [componentId: RuntimeResourceComponentId],
    RuntimeResourceOperationResult
  >('runtime-components:uninstallRuntimeResource'),
} as const
