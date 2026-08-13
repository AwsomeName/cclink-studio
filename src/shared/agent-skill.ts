export type AgentSkillSource = 'builtin' | 'user' | 'workspace'

export interface AgentSkillSummary {
  skillId: string
  version: number
  name: string
  label: string
  description: string
  source: AgentSkillSource
  available: boolean
  unavailableReason?: string
}
