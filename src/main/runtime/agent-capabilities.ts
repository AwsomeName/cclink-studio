import type { AgentCapabilityStatus } from '../../shared/ipc/agent'
import type { DeepInkRuntimeState } from './app-runtime'

export function getAgentCapabilities(runtime: DeepInkRuntimeState): AgentCapabilityStatus[] {
  return [
    {
      name: 'agent-backend',
      label: 'Agent',
      available: Boolean(runtime.agentBridge),
      reason: runtime.agentBridge ? undefined : 'Agent 后端未就绪',
    },
    {
      name: 'browser',
      label: 'Browser',
      available: Boolean(runtime.browserManager && runtime.playwrightBridge),
      reason: runtime.browserManager && runtime.playwrightBridge ? undefined : '浏览器自动化未就绪',
    },
    {
      name: 'editor',
      label: 'Editor',
      available: Boolean(runtime.editorModule),
      reason: runtime.editorModule ? undefined : '编辑器工具未注册',
    },
    {
      name: 'android',
      label: 'Android',
      available: runtime.activeDeviceManager?.getSource() === 'physical',
      reason:
        runtime.activeDeviceManager?.getSource() === 'physical'
          ? undefined
          : '未连接用户真机；模拟器与云手机已封存',
    },
    {
      name: 'agent-device',
      label: 'Device AI',
      available: runtime.agentDeviceManager?.isAvailable() ?? false,
      reason: runtime.agentDeviceManager?.isAvailable() ? undefined : 'agent-device 语义层不可用',
    },
    {
      name: 'meshy',
      label: 'Meshy',
      available: Boolean(runtime.meshyService),
      reason: runtime.meshyService ? undefined : 'Meshy 服务未初始化',
    },
    {
      name: 'cclink',
      label: 'CCLink',
      available: Boolean(runtime.cclinkStore && runtime.cclinkIdentityService),
      reason: runtime.cclinkStore && runtime.cclinkIdentityService ? undefined : 'CCLink 本地状态未初始化',
    },
    {
      name: 'mcp',
      label: 'MCP',
      available: Boolean(runtime.toolHost),
      reason: runtime.toolHost ? undefined : 'MCP 工具主机未启动',
    },
  ]
}
