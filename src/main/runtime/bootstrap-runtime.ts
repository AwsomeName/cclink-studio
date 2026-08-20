import type { CclinkStudioRuntimeState } from './app-runtime'
import { ServiceRegistry } from './service-registry'
import { createWindowRuntime, destroyWindowRuntime } from './window-runtime'
import {
  bootstrapStateServices,
  bootstrapMainProcessServices,
  shutdownMainProcessServices,
  shutdownStateServices,
} from './core-services'
import { bootstrapAutomationRuntime, shutdownAutomationRuntime } from './automation-runtime'
import { bootstrapAgentRuntime, shutdownAgentRuntime } from './agent-runtime'

export interface RuntimeWindowOptions {
  preloadPath: string
  auxiliaryPreloadPath?: string
  rendererUrl?: string
  rendererHtmlPath: string
}

export async function bootstrapRuntime(
  runtime: CclinkStudioRuntimeState,
  windowOptions: RuntimeWindowOptions,
): Promise<void> {
  runtime.serviceRegistry ??= createRuntimeServiceRegistry(runtime, windowOptions)
  await runtime.serviceRegistry.startAll()
}

export async function rebuildRuntime(runtime: CclinkStudioRuntimeState): Promise<void> {
  if (!runtime.serviceRegistry) throw new Error('运行时尚未初始化')
  await runtime.serviceRegistry.restartAll()
}

export function createRuntimeServiceRegistry(
  runtime: CclinkStudioRuntimeState,
  windowOptions: RuntimeWindowOptions,
): ServiceRegistry {
  const registry = new ServiceRegistry()
  registry.register({
    name: 'state-services',
    start: () => bootstrapStateServices(runtime),
    stop: () => shutdownStateServices(runtime),
  })
  registry.register({
    name: 'window-runtime',
    start: () => createWindowRuntime(runtime, windowOptions),
    stop: () => destroyWindowRuntime(runtime),
  })
  registry.register({
    name: 'main-process-services',
    start: () => bootstrapMainProcessServices(runtime),
    stop: () => shutdownMainProcessServices(runtime),
  })
  registry.register({
    name: 'automation-runtime',
    start: () => bootstrapAutomationRuntime(runtime),
    stop: () => shutdownAutomationRuntime(runtime),
  })
  registry.register({
    name: 'agent-runtime',
    start: () => bootstrapAgentRuntime(runtime),
    stop: () => shutdownAgentRuntime(runtime),
  })
  return registry
}
