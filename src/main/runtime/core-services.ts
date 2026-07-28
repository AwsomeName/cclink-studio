import { app } from 'electron'
import { join } from 'node:path'
import { LocalIdentityService } from '../identity/local-identity-service'
import { registerIdentityIpc } from '../identity/identity-ipc'
import { FileService } from '../fs/file-service'
import { registerFsIpc } from '../fs/fs-ipc'
import { ProjectOpsService } from '../project-ops/project-ops-service'
import { registerProjectOpsIpc } from '../project-ops/project-ops-ipc'
import { registerWechatIPC } from '../ipc/wechat-ipc'
import { SettingsService } from '../settings/settings-service'
import { registerSettingsIpc } from '../settings/settings-ipc'
import { PermissionManager } from '../mcp/permission'
import { McpClientManager } from '../mcp/client-manager'
import { registerAgentIpc } from '../ipc/agent-ipc'
import { registerUpdaterIpc } from '../ipc/updater-ipc'
import { WorkspaceStateService } from '../workspace/workspace-state-service'
import { registerWorkspaceStateIpc } from '../workspace/workspace-state-ipc'
import { registerOfficialIpc } from '../ipc/official-ipc'
import { loadOfficialIntegration } from '../official/official-integration-loader'
import { createOfficialIntegrationFallback } from '../official/official-integration-loader'
import { createTrustedIpcRegistrar } from '../ipc/trusted-renderer-guard'
import { getAgentCapabilities, getAgentToolModules } from './agent-capabilities'
import { GitBackupService } from '../git-backup/git-backup-service'
import { registerGitBackupIpc } from '../git-backup/git-backup-ipc'
import type { CclinkStudioRuntimeState } from './app-runtime'
import { bootstrapOptionalMainServices } from './optional-main-services'
import { runShutdownStep } from './shutdown'
import { GitHubReleaseProvider } from '../update/github-release-provider'
import { NoopUpdateProvider } from '../update/noop-update-provider'
import { UpdateService } from '../update/update-service'

export async function bootstrapStateServices(runtime: CclinkStudioRuntimeState): Promise<void> {
  runtime.settingsService = new SettingsService()
  await runtime.settingsService.loadState()
  console.log('[CCLink Studio] 设置系统已初始化')

  runtime.workspaceStateService = new WorkspaceStateService()
  await runtime.workspaceStateService.loadState()
  console.log('[CCLink Studio] 工作台状态服务已初始化')
}

export async function shutdownStateServices(runtime: CclinkStudioRuntimeState): Promise<void> {
  await runShutdownStep('WorkspaceStateService', () => runtime.workspaceStateService?.flush())
  runtime.workspaceStateService = null
  runtime.settingsService = null
}

