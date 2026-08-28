import { articlePublishingIpcContracts } from '../../shared/article-publishing/article-publishing-contract'
import type { WebAffairOperationResult } from '../../shared/web-affairs/web-affair-types'
import type { WorkspaceRef } from '../../shared/workspace-ref'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import type { ArticlePublishingService } from './article-publishing-service'

export function registerArticlePublishingIpc(
  getService: () => ArticlePublishingService | null,
  getWorkspaceStateService: () => WorkspaceStateService | null,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(
    articlePublishingIpcContracts.inspectSource,
    trustedRendererGuard,
    async (_event, input) => {
      const service = getService()
      return service ? service.inspectSource(input) : unavailable()
    },
  )
  registerTrustedIpcContract(
    articlePublishingIpcContracts.createTask,
    trustedRendererGuard,
    async (_event, input) => {
      const resolved = await resolveWorkspaceId(input.workspaceRef, getWorkspaceStateService())
      const service = getService()
      return resolved.success && service
        ? service.createTask(input, resolved.data)
        : resolved.success
          ? unavailable()
          : resolved
    },
  )
  registerTrustedIpcContract(
    articlePublishingIpcContracts.startTask,
    trustedRendererGuard,
    async (_event, input) => {
      const resolved = await resolveWorkspaceId(input.workspaceRef, getWorkspaceStateService())
      const service = getService()
      return resolved.success && service
        ? service.startTask(input, resolved.data)
        : resolved.success
          ? unavailable()
          : resolved
    },
  )
  registerTrustedIpcContract(
    articlePublishingIpcContracts.recoverTaskLaunch,
    trustedRendererGuard,
    async (_event, input) => {
      const resolved = await resolveWorkspaceId(input.workspaceRef, getWorkspaceStateService())
      const service = getService()
      return resolved.success && service
        ? service.recoverTaskLaunch(input, resolved.data)
        : resolved.success
          ? unavailable()
          : resolved
    },
  )
  registerTrustedIpcContract(
    articlePublishingIpcContracts.reportCheckpoint,
    trustedRendererGuard,
    async (_event, input) => {
      const resolved = await resolveWorkspaceId(input.workspaceRef, getWorkspaceStateService())
      const service = getService()
      return resolved.success && service
        ? service.reportCheckpoint(input, resolved.data)
        : resolved.success
          ? unavailable()
          : resolved
    },
  )
  registerTrustedIpcContract(
    articlePublishingIpcContracts.reportAsset,
    trustedRendererGuard,
    async (_event, input) => {
      const resolved = await resolveWorkspaceId(input.workspaceRef, getWorkspaceStateService())
      const service = getService()
      return resolved.success && service
        ? service.reportAsset(input, resolved.data)
        : resolved.success
          ? unavailable()
          : resolved
    },
  )
}

async function resolveWorkspaceId(
  workspaceRef: WorkspaceRef,
  workspaceStateService: WorkspaceStateService | null,
): Promise<WebAffairOperationResult<string>> {
  if (workspaceRef.kind !== 'local' || !workspaceStateService) return workspaceRequired()
  try {
    const workspaceId = await workspaceStateService.getLocalProjectId(workspaceRef.path)
    return workspaceId ? { success: true, data: workspaceId } : workspaceRequired()
  } catch {
    return workspaceRequired()
  }
}

function workspaceRequired<T>(): WebAffairOperationResult<T> {
  return {
    success: false,
    error: { code: 'WORKSPACE_REQUIRED', message: '请先打开一个可写的本地工作空间' },
  }
}

function unavailable<T>(): WebAffairOperationResult<T> {
  return {
    success: false,
    error: { code: 'SERVICE_UNAVAILABLE', message: '文章发布服务当前不可用' },
  }
}
