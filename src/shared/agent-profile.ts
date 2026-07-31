export type AgentProfileIcon =
  | 'assistant'
  | 'challenger'
  | 'fact-checker'
  | 'product'
  | 'architect'
  | 'governance'
  | 'rights'

export interface AgentProfileRef {
  profileId: string
  version: number
}

export interface AgentProfileSummary extends AgentProfileRef {
  label: string
  description: string
  icon: AgentProfileIcon
  disclaimer?: string
}

export const DEFAULT_AGENT_PROFILE_REF: AgentProfileRef = {
  profileId: 'default-assistant',
  version: 1,
}

export function agentProfileRefsEqual(
  left: AgentProfileRef | null | undefined,
  right: AgentProfileRef | null | undefined,
): boolean {
  return left?.profileId === right?.profileId && left?.version === right?.version
}

/** @deprecated 只用于读取 v0.1.14 及更早的持久化快照和 IPC。 */
export function legacyAgentProfileRefToRoleRef(
  ref: AgentProfileRef,
): import('./agent-role').AgentRoleRef {
  return { roleId: ref.profileId, version: ref.version }
}
