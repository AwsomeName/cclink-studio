import { hardwareIpcContracts } from '../../shared/ipc/workbench-contract'
import type { HardwareService } from './hardware-service'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'

export function registerHardwareIpc(
  hardwareService: HardwareService | (() => HardwareService | null),
  trustedRendererGuard: TrustedRendererGuard,
): void {
  const getService = (): HardwareService => {
    const service = typeof hardwareService === 'function' ? hardwareService() : hardwareService
    if (!service) throw new Error('硬件工作区能力当前不可用，请查看 Agent 能力状态')
    return service
  }

  registerTrustedIpcContract(
    hardwareIpcContracts.scanWorkspace,
    trustedRendererGuard,
    (_event, workspacePath) => getService().scanWorkspace(workspacePath),
  )

  registerTrustedIpcContract(
    hardwareIpcContracts.inspectProductionPackage,
    trustedRendererGuard,
    (_event, workspacePath) => getService().inspectProductionPackage(workspacePath),
  )

  registerTrustedIpcContract(
    hardwareIpcContracts.prepareFpcShapeContext,
    trustedRendererGuard,
    (_event, workspacePath) => getService().prepareFpcShapeContext(workspacePath),
  )

  registerTrustedIpcContract(
    hardwareIpcContracts.readGerberLayerPreview,
    trustedRendererGuard,
    (_event, workspacePath, packagePath, entry) =>
      getService().readGerberLayerPreview(workspacePath, packagePath, entry),
  )

  registerTrustedIpcContract(
    hardwareIpcContracts.readGerberLayerGeometry,
    trustedRendererGuard,
    (_event, workspacePath, packagePath, entry) =>
      getService().readGerberLayerGeometry(workspacePath, packagePath, entry),
  )

  registerTrustedIpcContract(
    hardwareIpcContracts.writeProductionReportMarkdown,
    trustedRendererGuard,
    (_event, workspacePath) => getService().writeProductionReportMarkdown(workspacePath),
  )
}
