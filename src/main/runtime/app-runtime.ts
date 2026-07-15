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
import type { LocalIdentityService } from '../identity/local-identity-service'
import type { EditorToolModule } from '../mcp/modules/editor'
import type { AdbBridge } from '../android/adb-bridge'
import type { AgentDeviceManager } from '../android/agent-device-manager'
import type { ActiveDeviceManager } from '../android/active-device-manager'
import type { PhysicalDeviceManager } from '../android/physical-device-manager'
import type { ScrcpyBridge } from '../android/scrcpy-bridge'
import type { SettingsService } from '../settings/settings-service'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import type { MeshyService } from '../meshy/meshy-service'
import type { ProjectOpsService } from '../project-ops/project-ops-service'
import type { HardwareService } from '../hardware/hardware-service'
import type { CadConversionService } from '../cad/cad-conversion-service'
import type { DataSourceService } from '../data-source/data-source-service'
import type { TerminalAuditStore } from '../terminal/terminal-audit-store'
import type { TerminalConfirmationService } from '../terminal/terminal-confirmation-service'
import type { TerminalSessionRegistry } from '../terminal/terminal-session-registry'
import type { TerminalSessionStore } from '../terminal/terminal-session-store'
import type { TerminalCommandOrchestrator } from '../terminal/terminal-command-orchestrator'
import type { TerminalExecutionAdapter } from '../terminal/terminal-execution-adapter'

export interface CclinkStudioRuntimeState {
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
  localIdentityService: LocalIdentityService | null
  editorModule: EditorToolModule | null
  adbBridge: AdbBridge | null
  activeDeviceManager: ActiveDeviceManager | null
  physicalDeviceManager: PhysicalDeviceManager | null
  agentDeviceManager: AgentDeviceManager | null
  scrcpyBridge: ScrcpyBridge | null
  settingsService: SettingsService | null
  workspaceStateService: WorkspaceStateService | null
  meshyService: MeshyService | null
  projectOpsService: ProjectOpsService | null
  hardwareService: HardwareService | null
  cadConversionService: CadConversionService | null
  dataSourceService: DataSourceService | null
  terminalAuditStore: TerminalAuditStore | null
  terminalConfirmationService: TerminalConfirmationService | null
  terminalSessionRegistry: TerminalSessionRegistry | null
  terminalSessionStore: TerminalSessionStore | null
  terminalCommandOrchestrator: TerminalCommandOrchestrator | null
  terminalExecutionAdapter: TerminalExecutionAdapter | null
}

export function createRuntimeState(isDev: boolean): CclinkStudioRuntimeState {
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
    localIdentityService: null,
    editorModule: null,
    adbBridge: null,
    activeDeviceManager: null,
    physicalDeviceManager: null,
    agentDeviceManager: null,
    scrcpyBridge: null,
    settingsService: null,
    workspaceStateService: null,
    meshyService: null,
    projectOpsService: null,
    hardwareService: null,
    cadConversionService: null,
    dataSourceService: null,
    terminalAuditStore: null,
    terminalConfirmationService: null,
    terminalSessionRegistry: null,
    terminalSessionStore: null,
    terminalCommandOrchestrator: null,
    terminalExecutionAdapter: null,
  }
}
