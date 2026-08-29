import { app, shell } from 'electron'
import { join, resolve } from 'node:path'
import { LocalIdentityService } from '../identity/local-identity-service'
import { registerIdentityIpc } from '../identity/identity-ipc'
import { FileService } from '../fs/file-service'
import { registerFsIpc } from '../fs/fs-ipc'
import { ProjectOpsService } from '../project-ops/project-ops-service'
import { registerProjectOpsIpc } from '../project-ops/project-ops-ipc'
import { WebResourceService } from '../web-resources/web-resource-service'
import { registerWebResourceIpc } from '../web-resources/web-resource-ipc'
import { WebAffairService } from '../web-affairs/web-affair-service'
import { registerWebAffairIpc } from '../web-affairs/web-affair-ipc'
import { webAffairsIpcEvents } from '../../shared/web-affairs/web-affair'
import { ArticlePublishingService } from '../article-publishing/article-publishing-service'
import { registerArticlePublishingIpc } from '../article-publishing/article-publishing-ipc'
import { registerWechatIPC } from '../ipc/wechat-ipc'
import { SettingsService } from '../settings/settings-service'
import { registerSettingsIpc } from '../settings/settings-ipc'
import { CredentialService } from '../credentials/credential-service'
import { registerCredentialsIpc } from '../credentials/credentials-ipc'
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
import { GitWorkspaceService } from '../git/git-workspace-service'
import { registerGitIpc } from '../git/git-ipc'
import type { CclinkStudioRuntimeState } from './app-runtime'
import { bootstrapOptionalMainServices } from './optional-main-services'
import { runShutdownStep } from './shutdown'
import { registerDiagnosticsIpc } from '../ipc/diagnostics-ipc'
import { UsageLedgerService } from '../usage/usage-ledger-service'
import { GitHubReleaseProvider } from '../update/github-release-provider'
import { NoopUpdateProvider } from '../update/noop-update-provider'
import { UpdateService } from '../update/update-service'
import { ScheduledTaskService } from '../scheduled-task/scheduled-task-service'
import { registerScheduledTaskIpc } from '../scheduled-task/scheduled-task-ipc'
import { MacDmgVerifier } from '../update/mac-dmg-verifier'
import { applyWindowZoomLevel } from './window-runtime'
import { RendererWorkspaceStateFlushCoordinator } from '../workspace/renderer-workspace-state-flush'
import { RuntimeComponentManager } from '../runtime-components/runtime-component-manager'
import { registerRuntimeComponentsIpc } from '../runtime-components/runtime-components-ipc'
import { CclinkAuthService } from '../cclink-remote/auth-service'
import { CclinkRemoteService } from '../cclink-remote/cclink-remote-service'
import { CclinkRuntimeStateStore } from '../cclink-remote/runtime-state-store'
import { registerCclinkRemoteIpc } from '../cclink-remote/cclink-remote-ipc'
import { getCclinkServiceUrl } from '../cclink-remote/service-config'
import { AgentRoleRegistry } from '../agent/agent-role-registry'
import { AgentRuntimeStateStore } from '../agent/agent-runtime-state-store'
import { MediaProjectService } from '../media-production/media-project-service'
import { registerMediaProjectIpc } from '../media-production/media-project-ipc'
import { StoryboardProposalService } from '../media-production/storyboard-proposal-service'
import { MediaAssetService } from '../media-production/media-asset-service'
import { MediaImageGenerationService } from '../media-production/media-image-generation-service'
import { MediaSearchService } from '../media-production/media-search-service'
import { JimengVideoProvider } from '../media-production/providers/jimeng-video-provider'
import { VideoGenerationService } from '../media-production/video-generation-service'
import { registerVideoGenerationIpc } from '../media-production/video-generation-ipc'
import { MediaRenderService } from '../media-production/media-render-service'
import { registerMediaRenderIpc } from '../media-production/media-render-ipc'
import { WorkbenchTabModel } from '../workbench/workbench-tab-model'
import { registerWorkbenchTabModelIpc } from '../workbench/workbench-tab-model-ipc'
import { BrowserBookmarkModel } from '../workbench/browser-bookmark-model'

