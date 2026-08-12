import { runtimeComponentsIpcContracts } from '../../shared/ipc/runtime-components-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { RuntimeComponentManager } from './runtime-component-manager'

export function registerRuntimeComponentsIpc(
  manager: RuntimeComponentManager,
  trustedRendererGuard: TrustedRendererGuard,
): void {
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.getManagedClaudeStatus,
    trustedRendererGuard,
    () => manager.getManagedClaudeStatus(),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.installManagedClaude,
    trustedRendererGuard,
    () => manager.installManagedClaude(),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.listRuntimeResources,
    trustedRendererGuard,
    () => manager.listRuntimeResources(),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.installRuntimeResource,
    trustedRendererGuard,
    (_event, componentId) => manager.installRuntimeResource(componentId),
  )
}
