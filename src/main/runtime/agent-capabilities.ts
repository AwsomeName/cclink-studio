import type {
  AgentCapabilityStatus,
  AgentToolModuleStatus,
  AgentToolRisk,
} from '../../shared/ipc/agent'
import type { CclinkStudioRuntimeState } from './app-runtime'

const MODULE_CATALOG: Record<string, { label: string; description: string }> = {
  browser: { label: '浏览器自动化', description: '读取和操作内嵌浏览器、页面、下载与网络请求。' },
  editor: { label: '编辑器与文件', description: '读取目录和文档，并写入、追加、插入或保存内容。' },
  'data-source': { label: '数据源', description: '查询本机配置的数据源、集合、记录和保存的查询。' },
  hardware: { label: '硬件工作区', description: '管理硬件项目结构、生产资料和工程工作流。' },
  cad: { label: 'CAD', description: '检测、转换和检查 STEP/STP 等结构件模型。' },
  meshy: { label: 'Meshy 3D', description: '通过 Meshy 生成、查询并保存 3D 资产。' },
  'image-generation': {
    label: 'Markdown 自动配图',
    description: '根据用户明确要求生成图片，保存到文档资源目录并插入 Markdown。',
  },
  android: { label: 'Android 真机', description: '通过 ADB 检查和操作用户连接的 Android 真机。' },
  'agent-device': { label: '设备语义操作', description: '基于界面快照执行语义点击、输入和滑动。' },
  'web-affairs': {
    label: '网页事务',
    description: '读取事务事实、记录办理证据并提出待用户确认的流程变更。',
  },
  'scheduled-task': {
    label: '定时任务',
    description: '只读查询当前工作空间的 Studio 定时任务、运行状态和历史。',
  },
}

const CAPABILITY_LABELS: Record<AgentCapabilityStatus['name'], string> = {
  'agent-backend': 'Agent',
  browser: 'Browser',
  editor: 'Editor',
  terminal: 'Terminal',
  android: 'Android',
  'agent-device': 'Device AI',
  meshy: 'Meshy',
  'image-generation': 'Image Generation',
  'data-source': 'Data Source',
  hardware: 'Hardware',
  cad: 'CAD',
  cclink: 'CCLink',
  'scheduled-task': 'Scheduled Tasks',
  mcp: 'MCP',
}

const CAPABILITY_ORDER: AgentCapabilityStatus['name'][] = [
  'agent-backend',
  'mcp',
  'editor',
  'scheduled-task',
  'terminal',
  'browser',
  'android',
  'agent-device',
  'meshy',
  'image-generation',
  'data-source',
  'hardware',
  'cad',
]

export function getAgentCapabilities(runtime: CclinkStudioRuntimeState): AgentCapabilityStatus[] {
  return CAPABILITY_ORDER.map((name) => {
    let snapshot = runtime.capabilities.get(name)
    if (name === 'android' && snapshot.state !== 'failed') {
      snapshot =
        runtime.activeDeviceManager?.getSource() === 'physical'
          ? { name, state: 'ready', updatedAt: snapshot.updatedAt }
          : {
              name,
              state: 'unavailable',
              reason: '未连接用户真机',
              updatedAt: snapshot.updatedAt,
            }
    }
    if (name === 'scheduled-task' && snapshot.state !== 'failed') {
      const runtimeStatus = runtime.scheduledTaskService?.getRuntimeStatus()
      snapshot = runtimeStatus
        ? runtimeStatus.state === 'degraded'
          ? {
              name,
              state: 'degraded',
              reason: runtimeStatus.lastError?.message ?? '定时任务 Runtime 已降级',
              updatedAt: snapshot.updatedAt,
            }
          : { name, state: 'ready', updatedAt: snapshot.updatedAt }
        : {
            name,
            state: 'unavailable',
            reason: '定时任务服务未就绪',
            updatedAt: snapshot.updatedAt,
          }
    }
    return {
      name,
      label: CAPABILITY_LABELS[name],
      state: snapshot.state,
      available: snapshot.state === 'ready',
      ...(snapshot.reason ? { reason: snapshot.reason } : {}),
      updatedAt: snapshot.updatedAt,
    }
  })
}

export function getAgentToolModules(runtime: CclinkStudioRuntimeState): AgentToolModuleStatus[] {
  const modules = runtime.toolHost?.getRegisteredModules() ?? []
  return modules.map((module) => {
    const catalog = MODULE_CATALOG[module.name] ?? {
      label: module.name,
      description: 'CCLink Studio 内置工具模块。',
    }
    const availability = getModuleAvailability(module.name, runtime)
    return {
      id: module.name,
      label: catalog.label,
      description: catalog.description,
      enabled: module.enabled,
      available: availability.available,
      ...(availability.reason ? { reason: availability.reason } : {}),
      toolCount: module.tools.length,
      tools: module.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        risk: getToolRisk(tool.annotations),
      })),
    }
  })
}

function getToolRisk(annotations: {
  readOnlyHint: boolean
  destructiveHint: boolean
}): AgentToolRisk {
  if (annotations.destructiveHint) return 'destructive'
  return annotations.readOnlyHint ? 'read' : 'write'
}

function getModuleAvailability(
  moduleName: string,
  runtime: CclinkStudioRuntimeState,
): { available: boolean; reason?: string } {
  const capabilityName = moduleName as AgentCapabilityStatus['name']
  if (capabilityName in CAPABILITY_LABELS) {
    const snapshot = runtime.capabilities.get(capabilityName)
    if (snapshot.state === 'failed') return { available: false, reason: snapshot.reason }
  }
  switch (moduleName) {
    case 'browser':
      return runtime.browserManager && runtime.playwrightBridge
        ? { available: true }
        : { available: false, reason: '浏览器自动化未连接' }
    case 'editor':
      return runtime.editorModule && runtime.fileService
        ? { available: true }
        : { available: false, reason: '编辑器或文件服务未就绪' }
    case 'data-source':
      return runtime.dataSourceService
        ? { available: true }
        : { available: false, reason: '数据源服务未就绪' }
    case 'hardware':
      return runtime.hardwareService
        ? { available: true }
        : { available: false, reason: '硬件服务未就绪' }
    case 'cad':
      return runtime.cadConversionService
        ? { available: true }
        : { available: false, reason: 'CAD 服务未就绪' }
    case 'meshy':
      return runtime.meshyService
        ? { available: true }
        : { available: false, reason: 'Meshy 服务未就绪' }
    case 'image-generation': {
      const providers = runtime.imageGenerationService?.getStatus() ?? []
      const configured = providers.find((item) => item.configured)
      return configured
        ? { available: true }
        : {
            available: false,
            reason:
              providers
                .map((provider) => provider.reason)
                .filter(Boolean)
                .join('；') || '图片生成服务未就绪',
          }
    }
    case 'android':
      return runtime.activeDeviceManager?.getSource() === 'physical'
        ? { available: true }
        : { available: false, reason: '未连接 Android 真机' }
    case 'agent-device':
      return runtime.agentDeviceManager?.isAvailable()
        ? { available: true }
        : { available: false, reason: '设备语义层不可用' }
    case 'web-affairs':
      return runtime.webAffairService
        ? { available: true }
        : { available: false, reason: '事务服务未就绪' }
    case 'scheduled-task': {
      const status = runtime.scheduledTaskService?.getRuntimeStatus()
      if (!status) return { available: false, reason: '定时任务服务未就绪' }
      if (status.state === 'degraded') {
        return {
          available: false,
          reason: status.lastError?.message ?? '定时任务 Runtime 已降级',
        }
      }
      return { available: true }
    }
    default:
      return { available: true }
  }
}