export async function bootstrapStateServices(runtime: CclinkStudioRuntimeState): Promise<void> {
  runtime.agentRuntimeStateStore ??= new AgentRuntimeStateStore(
    join(app.getPath('userData'), 'agent-runtime', 'state.json'),
  )
  await runtime.agentRuntimeStateStore.load()
  console.log('[CCLink Studio] Agent run 状态账本已初始化')

  try {
    runtime.agentRoleRegistry = new AgentRoleRegistry()
    await runtime.agentRoleRegistry.load()
    console.log('[CCLink Studio] 本地角色注册表已初始化')
  } catch (error) {
    runtime.agentRoleRegistry = null
    console.error(
      '[CCLink Studio] 本地角色注册表初始化失败，内置角色与其他本地能力继续启动:',
      error,
    )
  }

  runtime.credentialService = new CredentialService()
  await runtime.credentialService.load()
  console.log('[CCLink Studio] 本地凭证服务已初始化')

  runtime.settingsService = new SettingsService(runtime.credentialService)
  await runtime.settingsService.loadState()
  console.log('[CCLink Studio] 设置系统已初始化')

  const restoredDefaultRole = await runtime.agentRoleRegistry?.restoreArchivedDefault(
    runtime.settingsService.getAll().defaultAgentRoleRef,
  )
  if (restoredDefaultRole) {
    if (restoredDefaultRole.success && restoredDefaultRole.role) {
      console.warn(
        `[CCLink Studio] 已恢复旧版本中被归档的新会话默认角色: ${restoredDefaultRole.role.roleId}`,
      )
    } else {
      console.error(
        '[CCLink Studio] 无法恢复旧版本中被归档的新会话默认角色:',
        restoredDefaultRole.error,
      )
    }
  }

  runtime.runtimeComponentManager = new RuntimeComponentManager(
    join(app.getPath('userData'), 'runtime-components'),
  )
  await runtime.runtimeComponentManager.initialize()
  console.log('[CCLink Studio] Runtime 组件管理器已初始化')

  runtime.workspaceStateService = new WorkspaceStateService()
  await runtime.workspaceStateService.loadState()
  runtime.workbenchTabModel = new WorkbenchTabModel(runtime.workspaceStateService)
  runtime.browserBookmarkModel = new BrowserBookmarkModel(runtime.workspaceStateService)
  const restoredWorkspacePath = runtime.settingsService.getAll().lastWorkspacePath.trim()
  if (restoredWorkspacePath) {
    try {
      await runtime.workspaceStateService.setActiveLocalWorkspace(restoredWorkspacePath)
    } catch {
      await runtime.workspaceStateService.setActiveLocalWorkspace(null)
      await runtime.settingsService.set({ lastWorkspacePath: '' })
    }
  }
  console.log('[CCLink Studio] 工作台状态服务已初始化')

  runtime.scheduledTaskService = new ScheduledTaskService(runtime.workspaceStateService)
  await runtime.scheduledTaskService.load()
  console.log('[CCLink Studio] 定时任务定义与本机启用状态已初始化（尚未启动调度）')

  runtime.mediaAssetService = new MediaAssetService(runtime.workspaceStateService)
  runtime.mediaProjectService = new MediaProjectService(
    runtime.workspaceStateService,
    Date.now,
    runtime.mediaAssetService,
  )
  console.log('[CCLink Studio] 宣发视频工程服务已初始化')

  runtime.usageLedgerService = new UsageLedgerService()
  runtime.videoGenerationService = new VideoGenerationService(
    runtime.mediaProjectService,
    runtime.mediaAssetService,
    new JimengVideoProvider(() => {
      try {
        const credential = runtime.credentialService?.resolveCredential('extension:jimeng:default')
        return {
          accessKeyId: credential?.accessKeyId ?? '',
          secretAccessKey: credential?.secretAccessKey ?? '',
        }
      } catch {
        return { accessKeyId: '', secretAccessKey: '' }
      }
    }),
    () => runtime.usageLedgerService,
  )
  runtime.mediaRenderService = new MediaRenderService(runtime.mediaProjectService)
  console.log('[CCLink Studio] 用量统计服务已初始化')
}

