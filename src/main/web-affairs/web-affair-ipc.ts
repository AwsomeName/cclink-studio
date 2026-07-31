import { webAffairsIpcContracts } from '../../shared/web-affairs/web-affair-contract'
import type {
  WebAffair,
  WebAffairOperationResult,
  WebAffairSnapshot,
} from '../../shared/web-affairs/web-affair-types'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { WebAffairService } from './web-affair-service'
import type { BrowserTaskRuntime } from '../browser/browser-task-runtime'

function unavailable<T>(): WebAffairOperationResult<T> {
  return {
    success: false,
    error: {
      code: 'SERVICE_UNAVAILABLE',
      message: '事务服务当前不可用，其他工作台能力不受影响',
    },
  }
}

export function registerWebAffairIpc(
  getService: () => WebAffairService | null,
  trustedRendererGuard: TrustedRendererGuard,
  getBrowserTaskRuntime: () => BrowserTaskRuntime | null = () => null,
): void {
  registerTrustedIpcContract(
    webAffairsIpcContracts.getCatalog,
    trustedRendererGuard,
    () => getService()?.getCatalog() ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.getSnapshot,
    trustedRendererGuard,
    (): WebAffairOperationResult<WebAffairSnapshot> => getService()?.getSnapshot() ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.createAffair,
    trustedRendererGuard,
    async (_event, input): Promise<WebAffairOperationResult<WebAffair>> =>
      getService()?.createAffair(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.updateNode,
    trustedRendererGuard,
    async (_event, input): Promise<WebAffairOperationResult<WebAffair>> =>
      getService()?.updateNode(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.reviseFlow,
    trustedRendererGuard,
    async (_event, input) => getService()?.reviseFlow(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.startAttempt,
    trustedRendererGuard,
    async (_event, input) => getService()?.startAttempt(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.bindAttempt,
    trustedRendererGuard,
    async (_event, input) => {
      const result = (await getService()?.bindAttempt(input)) ?? unavailable<WebAffair>()
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
    async (_event, input) => getService()?.handoffAttempt(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.returnAttempt,
    trustedRendererGuard,
    async (_event, input) => getService()?.returnAttempt(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.confirmFinalAction,
    trustedRendererGuard,
    async (_event, input) => getService()?.confirmFinalAction(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.finishAttempt,
    trustedRendererGuard,
    async (_event, input) => getService()?.finishAttempt(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.scheduleCheck,
    trustedRendererGuard,
    async (_event, input) => getService()?.scheduleCheck(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.completeCheck,
    trustedRendererGuard,
    async (_event, input) => getService()?.completeCheck(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.proposeFlowDiff,
    trustedRendererGuard,
    async (_event, input) => getService()?.proposeFlowDiff(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.decideFlowProposal,
    trustedRendererGuard,
    async (_event, input) => getService()?.decideFlowProposal(input) ?? unavailable(),
  )
  registerTrustedIpcContract(
    webAffairsIpcContracts.inspectMaterials,
    trustedRendererGuard,
    async (_event, affairId): Promise<WebAffairOperationResult<WebAffair>> =>
      getService()?.inspectMaterials(affairId) ?? unavailable(),
  )
}
