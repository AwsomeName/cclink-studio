import type { AgentRoleDraft } from '@shared/agent-role'

export interface AgentRoleDraftController {
  draft: AgentRoleDraft
  save: () => Promise<boolean>
  discard: () => void
}

const controllers = new Map<string, AgentRoleDraftController>()

export function registerAgentRoleDraftController(
  tabId: string,
  controller: AgentRoleDraftController,
): () => void {
  controllers.set(tabId, controller)
  return () => {
    if (controllers.get(tabId) === controller) controllers.delete(tabId)
  }
}

export function getAgentRoleDraftController(tabId: string): AgentRoleDraftController | undefined {
  return controllers.get(tabId)
}

export function clearAgentRoleDraftController(tabId: string): void {
  controllers.delete(tabId)
}