export async function shutdownStateServices(runtime: CclinkStudioRuntimeState): Promise<void> {
  runtime.mediaProjectIpcUnsubscribe?.()
  runtime.mediaProjectIpcUnsubscribe = null
  await runShutdownStep('ScheduledTaskService', () => runtime.scheduledTaskService?.flush())
  await runShutdownStep('MediaProjectService', () => runtime.mediaProjectService?.flush())
  await runShutdownStep('MediaAssetService', () => runtime.mediaAssetService?.flush())
  await runShutdownStep('VideoGenerationService', () => runtime.videoGenerationService?.flush())
  await runShutdownStep('MediaRenderService', () => runtime.mediaRenderService?.flush())
  await runShutdownStep('WorkspaceStateService', () => runtime.workspaceStateService?.flush())
  await runShutdownStep('UsageLedgerService', () => runtime.usageLedgerService?.flush())
  await runShutdownStep('AgentRoleRegistry', () => runtime.agentRoleRegistry?.flush())
  await runShutdownStep('AgentRuntimeStateStore', () => runtime.agentRuntimeStateStore?.flush())
  runtime.workspaceStateService = null
  runtime.workbenchTabModel = null
  runtime.browserBookmarkModel = null
  runtime.scheduledTaskService = null
  runtime.mediaProjectService = null
  runtime.mediaAssetService = null
  runtime.videoGenerationService = null
  runtime.mediaRenderService = null
  runtime.usageLedgerService = null
  runtime.settingsService = null
  runtime.credentialService = null
  runtime.runtimeComponentManager = null
  runtime.agentRoleRegistry = null
  runtime.agentRuntimeStateStore = null
}

