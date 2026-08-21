import { webResourcesIpcContracts } from '../../shared/web-resources/web-resource-contract'
import type {
  ClaimLegacyWebConnectionsSummary,
  ImportProjectOpsConfigSummary,
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceSnapshot,
  WebResourceProjectScopeInput,
} from '../../shared/web-resources/web-resource-types'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { WebResourceService } from './web-resource-service'
import type { ProjectOpsService } from '../project-ops/project-ops-service'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import type { BrowserManager } from '../browser/browser-manager'
import { workspaceRefKey } from '../../shared/workspace-ref'

function unavailable<T>(): WebResourceOperationResult<T> {
  return {
    success: false,
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: '网站与账号服务当前不可用，其他工作台能力不受影响',
    },
  }
}

export function registerWebResourceIpc(
  getService: () => WebResourceService | null,
  getProjectOpsService: () => ProjectOpsService | null,
  getWorkspaceStateService: () => WorkspaceStateService | null,
  trustedRendererGuard: TrustedRendererGuard,
  getBrowserManager: () => BrowserManager | null = () => null,
): void {
  registerTrustedIpcContract(
    webResourcesIpcContracts.getSnapshot,
    trustedRendererGuard,
    async (_event, _input): Promise<WebResourceOperationResult<WebResourceSnapshot>> => {
      const service = getService()
      if (!service) return unavailable()
      return service.getSnapshot()
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.createConnection,
    trustedRendererGuard,
    async (_event, input): Promise<WebResourceOperationResult<WebResourceConnection>> => {
      const service = getService()
      const projectId = await resolveProjectId(input, getWorkspaceStateService())
      if (!service) return unavailable()
      if (!projectId.success) return projectId
      return service.createConnection(input, projectId.data)
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.beginDraft,
    trustedRendererGuard,
    async (_event, input) => {
      const service = getService()
      const browserManager = getBrowserManager()
      const projectId = await resolveProjectId(input, getWorkspaceStateService())
      if (!service) return unavailable()
      if (!projectId.success) return projectId
      const adoptableProfileId = input.tabId
        ? browserManager?.getDraftAdoptionProfileId(
            input.tabId,
            workspaceRefKey(input.workspaceRef),
          )
        : undefined
      if (input.tabId && adoptableProfileId === undefined) {
        return {
          success: false,
          error: {
            code: 'INVALID_BROWSER_STATE',
            message: '当前浏览器标签页已切换或尚未就绪，请重试',
          },
        }
      }
      if (input.tabId && adoptableProfileId === null) {
        return {
          success: false,
          error: {
            code: 'INVALID_BROWSER_STATE',
            message:
              '当前页面使用默认或共享登录环境，不能在不丢失登录状态的情况下转为独立账号。页面和登录状态已保留，请从“网站与账号”添加后再登录保存。',
          },
        }
      }
      return service.beginDraft(projectId.data, adoptableProfileId)
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.saveDraft,
    trustedRendererGuard,
    async (_event, input) => {
      const service = getService()
      const browserManager = getBrowserManager()
      const projectId = await resolveProjectId(input, getWorkspaceStateService())
      if (!service || !browserManager) return unavailable()
      if (!projectId.success) return projectId
      const runtime = await browserManager.getRuntimeDiagnostics(input.tabId)
      return service.saveDraft(projectId.data, input, {
        url: runtime.visibleUrl,
        title: runtime.visibleTitle,
        profileId: runtime.profileId,
      })
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.cancelDraft,
    trustedRendererGuard,
    async (_event, input) => {
      const service = getService()
      const browserManager = getBrowserManager()
      const projectId = await resolveProjectId(input, getWorkspaceStateService())
      if (!service || !browserManager) return unavailable()
      if (!projectId.success) return projectId
      const runtime = await browserManager.getRuntimeDiagnostics(input.tabId)
      return service.cancelDraft(projectId.data, input.draftId, runtime.profileId, (profileId) =>
        browserManager.clearProfileData(profileId),
      )
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.resolveLaunch,
    trustedRendererGuard,
    async (_event, input) => {
      const service = getService()
      const projectId = await resolveProjectId(input, getWorkspaceStateService())
      if (!service) return unavailable()
      if (!projectId.success) return projectId
      return service.resolveLaunch(input.accountId)
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.confirmLogin,
    trustedRendererGuard,
    async (_event, input): Promise<WebResourceOperationResult<WebResourceConnection>> => {
      const service = getService()
      if (!service) return unavailable()
      return service.confirmLogin(input.accountId)
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.claimLegacyConnections,
    trustedRendererGuard,
    async (
      _event,
      input,
    ): Promise<WebResourceOperationResult<ClaimLegacyWebConnectionsSummary>> => {
      const service = getService()
      const projectId = await resolveProjectId(input, getWorkspaceStateService())
      if (!service) return unavailable()
      if (!projectId.success) return projectId
      return service.claimLegacyConnections(projectId.data)
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.importProjectOpsConfig,
    trustedRendererGuard,
    async (_event, input): Promise<WebResourceOperationResult<ImportProjectOpsConfigSummary>> => {
      const service = getService()
      const projectOpsService = getProjectOpsService()
      const workspaceStateService = getWorkspaceStateService()
      if (!service || !projectOpsService || !workspaceStateService) return unavailable()

      try {
        const projectId = await workspaceStateService.getLocalProjectId(input.workspacePath)
        if (!projectId) return projectRequired()
        const legacy = await projectOpsService.getAccounts(input.workspacePath)
        if (!legacy.exists) {
          return {
            success: false,
            error: {
              code: 'PROJECT_OPS_CONFIG_NOT_FOUND',
              message: '当前项目没有 cclink-accounts.json',
            },
          }
        }
        if (!legacy.config || legacy.error || legacy.issues.length > 0) {
          return {
            success: false,
            error: {
              code: 'PROJECT_OPS_CONFIG_INVALID',
              message: legacy.error ?? '旧运营配置格式不正确',
            },
          }
        }

        let importedCount = 0
        let skippedCount = 0
        for (const platform of legacy.config.platforms) {
          const result = await service.createConnection(
            {
              workspaceRef: { kind: 'local', path: input.workspacePath },
              websiteName: platform.name,
              entryUrl: platform.url,
              websiteNotes: platform.notes,
              principalKind: input.principalKind,
              principalName: input.principalName,
              accountLabel: platform.account?.trim() || `${input.principalName} · ${platform.name}`,
              loginHint: platform.notes,
            },
            projectId,
            platform.browserProfile || platform.id,
          )
          if (result.success) {
            importedCount += 1
            continue
          }
          if (result.error.code === 'DUPLICATE_ACCOUNT') {
            skippedCount += 1
            continue
          }
          return importedCount > 0
            ? {
                success: false,
                error: {
                  ...result.error,
                  message: `已导入 ${importedCount} 个账号后中止：${result.error.message}。修复后可重试，已存在账号会自动跳过。`,
                },
              }
            : result
        }

        return {
          success: true,
          data: {
            sourceFilePath: legacy.filePath,
            totalCount: legacy.config.platforms.length,
            importedCount,
            skippedCount,
          },
        }
      } catch (error) {
        console.error('[WebResourceIPC] 旧运营配置导入失败:', error)
        return {
          success: false,
          error: {
            code: 'PROJECT_OPS_CONFIG_INVALID',
            message: '无法读取或导入旧运营配置',
          },
        }
      }
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.createAccountGroup,
    trustedRendererGuard,
    async (_event, input) => getService()?.createAccountGroup(input) ?? unavailable(),
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.updateAccountGroup,
    trustedRendererGuard,
    async (_event, input) => getService()?.updateAccountGroup(input) ?? unavailable(),
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.archiveAccountGroup,
    trustedRendererGuard,
    async (_event, input) => getService()?.archiveAccountGroup(input.groupId) ?? unavailable(),
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.archiveAccount,
    trustedRendererGuard,
    async (_event, input) => getService()?.archiveAccount(input.accountId) ?? unavailable(),
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.mergeAccounts,
    trustedRendererGuard,
    async (_event, input) => getService()?.mergeAccounts(input) ?? unavailable(),
  )
}

async function resolveProjectId(
  input: WebResourceProjectScopeInput,
  workspaceStateService: WorkspaceStateService | null,
): Promise<WebResourceOperationResult<string>> {
  if (input.workspaceRef.kind !== 'local' || !workspaceStateService) return projectRequired()
  try {
    const projectId = await workspaceStateService.getLocalProjectId(input.workspaceRef.path)
    return projectId ? { success: true, data: projectId } : projectRequired()
  } catch {
    return projectRequired()
  }
}

function projectRequired<T>(): WebResourceOperationResult<T> {
  return {
    success: false,
    error: {
      code: 'PROJECT_REQUIRED',
      message: '请先打开一个可写的本地项目，再管理网站与账号',
    },
  }
}
