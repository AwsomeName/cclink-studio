import { bindIpcParser, bindNoArgsIpc } from './contract'
import { runtimeComponentsIpc, type RuntimeResourceComponentId } from './runtime-components'

export const runtimeComponentsIpcContracts = {
  getManagedClaudeStatus: bindNoArgsIpc(runtimeComponentsIpc.getManagedClaudeStatus),
  checkManagedClaude: bindNoArgsIpc(runtimeComponentsIpc.checkManagedClaude),
  installManagedClaude: bindNoArgsIpc(runtimeComponentsIpc.installManagedClaude),
  repairManagedClaude: bindNoArgsIpc(runtimeComponentsIpc.repairManagedClaude),
  uninstallManagedClaude: bindNoArgsIpc(runtimeComponentsIpc.uninstallManagedClaude),
  listRuntimeResources: bindNoArgsIpc(runtimeComponentsIpc.listRuntimeResources),
  checkRuntimeResource: bindIpcParser(
    runtimeComponentsIpc.checkRuntimeResource,
    parseRuntimeResourceId,
  ),
  installRuntimeResource: bindIpcParser(
    runtimeComponentsIpc.installRuntimeResource,
    parseRuntimeResourceId,
  ),
  repairRuntimeResource: bindIpcParser(
    runtimeComponentsIpc.repairRuntimeResource,
    parseRuntimeResourceId,
  ),
  uninstallRuntimeResource: bindIpcParser(
    runtimeComponentsIpc.uninstallRuntimeResource,
    parseRuntimeResourceId,
  ),
} as const

function parseRuntimeResourceId(args: unknown[]): [componentId: RuntimeResourceComponentId] {
  if (args.length !== 1) throw new Error('Runtime 资源操作需要一个组件 ID')
  const componentId = args[0]
  if (
    componentId !== 'occt-runtime' &&
    componentId !== 'scrcpy-server' &&
    componentId !== 'agent-device-android-helpers'
  ) {
    throw new Error('Runtime 资源组件 ID 不在允许目录')
  }
  return [componentId]
}
