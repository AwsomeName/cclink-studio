import { webResourcesIpcContracts } from '../../shared/web-resources/web-resource-contract'
import type {
  ClaimLegacyWebConnectionsSummary,
  ImportProjectOpsConfigSummary,
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceProjectSnapshot,
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
    async (_event, input): Promise<WebResourceOperationResult<WebResourceProjectSnapshot>> => {
      const service = getService()
      const projectId = await resolveProjectId(input, getWorkspaceStateService())
      if (!service) return unavailable()
      if (!projectId.success) return projectId
      return service.getProjectSnapshot(projectId.data)
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
      const projectId = await resolveProjectId(input, getWorkspaceStateService())
      if (!service) return unavailable()
      if (!projectId.success) return projectId
      return service.beginDraft(projectId.data)
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
      return service.resolveLaunch(projectId.data, input.accountId)
    },
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.confirmLogin,
    trustedRendererGuard,
    async (_event, input): Promise<WebResourceOperationResult<WebResourceConnection>> => {
      const service = getService()
      const projectId = await resolveProjectId(input, getWorkspaceStateService())
      if (!service) return unavailable()
      if (!projectId.success) return projectId
      return service.confirmLogin(projectId.data, input.accountId)
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
