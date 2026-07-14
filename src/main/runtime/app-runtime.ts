import type { BrowserWindow } from 'electron'
import type { BrowserManager } from '../browser/browser-manager'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import type { BrowserDownloadStore } from '../browser/browser-download-store'
import type { BrowserInstanceStore } from '../persistence/browser-instance-store'
import type { PlaywrightBridge } from '../playwright/playwright-bridge'
import type { AgentBridge } from '../agent/agent-bridge'
import type { McpToolHost } from '../mcp/tool-host'
import type { PermissionManager } from '../mcp/permission'
import type { McpClientManager } from '../mcp/client-manager'
import type { TokenManager } from '../auth/token-manager'
import type { AuthService } from '../auth/auth-service'
import type { LocalIdentityService } from '../identity/local-identity-service'
import type { EditorToolModule } from '../mcp/modules/editor'
import type { AdbBridge } from '../android/adb-bridge'
import type { AgentDeviceManager } from '../android/agent-device-manager'
import type { ActiveDeviceManager } from '../android/active-device-manager'
import type { PhysicalDeviceManager } from '../android/physical-device-manager'
import type { ScrcpyBridge } from '../android/scrcpy-bridge'
import type { SyncService } from '../sync/sync-service'
import type { SyncCredentialStore } from '../sync/sync-credential-store'
import type { SubscriptionService } from '../subscription/subscription-service'
import type { SettingsService } from '../settings/settings-service'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import type { MeshyService } from '../meshy/meshy-service'
import type { ProjectOpsService } from '../project-ops/project-ops-service'
import type { CclinkStore } from '../cclink/cclink-store'
import type { CclinkIdentityStore } from '../cclink/cclink-identity-store'
import type { CclinkIdentityService } from '../cclink/cclink-identity-service'
import type { CclinkRequestRouter } from '../cclink/cclink-request-router'
import type { CclinkProtocolRouter } from '../cclink/cclink-protocol-router'
import type { CclinkRealtimeBridge } from '../cclink/cclink-realtime-bridge'
import type { CclinkRealtimeService } from '../cclink/cclink-realtime-service'
import type { CclinkTimTransport } from '../cclink/cclink-tim-transport'
import type { CclinkFileService } from '../cclink/cclink-file-service'
import type { TerminalAuditStore } from '../terminal/terminal-audit-store'
import type { TerminalConfirmationService } from '../terminal/terminal-confirmation-service'
import type { TerminalSessionRegistry } from '../terminal/terminal-session-registry'
import type { TerminalCommandOrchestrator } from '../terminal/terminal-command-orchestrator'

export interface DeepInkRuntimeState {
  isDev: boolean
  mainWindow: BrowserWindow | null
  browserManager: BrowserManager | null
  browserTaskRuntime: BrowserTaskRuntime | null
  browserDownloadStore: BrowserDownloadStore | null
  browserInstanceStore: BrowserInstanceStore | null
  playwrightBridge: PlaywrightBridge | null
  agentBridge: AgentBridge | null
  toolHost: McpToolHost | null
  permissionManager: PermissionManager | null
  mcpClientMgr: McpClientManager | null
  tokenManager: TokenManager | null
  authService: AuthService | null
  localIdentityService: LocalIdentityService | null
  editorModule: EditorToolModule | null
  adbBridge: AdbBridge | null
  activeDeviceManager: ActiveDeviceManager | null
  physicalDeviceManager: PhysicalDeviceManager | null
  agentDeviceManager: AgentDeviceManager | null
  scrcpyBridge: ScrcpyBridge | null
  syncService: SyncService | null
  syncCredentialStore: SyncCredentialStore | null
  subscriptionService: SubscriptionService | null
  settingsService: SettingsService | null
  workspaceStateService: WorkspaceStateService | null
  meshyService: MeshyService | null
  projectOpsService: ProjectOpsService | null
  cclinkStore: CclinkStore | null
  cclinkIdentityStore: CclinkIdentityStore | null
  cclinkIdentityService: CclinkIdentityService | null
  cclinkRequestRouter: CclinkRequestRouter | null
  cclinkProtocolRouter: CclinkProtocolRouter | null
  cclinkRealtimeBridge: CclinkRealtimeBridge | null
  cclinkRealtimeService: CclinkRealtimeService | null
  cclinkTimTransport: CclinkTimTransport | null
  cclinkFileService: CclinkFileService | null
  terminalAuditStore: TerminalAuditStore | null
  terminalConfirmationService: TerminalConfirmationService | null
  terminalSessionRegistry: TerminalSessionRegistry | null
  terminalCommandOrchestrator: TerminalCommandOrchestrator | null
}

export function createRuntimeState(isDev: boolean): DeepInkRuntimeState {
  return {
    isDev,
    mainWindow: null,
    browserManager: null,
    browserTaskRuntime: null,
    browserDownloadStore: null,
    browserInstanceStore: null,
    playwrightBridge: null,
    agentBridge: null,
    toolHost: null,
    permissionManager: null,
    mcpClientMgr: null,
    tokenManager: null,
    authService: null,
    localIdentityService: null,
    editorModule: null,
    adbBridge: null,
    activeDeviceManager: null,
    physicalDeviceManager: null,
    agentDeviceManager: null,
    scrcpyBridge: null,
    syncService: null,
    syncCredentialStore: null,
    subscriptionService: null,
    settingsService: null,
    workspaceStateService: null,
    meshyService: null,
    projectOpsService: null,
    cclinkStore: null,
    cclinkIdentityStore: null,
    cclinkIdentityService: null,
    cclinkRequestRouter: null,
    cclinkProtocolRouter: null,
    cclinkRealtimeBridge: null,
    cclinkRealtimeService: null,
    cclinkTimTransport: null,
    cclinkFileService: null,
    terminalAuditStore: null,
    terminalConfirmationService: null,
    terminalSessionRegistry: null,
    terminalCommandOrchestrator: null,
  }
}