export async function bootstrapMainProcessServices(
  runtime: CclinkStudioRuntimeState,
): Promise<void> {
  if (
    !runtime.mainWindow ||
    !runtime.settingsService ||
    !runtime.credentialService ||
    !runtime.trustedRendererGuard
  ) {
    throw new Error('主窗口、可信 renderer、凭证或设置系统尚未初始化')
  }

  registerWorkspaceStateIpc(
    runtime.workspaceStateService!,
    runtime.trustedRendererGuard,
    runtime.settingsService,
  )
  registerWorkbenchTabModelIpc(
    runtime.workbenchTabModel!,
    runtime.browserBookmarkModel!,
    runtime.trustedRendererGuard,
  )
  runtime.rendererWorkspaceStateFlush = new RendererWorkspaceStateFlushCoordinator(
    runtime.mainWindow,
    runtime.trustedRendererGuard,
  )
  console.log('[CCLink Studio] 工作台状态 IPC 已注册')

  registerScheduledTaskIpc(
    runtime.scheduledTaskService!,
    runtime.trustedRendererGuard,
    runtime.mainWindow,
  )
  console.log('[CCLink Studio] 定时任务 IPC 已注册')

  runtime.mediaProjectIpcUnsubscribe?.()
  runtime.mediaProjectIpcUnsubscribe = registerMediaProjectIpc(
    runtime.mediaProjectService!,
    runtime.trustedRendererGuard,
    runtime.mainWindow,
    new StoryboardProposalService(() => runtime.agentBridge),
    runtime.mediaAssetService!,
    new MediaImageGenerationService(
      runtime.mediaProjectService!,
      runtime.mediaAssetService!,
      () => runtime.imageGenerationService,
      () => runtime.usageLedgerService,
    ),
    new MediaSearchService(runtime.mediaAssetService!, () => {
      try {
        return (
          runtime.credentialService?.resolveCredential('extension:pexels:default')?.apiKey ?? ''
        )
      } catch {
        return ''
      }
    }),
  )
  console.log('[CCLink Studio] 宣发视频工程 IPC 已注册')

  registerVideoGenerationIpc(runtime.videoGenerationService!, runtime.trustedRendererGuard)
  console.log('[CCLink Studio] 宣发视频云端任务 IPC 已注册')

  registerMediaRenderIpc(runtime.mediaRenderService!, runtime.trustedRendererGuard)
  console.log('[CCLink Studio] 宣发视频本地渲染 IPC 已注册')

  registerDiagnosticsIpc(runtime.trustedRendererGuard)
  console.log('[CCLink Studio] 诊断日志 IPC 已注册')

  registerCredentialsIpc(runtime.credentialService, runtime.trustedRendererGuard)
  console.log('[CCLink Studio] 本地凭证 IPC 已注册')

  registerRuntimeComponentsIpc(runtime.runtimeComponentManager!, runtime.trustedRendererGuard, {
    beginManagedClaudeMutation: () => {
      const agentBridge = runtime.agentBridge
      if (!agentBridge) return () => undefined
      if (!agentBridge.beginConfigurationChange()) return null
      return () => agentBridge.endConfigurationChange()
    },
    isManagedClaudeSelected: () =>
      runtime.settingsService?.getRuntimeSettings().claudeRuntimeSource === 'managed',
  })
  console.log('[CCLink Studio] Runtime 组件管理 IPC 已注册')

  try {
    const cclinkStateRoot = join(app.getPath('userData'), 'cclink-remote')
    runtime.cclinkAuthService = new CclinkAuthService(getCclinkServiceUrl(), cclinkStateRoot)
    runtime.cclinkAuthService.initialize()
    runtime.cclinkRemoteService = new CclinkRemoteService(
      runtime.cclinkAuthService,
      getCclinkServiceUrl(),
      new CclinkRuntimeStateStore(cclinkStateRoot, [
        join(
          app.getPath('appData'),
          app.isPackaged ? 'CCLink Studio Commercial' : 'CCLink Studio Commercial Dev',
          'cclink-state.json',
        ),
      ]),
    )
    await runtime.cclinkRemoteService.initialize()
    runtime.cclinkIpcUnsubscribe = registerCclinkRemoteIpc(
      runtime.mainWindow,
      runtime.cclinkRemoteService,
      runtime.trustedRendererGuard,
    )
    console.log('[CCLink Studio] CCLink 远程入口已注册（按需登录）')
  } catch (error) {
    runtime.cclinkAuthService = null
    runtime.cclinkRemoteService = null
    console.error('[CCLink Studio] CCLink 远程入口初始化失败，本地能力继续启动:', error)
  }

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
    runtime.gitWorkspaceService = new GitWorkspaceService(runtime.workspaceStateService!, {
      resolveAuthentication: async (remoteUrl) => {
        try {
          const parsed = new URL(remoteUrl)
          if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
            return null
          }
          const username = runtime.settingsService?.getAll().gitBackupUsername.trim() ?? ''
          const token = runtime.credentialService?.resolveCredential('git:github')?.token ?? ''
          return username && token ? { username, token } : null
        } catch {
          return null
        }
      },
    })
    registerGitIpc(runtime.gitWorkspaceService, runtime.trustedRendererGuard)
    console.log('[CCLink Studio] Git 工作空间状态服务已初始化')
  } catch (error) {
    runtime.gitWorkspaceService = null
    console.error('[CCLink Studio] Git 状态服务初始化失败，其他本地能力继续启动:', error)
  }

  try {
    runtime.gitBackupService = new GitBackupService(
      runtime.settingsService,
      runtime.workspaceStateService!,
      runtime.credentialService,
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
    runtime.webResourceService = new WebResourceService()
    await runtime.webResourceService.load()
    console.log('[CCLink Studio] 网站与账号服务已初始化')
  } catch (error) {
    runtime.webResourceService = null
    console.error('[CCLink Studio] 网站与账号服务初始化失败，其他本地能力继续启动:', error)
  }
  registerWebResourceIpc(
    () => runtime.webResourceService,
    () => runtime.projectOpsService,
    () => runtime.workspaceStateService,
    runtime.trustedRendererGuard,
    () => runtime.browserManager,
  )
  console.log('[CCLink Studio] 网站与账号 IPC 已注册')

  try {
    runtime.webAffairService = new WebAffairService(
      () => {
        const result = runtime.webResourceService?.getSnapshot()
        return result?.success ? result.data : null
      },
      undefined,
      undefined,
      (affairId, revision) => {
        if (!runtime.mainWindow?.isDestroyed()) {
          runtime.mainWindow?.webContents.send(webAffairsIpcEvents.changed, {
            affairId,
            revision,
          })
        }
      },
      (_workspaceId, accountId) =>
        runtime.webResourceService?.resolveLaunch(accountId) ?? {
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: '网站与账号服务尚未就绪' },
        },
    )
    await runtime.webAffairService.load()
    console.log('[CCLink Studio] 事务服务已初始化')
  } catch (error) {
    runtime.webAffairService = null
    console.error('[CCLink Studio] 事务服务初始化失败，其他本地能力继续启动:', error)
  }
  registerWebAffairIpc(
    () => runtime.webAffairService,
    runtime.trustedRendererGuard,
    () => runtime.browserTaskRuntime,
    () => runtime.workspaceStateService,
  )
  console.log('[CCLink Studio] 事务 IPC 已注册')

  runtime.articlePublishingService =
    runtime.fileService && runtime.webAffairService
      ? new ArticlePublishingService(runtime.fileService, runtime.webAffairService)
      : null
  registerArticlePublishingIpc(
    () => runtime.articlePublishingService,
    () => runtime.workspaceStateService,
    runtime.trustedRendererGuard,
  )
  console.log('[CCLink Studio] 文章发布 IPC 已注册')

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
    getAgentRuntimeStateStore: () => runtime.agentRuntimeStateStore,
    getAgentRoleRegistry: () => runtime.agentRoleRegistry,
    getDefaultAgentRoleRef: () => runtime.settingsService!.getAll().defaultAgentRoleRef,
    permissionManager: runtime.permissionManager,
    getMcpClientMgr: () => runtime.mcpClientMgr,
    getCapabilities: () => getAgentCapabilities(runtime),
    getToolModules: () => getAgentToolModules(runtime),
    getActiveLocalWorkspace: () => runtime.workspaceStateService!.getActiveLocalWorkspace(),
    resolveLocalWorkspace: (workspacePath) =>
      runtime.workspaceStateService!.resolveLocalWorkspace(workspacePath),
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
    (level) => applyWindowZoomLevel(runtime, level),
    undefined,
    async (track) => {
      await runtime.updateService?.setTrack(track)
    },
  )
  console.log('[CCLink Studio] 设置 IPC 已注册')

  const architecture = process.arch === 'arm64' ? 'arm64' : null
  const provider =
    process.platform === 'darwin' && architecture
      ? new GitHubReleaseProvider()
      : new NoopUpdateProvider()
  const dmgInspector =
    app.isPackaged && process.platform === 'darwin' && architecture
      ? new MacDmgVerifier({
          currentAppBundlePath: resolve(app.getPath('exe'), '..', '..', '..'),
        })
      : undefined
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
    initialTrack: runtime.settingsService.getAll().updateTrack,
    automaticChecks: app.isPackaged,
    dmgInspector,
    openPath: dmgInspector ? (path) => shell.openPath(path) : undefined,
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
  await runShutdownStep('RendererWorkspaceStateFlush', async () => {
    const outcome = await runtime.rendererWorkspaceStateFlush?.requestFlush()
    if (outcome) console.log(`[WorkspaceStateService] renderer 退出快照: ${outcome}`)
  })
  runtime.rendererWorkspaceStateFlush?.dispose()
  runtime.rendererWorkspaceStateFlush = null
  runtime.updateSnapshotUnsubscribe?.()
  runtime.updateSnapshotUnsubscribe = null
  await runShutdownStep('UpdateService', () => runtime.updateService?.stop())
  runtime.cclinkIpcUnsubscribe?.()
  runtime.cclinkIpcUnsubscribe = null
  await runShutdownStep('CclinkRemoteService', () => runtime.cclinkRemoteService?.destroy())
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
  await runShutdownStep('TerminalExecutionEventSubscription', () => {
    runtime.terminalExecutionEventUnsubscribe?.()
    runtime.terminalExecutionEventUnsubscribe = null
  })
  await runShutdownStep('TerminalSessionRegistry', () => runtime.terminalSessionRegistry?.clear())
  await runShutdownStep('WebAffairService', () => runtime.webAffairService?.flush())
  await runShutdownStep('WebResourceService', () => runtime.webResourceService?.flush())

  runtime.localIdentityService = null
  runtime.cclinkAuthService = null
  runtime.cclinkRemoteService = null
  runtime.officialIntegration = null
  runtime.fileService = null
  runtime.gitWorkspaceService = null
  runtime.gitBackupService = null
  runtime.projectOpsService = null
  runtime.webResourceService = null
  runtime.webAffairService = null
  runtime.articlePublishingService = null
  runtime.permissionManager = null
  runtime.mcpClientMgr = null
  runtime.cadConversionService = null
  runtime.hardwareService = null
  runtime.dataSourceService = null
  runtime.meshyService = null
  runtime.imageGenerationService = null
  runtime.markdownIllustrationService = null
  runtime.terminalAuditStore = null
  runtime.terminalSessionStore = null
  runtime.terminalConfirmationService = null
  runtime.terminalSessionRegistry = null
  runtime.terminalExecutionAdapter = null
  runtime.terminalExecutionEventUnsubscribe = null
  runtime.terminalCommandOrchestrator = null
  runtime.updateService = null
}
