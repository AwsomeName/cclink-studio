import { webResourcesIpcContracts } from '../../shared/web-resources/web-resource-contract'
import type {
  WebResourceConnection,
  WebResourceOperationResult,
  WebResourceSnapshot,
} from '../../shared/web-resources/web-resource-types'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { WebResourceService } from './web-resource-service'

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
}
