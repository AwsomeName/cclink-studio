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
): void {
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
}
