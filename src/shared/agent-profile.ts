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
