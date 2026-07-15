import { TokenManager } from '../auth/token-manager'
import { AuthService } from '../auth/auth-service'
import { registerAuthIpc } from '../auth/auth-ipc'
import { LocalIdentityService } from '../identity/local-identity-service'
import { registerIdentityIpc } from '../identity/identity-ipc'
import { SubscriptionService } from '../subscription/subscription-service'
import { registerSubscriptionIpc } from '../subscription/subscription-ipc'
import { FileService } from '../fs/file-service'
import { registerFsIpc } from '../fs/fs-ipc'
import { ProjectOpsService } from '../project-ops/project-ops-service'
import { registerProjectOpsIpc } from '../project-ops/project-ops-ipc'
import { HardwareService } from '../hardware/hardware-service'
import { registerHardwareIpc } from '../hardware/hardware-ipc'
import { MeshyService } from '../meshy/meshy-service'
import { registerMeshyIpc } from '../meshy/meshy-ipc'
import { registerWechatIPC } from '../ipc/wechat-ipc'
import { SyncCredentialStore } from '../sync/sync-credential-store'
import { SyncService } from '../sync/sync-service'
import { registerSyncIpc } from '../sync/sync-ipc'
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
import { CclinkTerminalExecutionAdapter } from '../terminal/terminal-cclink-execution-adapter'
import { EntitledTerminalExecutionAdapter } from '../terminal/terminal-entitled-execution-adapter'
import { CompositeTerminalExecutionAdapter } from '../terminal/terminal-composite-execution-adapter'
import { registerTerminalIpc } from '../ipc/terminal-ipc'
import { registerRemoteIpc } from '../ipc/remote-ipc'
import { RemoteProviderRegistry } from '../remote/remote-provider-registry'
import { CclinkRemoteProvider } from '../remote/cclink-remote-provider'
import { checkEntitlement } from '../subscription/feature-gate'
import { getAgentCapabilities } from './agent-capabilities'
import type { DeepInkRuntimeState } from './app-runtime'

export async function bootstrapStateServices(runtime: DeepInkRuntimeState): Promise<void> {
  runtime.settingsService = new SettingsService()
  await runtime.settingsService.loadState()
  console.log('[DeepInk] 设置系统已初始化')

  runtime.workspaceStateService = new WorkspaceStateService()
  await runtime.workspaceStateService.loadState()
  registerWorkspaceStateIpc(runtime.workspaceStateService)
  console.log('[DeepInk] 工作台状态 IPC 已注册')
}

export async function bootstrapMainProcessServices(runtime: DeepInkRuntimeState): Promise<void> {
  if (!runtime.mainWindow || !runtime.settingsService) {
    throw new Error('主窗口或设置系统尚未初始化')
  }

  runtime.tokenManager = new TokenManager()
  await runtime.tokenManager.load()
  runtime.authService = new AuthService()
  runtime.localIdentityService = new LocalIdentityService()
  await runtime.localIdentityService.ensureIdentity()
  registerIdentityIpc(runtime.localIdentityService)
  console.log('[DeepInk] 本地身份系统已初始化')
  registerAuthIpc(runtime.mainWindow, runtime.tokenManager, runtime.authService)
  console.log('[DeepInk] Auth 系统已初始化')

  runtime.subscriptionService = new SubscriptionService()
  registerSubscriptionIpc(runtime.mainWindow, runtime.tokenManager, runtime.subscriptionService)
  console.log('[DeepInk] 订阅系统已初始化')

  if (runtime.cclinkStore) {
    runtime.remoteProviderRegistry = new RemoteProviderRegistry()
    runtime.remoteProviderRegistry.register(
      new CclinkRemoteProvider(
        runtime.cclinkStore,
        runtime.cclinkFileService ?? undefined,
        runtime.cclinkRequestRouter ?? undefined,
      ),
    )
    registerRemoteIpc(runtime.remoteProviderRegistry, runtime.tokenManager, runtime.subscriptionService)
    console.log('[DeepInk] Remote Provider IPC 已注册')
  }

  const fileService = new FileService()
  registerFsIpc(fileService, runtime.settingsService)
  console.log('[DeepInk] 文件系统 IPC 已注册')

  runtime.projectOpsService = new ProjectOpsService()
  registerProjectOpsIpc(runtime.projectOpsService)
  console.log('[DeepInk] 项目运营 IPC 已注册')

  runtime.hardwareService = new HardwareService()
  registerHardwareIpc(runtime.hardwareService)
  console.log('[DeepInk] 硬件工作区 IPC 已注册')

  runtime.meshyService = new MeshyService(() => runtime.settingsService!.getAll())
  registerMeshyIpc(runtime.meshyService)
  console.log('[DeepInk] Meshy 服务已初始化')

  registerWechatIPC()
  console.log('[DeepInk] 微信格式转换 IPC 已注册')

  runtime.syncCredentialStore = new SyncCredentialStore()
  await runtime.syncCredentialStore.load()
  runtime.syncService = new SyncService()
  await runtime.syncService.loadState()
  registerSyncIpc(runtime.mainWindow, runtime.syncService, runtime.syncCredentialStore, runtime.tokenManager, runtime.subscriptionService)
  console.log('[DeepInk] 云同步系统已初始化')

  runtime.permissionManager = new PermissionManager(runtime.mainWindow)
  runtime.permissionManager.setMode(runtime.settingsService.getAll().permissionMode)

  runtime.terminalAuditStore = new TerminalAuditStore()
  await runtime.terminalAuditStore.load()
  runtime.terminalSessionStore = new TerminalSessionStore()
  await runtime.terminalSessionStore.load()
  const terminalOrphanSummary = await cleanupTerminalOrphans(runtime.terminalSessionStore)
  if (terminalOrphanSummary.scanned > 0) {
    console.log(
      `[DeepInk] Terminal 残留进程清理完成: scanned=${terminalOrphanSummary.scanned}, killed=${terminalOrphanSummary.killed}, missing=${terminalOrphanSummary.missing}, skipped=${terminalOrphanSummary.skipped}, failed=${terminalOrphanSummary.failed}`,
    )
  }
  runtime.terminalConfirmationService = new TerminalConfirmationService(runtime.mainWindow, {
    auditStore: runtime.terminalAuditStore,
  })
  runtime.terminalSessionRegistry = new TerminalSessionRegistry()
  const localTerminalExecutionAdapter = new PtyExecutionAdapter()
  const cclinkTerminalExecutionAdapter =
    runtime.cclinkStore && runtime.cclinkRequestRouter
      ? new EntitledTerminalExecutionAdapter(
          new CclinkTerminalExecutionAdapter(runtime.cclinkStore, runtime.cclinkRequestRouter),
          {
            featureName: '远程 Terminal',
            entitlement: 'remote_terminal',
            checkAccess: () =>
              checkEntitlement('远程 Terminal', 'remote_terminal', runtime.tokenManager!, runtime.subscriptionService!),
          },
        )
      : undefined
  const terminalExecutionAdapter = new CompositeTerminalExecutionAdapter({
    local: localTerminalExecutionAdapter,
    cclink: cclinkTerminalExecutionAdapter,
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
  console.log('[DeepInk] Terminal 确认 IPC 已注册')

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
  console.log('[DeepInk] 设置 IPC 已注册')

  registerUpdaterIpc(runtime.mainWindow)
  console.log('[DeepInk] 更新检查 IPC 已注册')
}
