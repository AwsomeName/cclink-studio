import { cleanupIpcHandlers } from '../ipc/ipc-cleanup'
import type { CclinkStudioRuntimeState } from './app-runtime'
import { ServiceRegistry } from './service-registry'

export async function shutdownRuntime(runtime: CclinkStudioRuntimeState): Promise<void> {
  runtime.mainWindow = null

  const registry = new ServiceRegistry()
  registry.register({ name: 'BrowserManager', stop: () => runtime.browserManager?.destroy() })
  registry.register({ name: 'PlaywrightBridge', stop: () => runtime.playwrightBridge?.disconnect() })
  registry.register({ name: 'McpToolHost', stop: () => runtime.toolHost?.stop() })
  registry.register({ name: 'ScrcpyBridge', stop: () => runtime.scrcpyBridge?.disconnect() })
  registry.register({ name: 'ActiveDeviceManager', stop: () => runtime.activeDeviceManager?.destroy() })
  registry.register({ name: 'AgentDeviceManager', stop: () => runtime.agentDeviceManager?.destroy() })
  registry.register({ name: 'PhysicalDeviceManager', stop: () => runtime.physicalDeviceManager?.disconnect() })
  registry.register({ name: 'EditorModule', stop: () => runtime.editorModule?.destroy() })
  registry.register({ name: 'PermissionManager', stop: () => runtime.permissionManager?.destroy() })
  registry.register({ name: 'TerminalConfirmationService', stop: () => runtime.terminalConfirmationService?.destroy() })
  registry.register({
    name: 'TerminalExecutionAdapter',
    stop: async () => {
      const sessions = runtime.terminalSessionRegistry?.list() ?? []
      await Promise.all(sessions.map((session) => runtime.terminalExecutionAdapter?.terminate(session.sessionId)))
    },
  })
  registry.register({ name: 'TerminalSessionRegistry', stop: () => runtime.terminalSessionRegistry?.clear() })
  registry.register({ name: 'AgentBridge', stop: () => runtime.agentBridge?.destroy() })
  registry.register({ name: 'IPC', stop: () => cleanupIpcHandlers() })

  await registry.stopAll()
}
