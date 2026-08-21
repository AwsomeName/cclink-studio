import type { BrowserWindow } from 'electron'
import type { BrowserManager } from '../browser/browser-manager'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import type { BrowserDownloadStore } from '../browser/browser-download-store'
import type { BrowserAuthProcessService } from '../browser/browser-auth-process-service'
import type { BrowserInstanceStore } from '../persistence/browser-instance-store'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { AgentBridge } from '../agent/agent-bridge'
import type { ClaudeRuntimeManager } from '../agent/claude-runtime-manager'
import type { McpToolHost } from '../mcp/tool-host'
import type { PermissionManager } from '../mcp/permission'
import type { McpClientManager } from '../mcp/client-manager'
import type { LocalIdentityService } from '../identity/local-identity-service'
import type { EditorToolModule } from '../mcp/modules/editor'
import type { AdbBridge } from '../android/adb-bridge'
import type { AgentDeviceManager } from '../android/agent-device-manager'
import type { ActiveDeviceManager } from '../android/active-device-manager'
import type { PhysicalDeviceManager } from '../android/physical-device-manager'
import type { ScrcpyBridge } from '../android/scrcpy-bridge'
import type { SettingsService } from '../settings/settings-service'
import type { CredentialService } from '../credentials/credential-service'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import type { MeshyService } from '../meshy/meshy-service'
import type { ImageGenerationService } from '../image-generation/image-generation-service'
import type { MarkdownIllustrationService } from '../image-generation/markdown-illustration-service'
import type { UsageLedgerService } from '../usage/usage-ledger-service'
import type { ProjectOpsService } from '../project-ops/project-ops-service'
import type { WebResourceService } from '../web-resources/web-resource-service'
import type { AgentWebResourceLaunchCoordinator } from '../web-resources/agent-web-resource-launch-coordinator'
import type { WebAffairService } from '../web-affairs/web-affair-service'
import type { HardwareService } from '../hardware/hardware-service'
import type { CadConversionService } from '../cad/cad-conversion-service'
import type { DataSourceService } from '../data-source/data-source-service'
import type { TerminalAuditStore } from '../terminal/terminal-audit-store'
import type { TerminalConfirmationService } from '../terminal/terminal-confirmation-service'
import type { TerminalSessionRegistry } from '../terminal/terminal-session-registry'
import type { TerminalSessionStore } from '../terminal/terminal-session-store'
import type { TerminalCommandOrchestrator } from '../terminal/terminal-command-orchestrator'
import type { TerminalExecutionAdapter } from '../terminal/terminal-execution-adapter'
import type { OfficialIntegration } from '../official/official-integration'
import type { GitBackupService } from '../git-backup/git-backup-service'
import type { GitWorkspaceService } from '../git/git-workspace-service'
import type { FileService } from '../fs/file-service'
import type { TrustedRendererRegistry } from '../ipc/trusted-renderer-guard'
import type { UpdateService } from '../update/update-service'
import type { ScheduledTaskService } from '../scheduled-task/scheduled-task-service'
import { RuntimeCapabilityRegistry } from './capability-registry'
import type { ServiceRegistry } from './service-registry'
import type { RendererWorkspaceStateFlushCoordinator } from '../workspace/renderer-workspace-state-flush'
import type { RuntimeComponentManager } from '../runtime-components/runtime-component-manager'
import type { CclinkAuthService } from '../cclink-remote/auth-service'
import type { CclinkRemoteService } from '../cclink-remote/cclink-remote-service'
import type { AgentRoleRegistry } from '../agent/agent-role-registry'
import type { MediaProjectService } from '../media-production/media-project-service'
import type { MediaAssetService } from '../media-production/media-asset-service'
import type { VideoGenerationService } from '../media-production/video-generation-service'
import type { MediaRenderService } from '../media-production/media-render-service'
import type { WorkbenchTabModel } from '../workbench/workbench-tab-model'
import type { WorkbenchWindowService } from '../workbench/workbench-window-service'
import type { BrowserBookmarkModel } from '../workbench/browser-bookmark-model'
import type { BrowserRecoveryHostRegistry } from '../workbench/browser-recovery-host-registry'
import type { DetachableBrowserWindowController } from '../workbench/detachable-browser-window-controller'

