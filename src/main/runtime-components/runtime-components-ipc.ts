import { runtimeComponentsIpcContracts } from '../../shared/ipc/runtime-components-contract'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { RuntimeComponentManager } from './runtime-component-manager'

export interface RuntimeComponentsIpcDependencies {
  beginManagedClaudeMutation?: () => (() => void) | null
  isManagedClaudeSelected?: () => boolean
  /** Runs under the same configuration lock as installation. */
  activateManagedClaude?: (version: string) => Promise<void>
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
    () =>
      withManagedClaudeMutationLock(manager, dependencies, () =>
        installAndActivate(manager, dependencies, false),
      ),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.repairManagedClaude,
    trustedRendererGuard,
    () =>
      withManagedClaudeMutationLock(manager, dependencies, () =>
        installAndActivate(manager, dependencies, true),
      ),
  )
  registerTrustedIpcContract(
    runtimeComponentsIpcContracts.uninstallManagedClaude,
    trustedRendererGuard,
    () =>
      withManagedClaudeMutationLock(manager, dependencies, () => {
        if (dependencies.isManagedClaudeSelected?.()) {
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

async function installAndActivate(
  manager: RuntimeComponentManager,
  dependencies: RuntimeComponentsIpcDependencies,
  repair: boolean,
): Promise<Awaited<ReturnType<RuntimeComponentManager['installManagedClaude']>>> {
  if (!dependencies.activateManagedClaude) {
    return {
      success: false,
      status: manager.getManagedClaudeStatus(),
      error: 'RUNTIME_UNAVAILABLE: Claude Code 启用服务未初始化，请重启 Studio 后重试。',
    }
  }
  const result = repair ? await manager.repairManagedClaude() : await manager.installManagedClaude()
  if (!result.success) return result
  try {
    const version = result.status.constrainedVersion
    if (!version || !result.status.installedVersions.includes(version)) {
      throw new Error('安装结果中缺少已验证的 Claude Code 版本')
    }
    await dependencies.activateManagedClaude(version)
    return result
  } catch (error) {
    return {
      ...result,
      success: false,
      error: `Claude Code 已安装，但启用失败：${error instanceof Error ? error.message : String(error)}。请点击“启用 Studio 版本”重试。`,
    }
  }
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
