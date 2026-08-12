import { bindIpcParser, bindNoArgsIpc } from './contract'
import { runtimeComponentsIpc } from './runtime-components'

export const runtimeComponentsIpcContracts = {
  getManagedClaudeStatus: bindNoArgsIpc(runtimeComponentsIpc.getManagedClaudeStatus),
  installManagedClaude: bindNoArgsIpc(runtimeComponentsIpc.installManagedClaude),
  listRuntimeResources: bindNoArgsIpc(runtimeComponentsIpc.listRuntimeResources),
  installRuntimeResource: bindIpcParser(runtimeComponentsIpc.installRuntimeResource, (args) => {
    if (args.length !== 1) throw new Error('安装 Runtime 资源需要一个组件 ID')
    const componentId = args[0]
    if (
      componentId !== 'occt-runtime' &&
      componentId !== 'scrcpy-server' &&
      componentId !== 'agent-device-android-helpers'
    ) {
      throw new Error('Runtime 资源组件 ID 不在允许目录')
    }
    return [componentId] as [typeof componentId]
  }),
} as const
