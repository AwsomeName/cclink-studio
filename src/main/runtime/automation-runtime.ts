import { discoverCdpPort } from '../cdp/cdp-port-discovery'
import { PlaywrightBridge } from '../playwright/playwright-bridge'
import { McpToolHost } from '../mcp/tool-host'
import { BrowserToolModule } from '../mcp/modules/browser'
import { EditorToolModule } from '../mcp/modules/editor'
import { registerEditorIpc } from '../ipc/editor-ipc'
import { MeshyToolModule } from '../mcp/modules/meshy'
import { HardwareToolModule } from '../mcp/modules/hardware'
import { CadToolModule } from '../mcp/modules/cad'
import { AndroidToolModule } from '../mcp/modules/android'
import { AgentDeviceManager } from '../android/agent-device-manager'
import { AgentDeviceToolModule } from '../mcp/modules/agent-device'
import { DataSourceToolModule } from '../mcp/modules/data-source'
import type { CclinkStudioRuntimeState } from './app-runtime'

export async function bootstrapAutomationRuntime(runtime: CclinkStudioRuntimeState): Promise<void> {
  if (!runtime.mainWindow || !runtime.permissionManager) {
    throw new Error('自动化 runtime 依赖的窗口或权限系统尚未初始化')
  }

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

    runtime.toolHost = new McpToolHost(runtime.permissionManager)
    runtime.toolHost.registerModule(
      new BrowserToolModule(runtime.playwrightBridge, runtime.browserTaskRuntime),
    )

    runtime.editorModule = new EditorToolModule(runtime.mainWindow)
    runtime.toolHost.registerModule(runtime.editorModule)
    registerEditorIpc(runtime.editorModule)

    runtime.toolHost.registerModule(new MeshyToolModule(runtime.meshyService!))
    console.log('[CCLink Studio] Meshy MCP 工具模块已注册')

    runtime.toolHost.registerModule(new HardwareToolModule(runtime.hardwareService!))
    console.log('[CCLink Studio] 硬件 MCP 工具模块已注册')

    runtime.toolHost.registerModule(new CadToolModule(runtime.cadConversionService!))
    console.log('[CCLink Studio] CAD MCP 工具模块已注册')

    runtime.toolHost.registerModule(new DataSourceToolModule(runtime.dataSourceService!))
    console.log('[CCLink Studio] 数据源 MCP 工具模块已注册')

    runtime.toolHost.registerModule(
      new AndroidToolModule(runtime.adbBridge!, runtime.scrcpyBridge!),
    )
    console.log('[CCLink Studio] Android MCP 工具模块已注册')

    runtime.agentDeviceManager = new AgentDeviceManager(
      runtime.activeDeviceManager!,
      runtime.adbBridge!,
    )
    await runtime.agentDeviceManager.init()
    runtime.toolHost.registerModule(new AgentDeviceToolModule(runtime.agentDeviceManager))
    console.log(
      `[CCLink Studio] agent-device 工具模块已注册 (available=${runtime.agentDeviceManager.isAvailable()})`,
    )

    const mcpPort = await runtime.toolHost.start()
    console.log(`[CCLink Studio] MCP server 已启动 (端口: ${mcpPort})`)
  } catch (error) {
    console.error('[CCLink Studio] CDP/Playwright 初始化失败:', error)
  }
}
