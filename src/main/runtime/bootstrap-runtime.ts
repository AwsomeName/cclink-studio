import type { CclinkStudioRuntimeState } from './app-runtime'
import { ServiceRegistry } from './service-registry'
import { createWindowRuntime } from './window-runtime'
import { bootstrapStateServices, bootstrapMainProcessServices } from './core-services'
import { bootstrapAutomationRuntime } from './automation-runtime'
import { bootstrapAgentRuntime } from './agent-runtime'

export interface RuntimeWindowOptions {
  preloadPath: string
  rendererUrl?: string
  rendererHtmlPath: string
}

export async function bootstrapRuntime(runtime: CclinkStudioRuntimeState, windowOptions: RuntimeWindowOptions): Promise<void> {
  const registry = new ServiceRegistry()
  registry.register({ name: 'state-services', start: () => bootstrapStateServices(runtime) })
  registry.register({ name: 'window-runtime', start: () => createWindowRuntime(runtime, windowOptions) })
  registry.register({ name: 'main-process-services', start: () => bootstrapMainProcessServices(runtime) })
  registry.register({ name: 'automation-runtime', start: () => bootstrapAutomationRuntime(runtime) })
  registry.register({ name: 'agent-runtime', start: () => bootstrapAgentRuntime(runtime) })

  await registry.startAll()
}
