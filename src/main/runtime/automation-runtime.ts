import { discoverCdpPort } from '../cdp/cdp-port-discovery'
import { PlaywrightBridge } from '../playwright/playwright-bridge'
import { McpToolHost } from '../mcp/tool-host'
import { BrowserToolModule } from '../mcp/modules/browser'
import { EditorToolModule } from '../mcp/modules/editor'
import { registerEditorIpc } from '../ipc/editor-ipc'
import { MeshyToolModule } from '../mcp/modules/meshy'
import { ImageGenerationToolModule } from '../mcp/modules/image-generation'
import { HardwareToolModule } from '../mcp/modules/hardware'
import { CadToolModule } from '../mcp/modules/cad'
import { AndroidToolModule } from '../mcp/modules/android'
import { AgentDeviceManager } from '../android/agent-device-manager'
import { AgentDeviceToolModule } from '../mcp/modules/agent-device'
import { DataSourceToolModule } from '../mcp/modules/data-source'
import { WebAffairToolModule } from '../mcp/modules/web-affairs'
import { WebResourceToolModule } from '../mcp/modules/web-resources'
import { ScheduledTaskToolModule } from '../mcp/modules/scheduled-task'
import type { ToolModule } from '../mcp/types'
import type { AgentCapabilityName } from '../../shared/agent-protocol'
import type { CclinkStudioRuntimeState } from './app-runtime'
import { runShutdownStep } from './shutdown'

export async function bootstrapAutomationRuntime(runtime: CclinkStudioRuntimeState): Promise<void> {
  if (
    !runtime.mainWindow ||
    !runtime.permissionManager ||
    !runtime.fileService ||
    !runtime.trustedRendererGuard
  ) {
    throw new Error('自动化 runtime 依赖的窗口、可信 renderer 或权限系统尚未初始化')
  }

  try {
    runtime.editorModule = new EditorToolModule(runtime.mainWindow, runtime.fileService)
    registerEditorIpc(runtime.editorModule, runtime.trustedRendererGuard)
    runtime.capabilities.ready('editor')
  } catch (error) {
    runtime.editorModule = null
    runtime.capabilities.failed('editor', error)
    console.error('[CCLink Studio] Editor 工具初始化失败:', error)
  }

  try {
    runtime.toolHost = new McpToolHost(runtime.permissionManager)
  } catch (error) {
    runtime.toolHost = null
    runtime.capabilities.failed('mcp', error)
    console.error('[CCLink Studio] MCP 工具主机创建失败:', error)
  }

  const browserWindowFailed =
    runtime.capabilities.get('browser').state === 'failed' && !runtime.browserManager
  if (browserWindowFailed) {
    console.warn('[CCLink Studio] Browser 窗口能力已失败，跳过 CDP/Playwright 初始化')
  } else {
    try {
      const cdpPort = await discoverCdpPort()
      console.log(`[CCLink Studio] CDP 端口: ${cdpPort}`)

      runtime.playwrightBridge = new PlaywrightBridge(
        runtime.browserDownloadStore,
        runtime.browserTaskRuntime,
      )
      await runtime.playwrightBridge.connect(cdpPort)
      console.log('[CCLink Studio] Playwright 已连接')

      if (runtime.browserManager) {
        runtime.browserManager.attachPlaywright(runtime.playwrightBridge)
      }
      runtime.capabilities.ready('browser')
    } catch (error) {
      await runtime.playwrightBridge?.disconnect().catch(() => undefined)
      runtime.playwrightBridge = null
      runtime.capabilities.failed('browser', error)
      console.error('[CCLink Studio] CDP/Playwright 初始化失败:', error)
    }
  }

  if (!runtime.toolHost) return

  if (runtime.playwrightBridge) {
    registerToolModule(
      runtime,
      'browser',
      () =>
        new BrowserToolModule(
          runtime.playwrightBridge!,
          runtime.browserTaskRuntime,
          runtime.browserManager,
        ),
    )
  }

  if (runtime.editorModule) {
    try {
      runtime.toolHost.registerModule(runtime.editorModule)
    } catch (error) {
      runtime.capabilities.degraded('editor', '编辑器可用，但 Agent 工具注册失败')
      console.error('[CCLink Studio] editor MCP 工具模块注册失败:', error)
    }
  }

  if (runtime.webAffairService) {
    try {
      runtime.toolHost.registerModule(
        new WebAffairToolModule(
          runtime.webAffairService,
          async (workspacePath) =>
            runtime.workspaceStateService?.getLocalProjectId(workspacePath) ?? null,
        ),
      )
    } catch (error) {
      console.error('[CCLink Studio] web-affairs MCP 工具模块注册失败:', error)
    }
  }

  if (runtime.webResourceService) {
    try {
      runtime.toolHost.registerModule(new WebResourceToolModule(runtime.webResourceService))
      console.log('[CCLink Studio] web-resources MCP 只读工具模块已注册')
    } catch (error) {
      console.error('[CCLink Studio] web-resources MCP 工具模块注册失败:', error)
    }
  }

  registerToolModule(
    runtime,
    'scheduled-task',
    () => new ScheduledTaskToolModule(requireService(runtime.scheduledTaskService)),
  )

  registerToolModule(
    runtime,
    'meshy',
    () => new MeshyToolModule(requireService(runtime.meshyService)),
  )
  registerToolModule(
    runtime,
    'image-generation',
    () => new ImageGenerationToolModule(requireService(runtime.markdownIllustrationService)),
  )
  registerToolModule(
    runtime,
    'hardware',
    () => new HardwareToolModule(requireService(runtime.hardwareService)),
  )
  registerToolModule(
    runtime,
    'cad',
    () => new CadToolModule(requireService(runtime.cadConversionService)),
  )
  registerToolModule(
    runtime,
    'data-source',
    () => new DataSourceToolModule(requireService(runtime.dataSourceService)),
  )
  registerToolModule(
    runtime,
    'android',
    () =>
      new AndroidToolModule(
        requireService(runtime.adbBridge),
        requireService(runtime.scrcpyBridge),
      ),
  )

  try {
    runtime.agentDeviceManager = new AgentDeviceManager(
      requireService(runtime.activeDeviceManager),
      requireService(runtime.adbBridge),
    )
    await runtime.agentDeviceManager.init()
    runtime.toolHost.registerModule(new AgentDeviceToolModule(runtime.agentDeviceManager))
    if (runtime.agentDeviceManager.isAvailable()) runtime.capabilities.ready('agent-device')
    else runtime.capabilities.unavailable('agent-device', '设备语义层当前不可用')
    console.log(
      `[CCLink Studio] agent-device 工具模块已注册 (available=${runtime.agentDeviceManager.isAvailable()})`,
    )
  } catch (error) {
    try {
      runtime.agentDeviceManager?.destroy()
    } catch {
      // 初始化失败后的释放仅做 best effort。
    }
    runtime.agentDeviceManager = null
    runtime.capabilities.failed('agent-device', error)
    console.error('[CCLink Studio] agent-device 工具模块初始化失败:', error)
  }

  try {
    for (const moduleId of runtime.settingsService?.getAll().disabledAgentToolModules ?? []) {
      runtime.toolHost.setModuleEnabled(moduleId, false)
    }

    const mcpPort = await runtime.toolHost.start()
    runtime.capabilities.ready('mcp')
    console.log(`[CCLink Studio] MCP server 已启动 (端口: ${mcpPort})`)
  } catch (error) {
    runtime.capabilities.failed('mcp', error)
    console.error('[CCLink Studio] MCP server 启动失败:', error)
  }
}