export interface CclinkStudioRuntimeState {
  isDev: boolean
  capabilities: RuntimeCapabilityRegistry
  serviceRegistry: ServiceRegistry | null
  mainWindow: BrowserWindow | null
  browserManager: BrowserManager | null
  browserTaskRuntime: BrowserTaskRuntime | null
  browserDownloadStore: BrowserDownloadStore | null
  browserAuthProcessService: BrowserAuthProcessService | null
  browserInstanceStore: BrowserInstanceStore | null
  playwrightBridge: PlaywrightBridge | null
  agentBridge: AgentBridge | null
  agentRoleRegistry: AgentRoleRegistry | null
  claudeRuntimeManager: ClaudeRuntimeManager | null
  runtimeComponentManager: RuntimeComponentManager | null
  toolHost: McpToolHost | null
  permissionManager: PermissionManager | null
  mcpClientMgr: McpClientManager | null
  localIdentityService: LocalIdentityService | null
  fileService: FileService | null
  editorModule: EditorToolModule | null
  adbBridge: AdbBridge | null
  activeDeviceManager: ActiveDeviceManager | null
  physicalDeviceManager: PhysicalDeviceManager | null
  agentDeviceManager: AgentDeviceManager | null
  scrcpyBridge: ScrcpyBridge | null
  settingsService: SettingsService | null
  credentialService: CredentialService | null
  workspaceStateService: WorkspaceStateService | null
  workbenchTabModel: WorkbenchTabModel | null
  workbenchWindowService: WorkbenchWindowService | null
  browserRecoveryHosts: BrowserRecoveryHostRegistry | null
  detachableBrowserWindows: DetachableBrowserWindowController | null
  browserBookmarkModel: BrowserBookmarkModel | null
  meshyService: MeshyService | null
  imageGenerationService: ImageGenerationService | null
  markdownIllustrationService: MarkdownIllustrationService | null
  usageLedgerService: UsageLedgerService | null
  projectOpsService: ProjectOpsService | null
  webResourceService: WebResourceService | null
  agentWebResourceLaunchCoordinator: AgentWebResourceLaunchCoordinator | null
  webAffairService: WebAffairService | null
  hardwareService: HardwareService | null
  cadConversionService: CadConversionService | null
  dataSourceService: DataSourceService | null
  terminalAuditStore: TerminalAuditStore | null
  terminalConfirmationService: TerminalConfirmationService | null
  terminalSessionRegistry: TerminalSessionRegistry | null
  terminalSessionStore: TerminalSessionStore | null
  terminalCommandOrchestrator: TerminalCommandOrchestrator | null
  terminalExecutionAdapter: TerminalExecutionAdapter | null
  officialIntegration: OfficialIntegration | null
  gitWorkspaceService: GitWorkspaceService | null
  gitBackupService: GitBackupService | null
  updateService: UpdateService | null
  updateSnapshotUnsubscribe: (() => void) | null
  scheduledTaskService: ScheduledTaskService | null
  mediaProjectService: MediaProjectService | null
  mediaAssetService: MediaAssetService | null
  videoGenerationService: VideoGenerationService | null
  mediaRenderService: MediaRenderService | null
  mediaProjectIpcUnsubscribe: (() => void) | null
  trustedRendererGuard: TrustedRendererRegistry | null
  rendererWorkspaceStateFlush: RendererWorkspaceStateFlushCoordinator | null
  cclinkAuthService: CclinkAuthService | null
  cclinkRemoteService: CclinkRemoteService | null
  cclinkIpcUnsubscribe: (() => void) | null
}

export function createRuntimeState(isDev: boolean): CclinkStudioRuntimeState {
  return {
    isDev,
    capabilities: new RuntimeCapabilityRegistry(),
    serviceRegistry: null,
    mainWindow: null,
    browserManager: null,
    browserTaskRuntime: null,
    browserDownloadStore: null,
    browserAuthProcessService: null,
    browserInstanceStore: null,
    playwrightBridge: null,
    agentBridge: null,
    agentRoleRegistry: null,
    claudeRuntimeManager: null,
    runtimeComponentManager: null,
    toolHost: null,
    permissionManager: null,
    mcpClientMgr: null,
    localIdentityService: null,
    fileService: null,
    editorModule: null,
    adbBridge: null,
    activeDeviceManager: null,
    physicalDeviceManager: null,
    agentDeviceManager: null,
    scrcpyBridge: null,
    settingsService: null,
    credentialService: null,
    workspaceStateService: null,
    workbenchTabModel: null,
    workbenchWindowService: null,
    browserRecoveryHosts: null,
    detachableBrowserWindows: null,
    browserBookmarkModel: null,
    meshyService: null,
    imageGenerationService: null,
    markdownIllustrationService: null,
    usageLedgerService: null,
    projectOpsService: null,
    webResourceService: null,
    agentWebResourceLaunchCoordinator: null,
    webAffairService: null,
    hardwareService: null,
    cadConversionService: null,
    dataSourceService: null,
    terminalAuditStore: null,
    terminalConfirmationService: null,
    terminalSessionRegistry: null,
    terminalSessionStore: null,
    terminalCommandOrchestrator: null,
    terminalExecutionAdapter: null,
    officialIntegration: null,
    gitWorkspaceService: null,
    gitBackupService: null,
    updateService: null,
    updateSnapshotUnsubscribe: null,
    scheduledTaskService: null,
    mediaProjectService: null,
    mediaAssetService: null,
    videoGenerationService: null,
    mediaRenderService: null,
    mediaProjectIpcUnsubscribe: null,
    trustedRendererGuard: null,
    rendererWorkspaceStateFlush: null,
    cclinkAuthService: null,
    cclinkRemoteService: null,
    cclinkIpcUnsubscribe: null,
  }
}
