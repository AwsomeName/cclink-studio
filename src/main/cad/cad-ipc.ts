import { cadIpcContracts } from '../../shared/ipc/workbench-contract'
import type { CadConversionService } from './cad-conversion-service'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

export function registerCadIpc(
  cadConversionService: CadConversionService | (() => CadConversionService | null),
  trustedRendererGuard: TrustedRendererGuard,
): void {
  const getService = (): CadConversionService => {
    const service =
      typeof cadConversionService === 'function' ? cadConversionService() : cadConversionService
    if (!service) throw new Error('CAD 转换能力当前不可用，请查看 Agent 能力状态')
    return service
  }

  registerTrustedIpcContract(cadIpcContracts.getBackendStatus, trustedRendererGuard, () =>
    getService().getBackendStatus(),
  )
  registerTrustedIpcContract(
    cadIpcContracts.getModelSupport,
    trustedRendererGuard,
    (_event, inputPath) => getService().getModelSupport(inputPath),
  )
  registerTrustedIpcContract(
    cadIpcContracts.inspectModel,
    trustedRendererGuard,
    (_event, inputPath) => getService().inspectModel(inputPath),
  )
  registerTrustedIpcContract(cadIpcContracts.getCacheStatus, trustedRendererGuard, () =>
    getService().getCacheStatus(),
  )
  registerTrustedIpcContract(cadIpcContracts.clearCache, trustedRendererGuard, () =>
    getService().clearCache(),
  )
  registerTrustedIpcContract(
    cadIpcContracts.convertModel,
    trustedRendererGuard,
    (_event, request) => getService().convertModel(request),
  )
}