export async function shutdownAutomationRuntime(runtime: CclinkStudioRuntimeState): Promise<void> {
  await runShutdownStep('EditorModule', () => runtime.editorModule?.destroy())
  await runShutdownStep('AgentDeviceManager', () => runtime.agentDeviceManager?.destroy())
  await runShutdownStep('McpToolHost', () => runtime.toolHost?.stop())
  await runShutdownStep('PlaywrightBridge', () => runtime.playwrightBridge?.disconnect())

  runtime.editorModule = null
  runtime.agentDeviceManager = null
  runtime.toolHost = null
  runtime.playwrightBridge = null
}

function registerToolModule(
  runtime: CclinkStudioRuntimeState,
  capability: AgentCapabilityName,
  createModule: () => ToolModule,
): boolean {
  if (!runtime.toolHost) return false
  if (runtime.capabilities.get(capability).state === 'failed') {
    console.warn(`[CCLink Studio] ${capability} 主服务已失败，跳过 MCP 工具模块注册`)
    return false
  }
  try {
    runtime.toolHost.registerModule(createModule())
    runtime.capabilities.ready(capability)
    console.log(`[CCLink Studio] ${capability} MCP 工具模块已注册`)
    return true
  } catch (error) {
    runtime.capabilities.failed(capability, error)
    console.error(`[CCLink Studio] ${capability} MCP 工具模块注册失败:`, error)
    return false
  }
}

function requireService<T>(service: T | null): T {
  if (!service) throw new Error('依赖服务未初始化')
  return service
}