export async function bootstrapMainProcessServices(
  runtime: CclinkStudioRuntimeState,
): Promise<void> {
  if (!runtime.mainWindow || !runtime.settingsService || !runtime.trustedRendererGuard) {
    throw new Error('主窗口、可信 renderer 或设置系统尚未初始化')
  }

  registerWorkspaceStateIpc(runtime.workspaceStateService!, runtime.trustedRendererGuard)
  console.log('[CCLink Studio] 工作台状态 IPC 已注册')

  try {
    runtime.localIdentityService = new LocalIdentityService()
    await runtime.localIdentityService.ensureIdentity()
    registerIdentityIpc(runtime.localIdentityService, runtime.trustedRendererGuard)
    console.log('[CCLink Studio] 本地身份系统已初始化')
  } catch (error) {
    runtime.localIdentityService = null
    console.error('[CCLink Studio] 本地身份系统初始化失败，其他本地能力继续启动:', error)
  }

  try {
    runtime.officialIntegration = await loadOfficialIntegration()
    await runtime.officialIntegration.registerMainServices?.({
      isDev: runtime.isDev,
      mainWindow: runtime.mainWindow,
      settingsService: runtime.settingsService,
      workspaceStateService: runtime.workspaceStateService!,
    })
    await runtime.officialIntegration.registerIpc?.({
      isDev: runtime.isDev,
      mainWindow: runtime.mainWindow,
      settingsService: runtime.settingsService,
      workspaceStateService: runtime.workspaceStateService!,
      ipc: createTrustedIpcRegistrar(runtime.trustedRendererGuard),
    })
  } catch (error) {
    runtime.officialIntegration = createOfficialIntegrationFallback()
    console.error('[CCLink Studio] 官方集成初始化失败，已回退到 OSS no-op:', error)
  }
  registerOfficialIpc(runtime.officialIntegration, runtime.trustedRendererGuard)
  console.log(
    `[CCLink Studio] 官方集成接口已注册 (id=${runtime.officialIntegration.id}, profile=${runtime.officialIntegration.buildProfile})`,
  )

  runtime.fileService = new FileService()
  registerFsIpc(runtime.fileService, runtime.settingsService, runtime.trustedRendererGuard)
  console.log('[CCLink Studio] 文件系统 IPC 已注册')

  try {
    runtime.gitBackupService = new GitBackupService(
      runtime.settingsService,
      runtime.workspaceStateService!,
    )
    await runtime.gitBackupService.load()
    registerGitBackupIpc(runtime.gitBackupService, runtime.trustedRendererGuard)
    console.log('[CCLink Studio] 手动 Git 备份服务已初始化')
  } catch (error) {
    runtime.gitBackupService = null
    console.error('[CCLink Studio] Git 备份服务初始化失败，其他本地能力继续启动:', error)
  }

  runtime.projectOpsService = new ProjectOpsService()
  registerProjectOpsIpc(runtime.projectOpsService, runtime.trustedRendererGuard)
  console.log('[CCLink Studio] 项目运营 IPC 已注册')

  try {
    registerWechatIPC(runtime.trustedRendererGuard)
    console.log('[CCLink Studio] 微信格式转换 IPC 已注册')
  } catch (error) {
    console.error('[CCLink Studio] 微信格式转换 IPC 注册失败，其他本地能力继续启动:', error)
  }

  runtime.permissionManager = new PermissionManager(runtime.mainWindow)
  runtime.permissionManager.setMode(runtime.settingsService.getAll().permissionMode)

  runtime.mcpClientMgr = new McpClientManager()

  registerAgentIpc({
    trustedRendererGuard: runtime.trustedRendererGuard,
    getAgentBridge: () => runtime.agentBridge,
    permissionManager: runtime.permissionManager,
    getMcpClientMgr: () => runtime.mcpClientMgr,
    getCapabilities: () => getAgentCapabilities(runtime),
    getToolModules: () => getAgentToolModules(runtime),
    setToolModuleEnabled: async (moduleId, enabled) => {
      if (!runtime.toolHost?.setModuleEnabled(moduleId, enabled)) {
        return { success: false, error: `未找到工具模块: ${moduleId}` }
      }
      const disabled = new Set(runtime.settingsService!.getAll().disabledAgentToolModules)
      if (enabled) disabled.delete(moduleId)
      else disabled.add(moduleId)
      await runtime.settingsService!.set({ disabledAgentToolModules: Array.from(disabled) })
      return { success: true }
    },
  })

  registerSettingsIpc(
    runtime.settingsService,
    runtime.trustedRendererGuard,
    runtime.permissionManager,
    () => runtime.agentBridge,
    () => runtime.toolHost,
    () => runtime.claudeRuntimeManager,
    async () => {
      const { bootstrapAgentRuntime } = await import('./agent-runtime')
      await bootstrapAgentRuntime(runtime)
    },
  )
  console.log('[CCLink Studio] 设置 IPC 已注册')

  const architecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  const provider =
    process.platform === 'darwin' && architecture
      ? new GitHubReleaseProvider()
      : new NoopUpdateProvider()
  runtime.updateService = new UpdateService({
    currentVersion:
      !app.isPackaged && process.env['CCLINK_STUDIO_UPDATE_CURRENT_VERSION']
        ? process.env['CCLINK_STUDIO_UPDATE_CURRENT_VERSION']
        : app.getVersion(),
    architecture: architecture ?? 'arm64',
    systemVersion:
      process.platform === 'darwin'
        ? (
            process as NodeJS.Process & {
              getSystemVersion(): string
            }
          ).getSystemVersion()
        : '0.0.0',
    cacheRoot: join(app.getPath('userData'), 'updates'),
    provider,
    automaticChecks: app.isPackaged,
  })
  await runtime.updateService.start()
  runtime.updateSnapshotUnsubscribe = registerUpdaterIpc(
    runtime.updateService,
    runtime.mainWindow,
    runtime.trustedRendererGuard,
  )
  console.log(`[CCLink Studio] 更新服务已初始化 (provider=${provider.id})`)

  await bootstrapOptionalMainServices(runtime)
}

export async function shutdownMainProcessServices(
  runtime: CclinkStudioRuntimeState,
): Promise<void> {
  runtime.updateSnapshotUnsubscribe?.()
  runtime.updateSnapshotUnsubscribe = null
  await runShutdownStep('UpdateService', () => runtime.updateService?.stop())
  await runShutdownStep('PermissionManager', () => runtime.permissionManager?.destroy())
  await runShutdownStep('TerminalConfirmationService', () =>
    runtime.terminalConfirmationService?.destroy(),
  )
  await runShutdownStep('TerminalExecutionAdapter', async () => {
    const sessions = runtime.terminalSessionRegistry?.list() ?? []
    await Promise.all(
      sessions.map((session) => runtime.terminalExecutionAdapter?.terminate(session.sessionId)),
    )
  })
  await runShutdownStep('TerminalSessionRegistry', () => runtime.terminalSessionRegistry?.clear())

  runtime.localIdentityService = null
  runtime.officialIntegration = null
  runtime.fileService = null
  runtime.gitBackupService = null
  runtime.projectOpsService = null
  runtime.permissionManager = null
  runtime.mcpClientMgr = null
  runtime.cadConversionService = null
  runtime.hardwareService = null
  runtime.dataSourceService = null
  runtime.meshyService = null
  runtime.terminalAuditStore = null
  runtime.terminalSessionStore = null
  runtime.terminalConfirmationService = null
  runtime.terminalSessionRegistry = null
  runtime.terminalExecutionAdapter = null
  runtime.terminalCommandOrchestrator = null
  runtime.updateService = null
}
