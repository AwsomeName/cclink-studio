import { LocalIdentityService } from '../identity/local-identity-service'
import { registerIdentityIpc } from '../identity/identity-ipc'
import { FileService } from '../fs/file-service'
import { registerFsIpc } from '../fs/fs-ipc'
import { ProjectOpsService } from '../project-ops/project-ops-service'
import { registerProjectOpsIpc } from '../project-ops/project-ops-ipc'
import { HardwareService } from '../hardware/hardware-service'
import { registerHardwareIpc } from '../hardware/hardware-ipc'
import { CadConversionService } from '../cad/cad-conversion-service'
import { registerCadIpc } from '../cad/cad-ipc'
import { DataSourceService } from '../data-source/data-source-service'
import { registerDataSourceIpc } from '../data-source/data-source-ipc'
import { MeshyService } from '../meshy/meshy-service'
import { registerMeshyIpc } from '../meshy/meshy-ipc'
import { registerWechatIPC } from '../ipc/wechat-ipc'
import { SettingsService } from '../settings/settings-service'
import { registerSettingsIpc } from '../settings/settings-ipc'
import { PermissionManager } from '../mcp/permission'
import { McpClientManager } from '../mcp/client-manager'
import { registerAgentIpc } from '../ipc/agent-ipc'
import { registerUpdaterIpc } from '../ipc/updater-ipc'
import { WorkspaceStateService } from '../workspace/workspace-state-service'
import { registerWorkspaceStateIpc } from '../workspace/workspace-state-ipc'
import { TerminalAuditStore } from '../terminal/terminal-audit-store'
import { TerminalConfirmationService } from '../terminal/terminal-confirmation-service'
import { TerminalSessionRegistry } from '../terminal/terminal-session-registry'
import { TerminalSessionStore } from '../terminal/terminal-session-store'
import { cleanupTerminalOrphans } from '../terminal/terminal-orphan-cleaner'
import { TerminalCommandOrchestrator } from '../terminal/terminal-command-orchestrator'
import { PtyExecutionAdapter } from '../terminal/terminal-pty-execution-adapter'
import { CompositeTerminalExecutionAdapter } from '../terminal/terminal-composite-execution-adapter'
import { registerTerminalIpc } from '../ipc/terminal-ipc'
import { getAgentCapabilities } from './agent-capabilities'
import type { CclinkStudioRuntimeState } from './app-runtime'

export async function bootstrapStateServices(runtime: CclinkStudioRuntimeState): Promise<void> {
  runtime.settingsService = new SettingsService()
  await runtime.settingsService.loadState()
  console.log('[CCLink Studio] 设置系统已初始化')

  runtime.workspaceStateService = new WorkspaceStateService()
  await runtime.workspaceStateService.loadState()
  registerWorkspaceStateIpc(runtime.workspaceStateService)
  console.log('[CCLink Studio] 工作台状态 IPC 已注册')
}

export async function bootstrapMainProcessServices(runtime: CclinkStudioRuntimeState): Promise<void> {
  if (!runtime.mainWindow || !runtime.settingsService) {
    throw new Error('主窗口或设置系统尚未初始化')
  }

  runtime.localIdentityService = new LocalIdentityService()
  await runtime.localIdentityService.ensureIdentity()
  registerIdentityIpc(runtime.localIdentityService)
  console.log('[CCLink Studio] 本地身份系统已初始化')

  const fileService = new FileService()
  registerFsIpc(fileService, runtime.settingsService)
  console.log('[CCLink Studio] 文件系统 IPC 已注册')

  runtime.projectOpsService = new ProjectOpsService()
  registerProjectOpsIpc(runtime.projectOpsService)
  console.log('[CCLink Studio] 项目运营 IPC 已注册')

  runtime.cadConversionService = new CadConversionService(() => runtime.settingsService!.getAll())
  registerCadIpc(runtime.cadConversionService)
  console.log('[CCLink Studio] CAD 转换 IPC 已注册')

  runtime.hardwareService = new HardwareService(runtime.cadConversionService)
  registerHardwareIpc(runtime.hardwareService)
  console.log('[CCLink Studio] 硬件工作区 IPC 已注册')

  runtime.dataSourceService = new DataSourceService()
  await runtime.dataSourceService.load()
  registerDataSourceIpc(runtime.dataSourceService)
  console.log('[CCLink Studio] 数据源 IPC 已注册')

  runtime.meshyService = new MeshyService(() => runtime.settingsService!.getAll())
  registerMeshyIpc(runtime.meshyService)
  console.log('[CCLink Studio] Meshy 服务已初始化')

  registerWechatIPC()
  console.log('[CCLink Studio] 微信格式转换 IPC 已注册')

  runtime.permissionManager = new PermissionManager(runtime.mainWindow)
  runtime.permissionManager.setMode(runtime.settingsService.getAll().permissionMode)

  runtime.terminalAuditStore = new TerminalAuditStore()
  await runtime.terminalAuditStore.load()
  runtime.terminalSessionStore = new TerminalSessionStore()
  await runtime.terminalSessionStore.load()
  const terminalOrphanSummary = await cleanupTerminalOrphans(runtime.terminalSessionStore)
  if (terminalOrphanSummary.scanned > 0) {
    console.log(
      `[CCLink Studio] Terminal 残留进程清理完成: scanned=${terminalOrphanSummary.scanned}, killed=${terminalOrphanSummary.killed}, missing=${terminalOrphanSummary.missing}, skipped=${terminalOrphanSummary.skipped}, failed=${terminalOrphanSummary.failed}`,
    )
  }
  runtime.terminalConfirmationService = new TerminalConfirmationService(runtime.mainWindow, {
    auditStore: runtime.terminalAuditStore,
  })
  runtime.terminalSessionRegistry = new TerminalSessionRegistry()
  const localTerminalExecutionAdapter = new PtyExecutionAdapter()
  const terminalExecutionAdapter = new CompositeTerminalExecutionAdapter({
    local: localTerminalExecutionAdapter,
  })
  runtime.terminalExecutionAdapter = terminalExecutionAdapter
  runtime.terminalCommandOrchestrator = new TerminalCommandOrchestrator({
    sessionRegistry: runtime.terminalSessionRegistry,
    confirmationService: runtime.terminalConfirmationService,
    executionAdapter: terminalExecutionAdapter,
    auditStore: runtime.terminalAuditStore,
  })
  registerTerminalIpc(
    runtime.terminalConfirmationService,
    runtime.terminalAuditStore,
    runtime.terminalSessionRegistry,
    runtime.terminalCommandOrchestrator,
    terminalExecutionAdapter,
    runtime.mainWindow.webContents,
    runtime.terminalSessionStore,
  )
  console.log('[CCLink Studio] Terminal 确认 IPC 已注册')

  runtime.mcpClientMgr = new McpClientManager()

  registerAgentIpc({
    getAgentBridge: () => runtime.agentBridge,
    getPlaywrightBridge: () => runtime.playwrightBridge,
    getBrowserTaskRuntime: () => runtime.browserTaskRuntime,
    permissionManager: runtime.permissionManager,
    getMcpClientMgr: () => runtime.mcpClientMgr,
    getCapabilities: () => getAgentCapabilities(runtime),
  })

  registerSettingsIpc(runtime.settingsService, runtime.permissionManager, () => runtime.agentBridge)
  console.log('[CCLink Studio] 设置 IPC 已注册')

  registerUpdaterIpc(runtime.mainWindow)
  console.log('[CCLink Studio] 更新检查 IPC 已注册')
}
