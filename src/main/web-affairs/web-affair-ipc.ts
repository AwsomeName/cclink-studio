import { webAffairsIpcContracts } from '../../shared/web-affairs/web-affair-contract'
import type {
  WebAffair,
  WebAffairOperationResult,
  WebAffairProjectSnapshot,
  WebAffairWorkspaceScopeInput,
} from '../../shared/web-affairs/web-affair-types'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { WebAffairService } from './web-affair-service'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'

function unavailable<T>(): WebAffairOperationResult<T> {
  return {
    success: false,
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: '事务服务当前不可用，其他工作台能力不受影响',
    },
  }
}

async function invokeScoped<T>(
  input: WebAffairWorkspaceScopeInput,
  getService: () => WebAffairService | null,
  getWorkspaceStateService: () => WorkspaceStateService | null,
  invoke: (
    service: WebAffairService,
    workspaceId: string,
  ) => Promise<WebAffairOperationResult<T>> | WebAffairOperationResult<T>,
): Promise<WebAffairOperationResult<T>> {
  const service = getService()
  if (!service) return unavailable()
  const workspaceId = await resolveWorkspaceId(input, getWorkspaceStateService())
  if (!workspaceId.success) return workspaceId
  return invoke(service, workspaceId.data)
}

export function registerWebAffairIpc(
  getService: () => WebAffairService | null,
  trustedRendererGuard: TrustedRendererGuard,
  getBrowserTaskRuntime: () => BrowserTaskRuntime | null = () => null,
  getWorkspaceStateService: () => WorkspaceStateService | null = () => null,
): void {
  registerTrustedIpcContract(
    webAffairsIpcContracts.getCatalog,
    trustedRendererGuard,
    () => getService()?.getCatalog() ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.getSnapshot,
    trustedRendererGuard,
    async (_event, input): Promise<WebAffairOperationResult<WebAffairProjectSnapshot>> =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.getProjectSnapshot(workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.createAffair,
    trustedRendererGuard,
    async (_event, input): Promise<WebAffairOperationResult<WebAffair>> =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.createAffair(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.claimLegacyAffair,
    trustedRendererGuard,
    async (_event, input): Promise<WebAffairOperationResult<WebAffair>> =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.claimLegacyAffair(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.updateNode,
    trustedRendererGuard,
    async (_event, input): Promise<WebAffairOperationResult<WebAffair>> =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.updateNode(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.reviseFlow,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.reviseFlow(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.startAttempt,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.startAttempt(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.bindAttempt,
    trustedRendererGuard,
    async (_event, input) => {
      const result = await invokeScoped(
        input,
        getService,
        getWorkspaceStateService,
        (service, workspaceId) => service.bindAttempt(input, workspaceId),
      )
      if (result.success) {
        const attempt = result.data.attempts.find((item) => item.id === input.attemptId)
        try {
          getBrowserTaskRuntime()?.updateCorrelation(input.browserTaskRunId, {
            affairId: input.affairId,
            affairNodeId: attempt?.nodeId,
            affairAttemptId: input.attemptId,
          })
        } catch (error) {
          console.warn('[WebAffairIpc] BrowserTask 关联写入失败，事务 Attempt 已保留:', error)
        }
      }
      return result
    },
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.handoffAttempt,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.handoffAttempt(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.returnAttempt,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.returnAttempt(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.confirmFinalAction,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.confirmFinalAction(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.finishAttempt,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.finishAttempt(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.scheduleCheck,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.scheduleCheck(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.completeCheck,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.completeCheck(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.proposeFlowDiff,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.proposeFlowDiff(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.decideFlowProposal,
    trustedRendererGuard,
    async (_event, input) =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.decideFlowProposal(input, workspaceId),
      ),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.inspectMaterials,
    trustedRendererGuard,
    async (_event, input): Promise<WebAffairOperationResult<WebAffair>> =>
      invokeScoped(input, getService, getWorkspaceStateService, (service, workspaceId) =>
        service.inspectMaterials(input, workspaceId),
      ),
  )
}

async function resolveWorkspaceId(
  input: WebAffairWorkspaceScopeInput,
  workspaceStateService: WorkspaceStateService | null,
): Promise<WebAffairOperationResult<string>> {
  if (input.workspaceRef.kind !== 'local' || !workspaceStateService) return workspaceRequired()
  try {
    const workspaceId = await workspaceStateService.getLocalProjectId(input.workspaceRef.path)
    return workspaceId ? { success: true, data: workspaceId } : workspaceRequired()
  } catch {
    return workspaceRequired()
  }
}

function workspaceRequired<T>(): WebAffairOperationResult<T> {
  return {
    success: false,
    error: {
      code: 'WORKSPACE_REQUIRED',
      message: '请先打开一个可写的本地工作空间，再管理事务',
    },
  }
}
