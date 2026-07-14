import { AgentBridge } from '../agent/agent-bridge'
import type { DeepInkRuntimeState } from './app-runtime'

export function bootstrapAgentRuntime(runtime: DeepInkRuntimeState): void {
  if (
    runtime.mainWindow &&
    runtime.playwrightBridge &&
    runtime.toolHost &&
    runtime.permissionManager &&
    runtime.mcpClientMgr &&
    runtime.adbBridge &&
    runtime.settingsService
  ) {
    const settings = runtime.settingsService.getAll()
    runtime.agentBridge = new AgentBridge(
      runtime.mainWindow,
      runtime.playwrightBridge,
      runtime.toolHost,
      runtime.permissionManager,
      runtime.mcpClientMgr,
      runtime.adbBridge,
      {
        backendType: settings.backendType,
        maxBudgetUsd: settings.maxBudgetUsd,
        apiFormat: settings.apiFormat,
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey,
        modelName: settings.modelName,
        getWorkspacePath: () => runtime.settingsService!.getAll().lastWorkspacePath,
        agentDeviceAvailable: () => runtime.agentDeviceManager?.isAvailable() ?? false,
        browserManager: runtime.browserManager ?? undefined,
        browserTaskRuntime: runtime.browserTaskRuntime ?? undefined,
      },
    )

    if (runtime.browserManager) {
      runtime.browserManager.onViewDestroyed((tabId) => runtime.agentBridge!.invalidateBrowserScope(tabId))
    }
    console.log(`[DeepInk] Agent 后端就绪 (${settings.provider} / ${settings.apiFormat})`)
    return
  }

  console.warn('[DeepInk] Agent 后端未就绪：Playwright/MCP runtime 初始化失败，Agent IPC 将保持降级状态')
}
