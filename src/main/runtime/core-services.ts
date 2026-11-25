import { app, dialog, shell, type Event } from 'electron'
import { join, resolve } from 'node:path'
import {
  companySyncHooks,
  countCompanyRows,
  describeRecordConflict,
} from '../company-sync/company-sync'
import { readWorkspaceSettings } from '../workspace/workspace-settings-files'
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
import { createWebServiceStartupFailure } from '../diagnostics/web-service-startup-error'
import { webAffairsIpcEvents } from '../../shared/web-affairs/web-affair'
import { ArticlePublishingService } from '../article-publishing/article-publishing-service'
import { ImageResearchService } from '../image-research/image-research-service'
import { registerArticlePublishingIpc } from '../article-publishing/article-publishing-ipc'
import { registerWechatIPC } from '../ipc/wechat-ipc'
import { SettingsService } from '../settings/settings-service'
import { activateInstalledManagedClaude, registerSettingsIpc } from '../settings/settings-ipc'
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
import { testClaudeModelConnection } from '../agent/claude-model-connection-test'
import { GitHubReleaseProvider } from '../update/github-release-provider'
import { NoopUpdateProvider } from '../update/noop-update-provider'
import { UpdateService } from '../update/update-service'
import { ScheduledTaskService } from '../scheduled-task/scheduled-task-service'
import { registerScheduledTaskIpc } from '../scheduled-task/scheduled-task-ipc'
import { AffairDirectoryService } from '../owner/affair-directory'
import {
  registerOwnerDirectories,
  registerOwnerPreferences,
  registerOwnerSources,
} from '../owner/directory-ipc'
import { OwnerPreferences } from '../owner/owner-preferences'
import { OwnerSourceDirectories } from '../owner/source-directories'
import { OwnerSourceFiles } from '../owner/source-files'
import { registerOwnerReadme } from '../owner/read-public-readme'
import { registerModelUsageIpc } from '../usage/model-usage-ipc'
import { MacDmgVerifier } from '../update/mac-dmg-verifier'
import { MacUpdateInstaller } from '../update/mac-update-installer'
import { createUpdateInstallLifecycle } from '../update/update-install-lifecycle'
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
import { CompanyAccountsService } from '../company-accounts/company-accounts-service'
import { GitExecutor } from '../git-backup/git-executor'
import { remoteDiaryNames } from '../git/git-fast-forward'
import { DiaryChangeTracker } from '../workspace/diary-change-tracker'
import { registerCompanyAccountsIpc } from '../company-accounts/company-accounts-ipc'
import { WebSearchService } from '../web-search/web-search-service'
import { registerWebSearchIpc } from '../web-search/web-search-ipc'
import { TechDailyService } from '../techdaily/techdaily-service'
import { registerTechDailyIpc } from '../techdaily/techdaily-ipc'
import { SEARXNG_CREDENTIAL_ID } from '../../shared/techdaily/techdaily-types'
import { defaultDiaryTimezone } from '../../shared/personal-diary-source'
import { WEB_SEARCH_OWN_CREDENTIAL_ID } from '../../shared/web-search/web-search-types'

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
  try {
    await runtime.runtimeComponentManager.initialize()
    console.log('[CCLink Studio] Runtime 组件管理器已初始化')
  } catch (error) {
    console.error('[CCLink Studio] Runtime 组件管理器初始化失败，工作台将继续降级启动:', error)
  }

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

  runtime.diaryChangeTracker = new DiaryChangeTracker(
    join(app.getPath('userData'), 'diary-change-reports.json'),
  )
  const draftSyncRunner = new GitExecutor({ isolatedConfig: true, timeoutMs: 20_000 })
  runtime.scheduledTaskService = new ScheduledTaskService(runtime.workspaceStateService, {
    beforeDiaryDraft: async (root, folder) => {
      const snapshot = await runtime.workspaceStateService!.getSnapshot(root)
      const saved = snapshot.sections['personal-diary-sync'] as { remoteUrl?: string } | undefined
      return remoteDiaryNames(draftSyncRunner, root, folder, saved?.remoteUrl)
    },
    getLocalOwnerKey: async () => {
      const identity = await runtime.localIdentityService?.ensureIdentity()
      return identity ? `local:${identity.localId}` : null
    },
  })
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
  void runtime.usageLedgerService.modelUsage.initialize().catch(() => undefined)
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

  runtime.fileService = new FileService({
    getActiveWorkspace: () =>
      runtime.workspaceStateService?.getActiveLocalWorkspace().workspacePath ?? null,
    relocationJournalPath: join(app.getPath('userData'), 'file-relocation-journal.json'),
    linkedDirectoryGrantsPath: join(app.getPath('userData'), 'linked-directory-grants.json'),
  })

  registerWorkspaceStateIpc(
    runtime.workspaceStateService!,
    runtime.trustedRendererGuard,
    runtime.settingsService,
    runtime.fileService,
    () => runtime.companyWorkspaceService,
    async (source) => {
      const result = await runtime.scheduledTaskService?.inspect(source.workspacePath)
      if (!result?.success) throw Error('原任务状态不可用，保持原关联')
      if (
        result.tasks.some(
          (task) =>
            source.taskIds.includes(task.definition.id) &&
            (task.activation.enabled ||
              ['queued', 'running'].includes(task.latestRun?.status ?? '')),
        )
      )
        throw Error('原关联仍有启用或运行的任务，请先在原任务中暂停并核对输出位置')
    },
    () => runtime.diaryChangeTracker,
  )
  registerWorkbenchTabModelIpc(
    runtime.workbenchTabModel!,
    runtime.browserBookmarkModel!,
    runtime.trustedRendererGuard,
  )
  runtime.rendererWorkspaceStateFlush = new RendererWorkspaceStateFlushCoordinator(
    runtime.mainWindow,
    runtime.trustedRendererGuard,
    { isDev: runtime.isDev },
  )
  console.log('[CCLink Studio] 工作台状态 IPC 已注册')

  try {
    runtime.companyAccountsService = new CompanyAccountsService(
      () => runtime.workspaceStateService?.getActiveLocalWorkspace().workspacePath ?? null,
      async ({ prompt, workspacePath }) => {
        if (!runtime.agentBridge) throw new Error('本地 Agent 尚未就绪')
        return runtime.agentBridge.requestInternalText({
          purpose: 'company-accounts-classification',
          prompt,
          workspacePath,
        })
      },
    )
    registerCompanyAccountsIpc(() => runtime.companyAccountsService, runtime.trustedRendererGuard)
    console.log('[CCLink Studio] 公司账目 IPC 已注册')
  } catch (error) {
    runtime.companyAccountsService = null
    console.error('[CCLink Studio] 公司账目能力初始化失败，其他本地能力继续启动:', error)
  }

  try {
    const readKey = (id: string): string | null => {
      try {
        return runtime.credentialService?.resolveCredential(id)?.apiKey?.trim() || null
      } catch {
        return null
      }
    }
    runtime.webSearchService = new WebSearchService({
      statePath: join(app.getPath('userData'), 'web-search', 'state.json'),
      resolveAgentKey: () =>
        runtime.settingsService?.getAll().provider === 'deepseek' ? readKey('agent:default') : null,
      resolveOwnKey: () => readKey(WEB_SEARCH_OWN_CREDENTIAL_ID),
    })
    await runtime.webSearchService.load()
    registerWebSearchIpc(() => runtime.webSearchService, runtime.trustedRendererGuard)
    console.log('[CCLink Studio] 联网搜索 IPC 已注册')
  } catch (error) {
    runtime.webSearchService = null
    console.error('[CCLink Studio] 联网搜索初始化失败，其他本地能力继续启动:', error)
  }

  try {
    const credentials = (): NonNullable<typeof runtime.credentialService> => {
      if (!runtime.credentialService) throw new Error('凭证存储不可用')
      return runtime.credentialService
    }
    runtime.techDailyService = new TechDailyService({
      dataDirectory: join(app.getPath('userData'), 'techdaily'),
      personalRoot: () => {
        try {
          return runtime.workspaceStateService?.getFixedSpaces().personal?.workspacePath ?? null
        } catch {
          return null
        }
      },
      deepSeek: {
        search: (input, options) => {
          if (!runtime.webSearchService) throw new Error('联网搜索当前不可用')
          return runtime.webSearchService.search(input, options)
        },
        unavailableReason: () => {
          const status = runtime.webSearchService?.getStatus()
          if (!status) return '联网搜索当前不可用'
          return status.state === 'ready' ? null : (status.reason ?? '联网搜索不可用')
        },
      },
      credentials: {
        resolve: (id) => {
          try {
            return runtime.credentialService?.resolveCredential(id) ?? null
          } catch {
            return null
          }
        },
        set: async (id, fields) => {
          await credentials().setCredential({ id, kind: 'basic', fields })
        },
        remove: async (id) => {
          if (credentials().resolveCredential(id)) await credentials().removeCredential(id)
        },
      },
      credentialId: SEARXNG_CREDENTIAL_ID,
      timezone: async (root) =>
        (await readWorkspaceSettings(root, 'diary')).settings.diary?.timezone ??
        defaultDiaryTimezone,
    })
    registerTechDailyIpc(() => runtime.techDailyService, runtime.trustedRendererGuard)
    console.log('[CCLink Studio] 科技日报 IPC 已注册')
  } catch (error) {
    runtime.techDailyService = null
    console.error('[CCLink Studio] 科技日报初始化失败，其他本地能力继续启动:', error)
  }

  registerScheduledTaskIpc(
    runtime.scheduledTaskService!,
    runtime.trustedRendererGuard,
    runtime.mainWindow,
  )
  console.log('[CCLink Studio] 定时任务 IPC 已注册')
  registerOwnerReadme(
    runtime.trustedRendererGuard,
    async () => {
      const bridge = runtime.agentBridge
      if (!bridge) return { ok: false, error: 'Agent 服务未就绪' }
      try {
        const selected = await bridge.selectAgentForNewSession()
        const kind = selected.binding.kind
        if (kind !== 'codex' && kind !== 'claude-code')
          return { ok: false, error: '不支持的 Agent：' + kind }
        console.info('[Owner] 新会话选用 Agent', { kind, reason: selected.reason })
        return { ok: true, kind, reason: selected.reason }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    () => runtime.credentialService?.resolveCredential('git:github')?.token ?? null,
  )
  const ownerRegistry = join(app.getPath('userData'), 'owner-directories')
  const personalSpace = async () => {
    const spaces = await runtime.workspaceStateService!.ensurePersonalSpace(
      runtime.settingsService?.getAll().defaultWorkspacePath,
      { createDefault: false },
    )
    if (!spaces.personal) throw Error('请先设置个人空间目录')
    return spaces.personal.workspacePath
  }
  const pickDirectory = async (title: string, buttonLabel: string) => {
    const window = runtime.mainWindow
    const options = {
      title,
      buttonLabel,
      properties: ['openDirectory' as const, 'createDirectory' as const],
    }
    const result =
      window && !window.isDestroyed()
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
    return result.canceled ? undefined : result.filePaths[0]
  }
  // Sources and preferences reference each other lazily: grants count for settings,
  // registered directories as grant candidates.
  let ownerSources: OwnerSourceDirectories | null = null
  const ownerPreferences = new OwnerPreferences(
    ownerRegistry,
    personalSpace,
    (purpose) =>
      purpose === 'output'
        ? pickDirectory('选择新事务的保存位置', '设为保存位置')
        : pickDirectory('登记常用参考目录', '登记此目录'),
    (dev, ino) => ownerSources?.grantedAffairs(dev, ino) ?? Promise.resolve(0),
  )
  const ownerAffairs = new AffairDirectoryService(ownerRegistry, personalSpace, () =>
    ownerPreferences.affairParent(),
  )
  ownerSources = new OwnerSourceDirectories(
    ownerRegistry,
    ownerAffairs,
    () => pickDirectory('选择本事务的只读参考目录', '选择此目录'),
    (rootId) => ownerPreferences.reference(rootId),
  )
  registerOwnerDirectories(runtime.trustedRendererGuard, ownerAffairs)
  const ownerFiles = new OwnerSourceFiles(ownerRegistry, ownerAffairs, ownerSources)
  registerOwnerSources(runtime.trustedRendererGuard, ownerSources, ownerFiles, async (req) => {
    const permissions = runtime.permissionManager
    if (!permissions) return 'denied'
    // Owner's prompt goes through the shared mechanism; the path comes from a note, so it is
    // always asked, shown in full and never remembered as "always allow".
    return permissions.requestDecision({
      conversationId: req.conversationId,
      toolName: 'owner_read_local_file',
      params: { path: req.path },
      riskLevel: 'read',
      allowAlways: false,
      reason: 'Owner 想读取一个不在本事务参考目录中的文件',
    })
  })
  registerOwnerPreferences(runtime.trustedRendererGuard, ownerPreferences)
  registerModelUsageIpc(runtime.usageLedgerService!.modelUsage, runtime.trustedRendererGuard)

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

  runtime.diagnosticsIpcCleanup = registerDiagnosticsIpc(runtime.trustedRendererGuard)
  console.log('[CCLink Studio] 诊断日志 IPC 已注册')

  registerRuntimeComponentsIpc(runtime.runtimeComponentManager!, runtime.trustedRendererGuard, {
    beginManagedClaudeMutation: () => {
      const agentBridge = runtime.agentBridge
      if (!agentBridge) return () => undefined
      if (!agentBridge.beginConfigurationChange()) return null
      return () => agentBridge.endConfigurationChange()
    },
    isManagedClaudeSelected: () =>
      runtime.settingsService?.getRuntimeSettings().claudeRuntimeSource === 'managed',
    activateManagedClaude: (version) =>
      activateInstalledManagedClaude(
        version,
        runtime.settingsService!,
        runtime.claudeRuntimeManager,
        runtime.agentBridge,
        async () => {
          const { bootstrapAgentRuntime } = await import('./agent-runtime')
          await bootstrapAgentRuntime(runtime)
        },
      ),
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

  registerFsIpc(runtime.fileService, runtime.settingsService, runtime.trustedRendererGuard)
  console.log('[CCLink Studio] 文件系统 IPC 已注册')

  try {
    runtime.gitWorkspaceService = new GitWorkspaceService(runtime.workspaceStateService!, {
      decide: async (prompt) => {
        if (!runtime.agentBridge) throw Error('AI 未就绪，请稍后继续同步')
        return runtime.agentBridge.requestInternalText({
          purpose: 'diary-sync',
          prompt,
          timeoutMs: 90000,
        })
      },
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
      companyPreview: async (root) => {
        const { settings } = await readWorkspaceSettings(root)
        if (settings.type !== 'company') return undefined
        const ledger = join(root, '.cclink-studio', 'company-accounts')
        return countCompanyRows({
          company: {
            path: join(root, '.cclink-studio', 'company-workspace', 'company.sqlite'),
            create: async () => {},
          },
          accounts: {
            path: join(ledger, 'accounts.sqlite'),
            documents: '',
            create: async () => {},
          },
        })
      },
      projectHooks: async (root) => {
        const { settings } = await readWorkspaceSettings(root)
        if (settings.type !== 'company') return undefined
        const workspaceId = await runtime.workspaceStateService?.getLocalProjectId(root)
        if (!workspaceId) return undefined
        const target = { workspacePath: root, workspaceId }
        const ledger = join(root, '.cclink-studio', 'company-accounts')
        const hooks = companySyncHooks(root, {
          company: {
            path: join(root, '.cclink-studio', 'company-workspace', 'company.sqlite'),
            create: async () => {
              if (!runtime.companyWorkspaceService) throw Error('公司服务未就绪')
              await runtime.companyWorkspaceService.ensureDatabaseForSync(target)
            },
          },
          accounts: {
            path: join(ledger, 'accounts.sqlite'),
            documents: join(ledger, 'documents'),
            create: async () => {
              if (!runtime.companyAccountsService) throw Error('公司账目服务未就绪')
              runtime.companyAccountsService.initializeForWorkspace(root)
            },
          },
          changed: () => void runtime.companyWorkspaceService?.notifySynced(target).catch(() => {}),
        })
        return { ...hooks, describeRecordConflict }
      },
      assertPrivateRepository: async (remoteUrl) => {
        if (!runtime.gitBackupService) throw Error('GitHub 账号服务未就绪')
        return runtime.gitBackupService.assertPrivateRepository(remoteUrl)
      },
    })
    registerGitIpc(runtime.gitWorkspaceService, runtime.trustedRendererGuard, runtime.fileService)
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

  runtime.webServiceStartupFailures = {}
  try {
    runtime.webResourceService = new WebResourceService()
    await runtime.webResourceService.load()
    console.log('[CCLink Studio] 网站与账号服务已初始化')
  } catch (error) {
    runtime.webResourceService = null
    runtime.webServiceStartupFailures['web-resources'] = createWebServiceStartupFailure(
      'web-resources',
      error,
    )
    console.error('[CCLink Studio] 网站与账号服务初始化失败，其他本地能力继续启动:', error)
  }
  registerWebResourceIpc(
    () => runtime.webResourceService,
    () => runtime.projectOpsService,
    () => runtime.workspaceStateService,
    runtime.trustedRendererGuard,
    () => runtime.browserManager,
    () => runtime.webServiceStartupFailures['web-resources'],
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
    runtime.webServiceStartupFailures['web-affairs'] = createWebServiceStartupFailure(
      'web-affairs',
      error,
    )
    console.error('[CCLink Studio] 事务服务初始化失败，其他本地能力继续启动:', error)
  }
  registerWebAffairIpc(
    () => runtime.webAffairService,
    runtime.trustedRendererGuard,
    () => runtime.browserTaskRuntime,
    () => runtime.workspaceStateService,
    () => runtime.imageResearchService,
    () => runtime.webServiceStartupFailures['web-affairs'],
  )
  console.log('[CCLink Studio] 事务 IPC 已注册')

  runtime.articlePublishingService =
    runtime.fileService && runtime.webAffairService
      ? new ArticlePublishingService(runtime.fileService, runtime.webAffairService, undefined, {
          getAgentBridge: () => runtime.agentBridge,
          getBrowserManager: () => runtime.browserManager,
          getBrowserTaskRuntime: () => runtime.browserTaskRuntime,
          getPlaywrightBridge: () => runtime.playwrightBridge,
        })
      : null
  registerArticlePublishingIpc(
    () => runtime.articlePublishingService,
    () => runtime.workspaceStateService,
    runtime.trustedRendererGuard,
  )
  console.log('[CCLink Studio] 文章发布 IPC 已注册')

  runtime.imageResearchService = runtime.webAffairService
    ? new ImageResearchService(runtime.webAffairService, {
        getAgentBridge: () => runtime.agentBridge,
        getBrowserManager: () => runtime.browserManager,
        getBrowserTaskRuntime: () => runtime.browserTaskRuntime,
      })
    : null

  try {
    registerWechatIPC(runtime.trustedRendererGuard)
    console.log('[CCLink Studio] 微信格式转换 IPC 已注册')
  } catch (error) {
    console.error('[CCLink Studio] 微信格式转换 IPC 注册失败，其他本地能力继续启动:', error)
  }

  runtime.permissionManager = new PermissionManager(runtime.mainWindow)
  runtime.permissionManager.setMode(runtime.settingsService.getAll().permissionMode)

  runtime.mcpClientMgr = new McpClientManager(runtime.credentialService)
  await runtime.mcpClientMgr.loadFromConfig()

  registerAgentIpc({
    messageImageRoot: join(app.getPath('userData'), 'agent-message-images'),
    trustedRendererGuard: runtime.trustedRendererGuard,
    getAgentBridge: () => runtime.agentBridge,
    getAgentRuntimeStateStore: () => runtime.agentRuntimeStateStore,
    getAgentRoleRegistry: () => runtime.agentRoleRegistry,
    getDefaultAgentRoleRef: () => runtime.settingsService!.getAll().defaultAgentRoleRef,
    permissionManager: runtime.permissionManager,
    getSettingsService: () => runtime.settingsService,
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

  const mutateAgentCredentials = registerSettingsIpc(
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
    (input) =>
      testClaudeModelConnection({
        ...input,
        createUsageObserver: runtime.usageLedgerService?.startModelRun,
      }),
    async (track) => {
      await runtime.updateService?.setTrack(track)
    },
  )
  console.log('[CCLink Studio] 设置 IPC 已注册')
  registerCredentialsIpc(
    runtime.credentialService,
    runtime.trustedRendererGuard,
    mutateAgentCredentials,
  )
  console.log('[CCLink Studio] 本地凭证 IPC 已注册')

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
  const installerCandidate = dmgInspector
    ? new MacUpdateInstaller({
        currentAppBundlePath: resolve(app.getPath('exe'), '..', '..', '..'),
        currentVersion: app.getVersion(),
        cacheRoot: join(app.getPath('userData'), 'updates'),
        helperPath: join(process.resourcesPath, 'update-helper', 'cclink-update-helper'),
        verifier: dmgInspector,
      })
    : undefined
  const installer =
    installerCandidate && (await installerCandidate.isAvailable()) ? installerCandidate : undefined
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
    installer,
    installLifecycle: installer ? createUpdateInstallLifecycle(runtime) : undefined,
    pendingInstallStartup: process.argv.some((value) =>
      /^--cclink-update=[0-9a-f-]{36}$/.test(value),
    ),
  })
  await runtime.updateService.start()
  const unsubscribeUpdaterIpc = registerUpdaterIpc(
    runtime.updateService,
    runtime.mainWindow,
    runtime.trustedRendererGuard,
  )
  const inputGuard = (event: Event): void => {
    if (runtime.updateService?.getSnapshot().phase === 'installing') event.preventDefault()
  }
  const updateWebContents = runtime.mainWindow.webContents
  updateWebContents.on('before-input-event', inputGuard)
  runtime.updateSnapshotUnsubscribe = () => {
    unsubscribeUpdaterIpc()
    if (!updateWebContents.isDestroyed())
      updateWebContents.removeListener('before-input-event', inputGuard)
  }
  console.log(`[CCLink Studio] 更新服务已初始化 (provider=${provider.id})`)

  await bootstrapOptionalMainServices(runtime)
}

export async function shutdownMainProcessServices(
  runtime: CclinkStudioRuntimeState,
): Promise<void> {
  await runShutdownStep('CodexDiagnostics', () => runtime.diagnosticsIpcCleanup?.())
  runtime.diagnosticsIpcCleanup = null
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
  await runShutdownStep('ArticlePublishingService', () =>
    runtime.articlePublishingService?.dispose(),
  )
  await runShutdownStep('ImageResearchService', () => runtime.imageResearchService?.dispose())
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
  runtime.webServiceStartupFailures = {}
  runtime.articlePublishingService = null
  runtime.imageResearchService = null
  runtime.permissionManager = null
  runtime.mcpClientMgr = null
  runtime.cadConversionService = null
  runtime.cadModificationService?.destroy()
  runtime.cadModificationService = null
  runtime.hardwareService = null
  runtime.dataSourceService = null
  runtime.companyAccountsService = null
  runtime.webSearchService = null
  runtime.techDailyService?.close()
  runtime.techDailyService = null
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
