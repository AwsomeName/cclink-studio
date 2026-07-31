import { webResourcesIpcContracts } from '../../shared/web-resources/web-resource-contract'
import type {
  ImportProjectOpsConfigSummary,
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceSnapshot,
} from '../../shared/web-resources/web-resource-types'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { WebResourceService } from './web-resource-service'
import type { ProjectOpsService } from '../project-ops/project-ops-service'

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
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(
    webResourcesIpcContracts.getSnapshot,
    trustedRendererGuard,
    (): WebResourceOperationResult<WebResourceSnapshot> =>
      getService()?.getSnapshot() ?? unavailable(),
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.createConnection,
    trustedRendererGuard,
    async (_event, input): Promise<WebResourceOperationResult<WebResourceConnection>> =>
      getService()?.createConnection(input) ?? unavailable(),
  )

  registerTrustedIpcContract(
    webResourcesIpcContracts.importProjectOpsConfig,
    trustedRendererGuard,
    async (_event, input): Promise<WebResourceOperationResult<ImportProjectOpsConfigSummary>> => {
      const service = getService()
      const projectOpsService = getProjectOpsService()
      if (!service || !projectOpsService) return unavailable()

      try {
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
          const result = await service.createConnection({
            websiteName: platform.name,
            entryUrl: platform.url,
            websiteNotes: platform.notes,
            principalKind: input.principalKind,
            principalName: input.principalName,
            accountLabel: platform.account?.trim() || `${input.principalName} · ${platform.name}`,
            browserProfileId: platform.browserProfile || platform.id,
            loginHint: platform.notes,
          })
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
