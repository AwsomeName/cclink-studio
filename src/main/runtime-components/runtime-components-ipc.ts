import { runtimeComponentsIpcContracts } from '../../shared/ipc/runtime-components-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { RuntimeComponentManager } from './runtime-component-manager'

export interface RuntimeComponentsIpcDependencies {
  beginManagedClaudeMutation?: () => (() => void) | null
  isManagedClaudeActive?: () => boolean
}

export function registerRuntimeComponentsIpc(
  manager: RuntimeComponentManager,
  trustedRendererGuard: TrustedRendererGuard,
  dependencies: RuntimeComponentsIpcDependencies = {},
): void {
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.getManagedClaudeStatus,
    trustedRendererGuard,
    () => manager.getManagedClaudeStatus(),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.checkManagedClaude,
    trustedRendererGuard,
    () => manager.checkManagedClaude(),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.installManagedClaude,
    trustedRendererGuard,
    () => manager.installManagedClaude(),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.repairManagedClaude,
    trustedRendererGuard,
    () => withManagedClaudeMutationLock(manager, dependencies, () => manager.repairManagedClaude()),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.uninstallManagedClaude,
    trustedRendererGuard,
    () =>
      withManagedClaudeMutationLock(manager, dependencies, () => {
        if (dependencies.isManagedClaudeActive?.()) {
          return Promise.resolve({
            success: false,
            status: manager.getManagedClaudeStatus(),
            error: 'COMPONENT_IN_USE: 请先在 Agent 设置中切换到系统或自定义 Runtime',
          })
        }
        return manager.uninstallManagedClaude()
      }),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.listRuntimeResources,
    trustedRendererGuard,
    () => manager.listRuntimeResources(),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.checkRuntimeResource,
    trustedRendererGuard,
    (_event, componentId) => manager.checkRuntimeResource(componentId),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.installRuntimeResource,
    trustedRendererGuard,
    (_event, componentId) => manager.installRuntimeResource(componentId),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.repairRuntimeResource,
    trustedRendererGuard,
    (_event, componentId) => manager.repairRuntimeResource(componentId),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.uninstallRuntimeResource,
    trustedRendererGuard,
    (_event, componentId) => manager.uninstallRuntimeResource(componentId),
  )
}

async function withManagedClaudeMutationLock(
  manager: RuntimeComponentManager,
  dependencies: RuntimeComponentsIpcDependencies,
  operation: () => ReturnType<RuntimeComponentManager['repairManagedClaude']>,
): Promise<Awaited<ReturnType<RuntimeComponentManager['repairManagedClaude']>>> {
  const release = dependencies.beginManagedClaudeMutation
    ? dependencies.beginManagedClaudeMutation()
    : () => undefined
  if (!release) {
    return {
      success: false,
      status: manager.getManagedClaudeStatus(),
      error: 'COMPONENT_IN_USE: Agent 正在响应，请在任务结束后重试',
    }
  }
  try {
    return await operation()
  } finally {
    release()
  }
}
