export type AgentRoleIcon =
  | 'assistant'
  | 'challenger'
  | 'fact-checker'
  | 'product'
  | 'architect'
  | 'governance'
  | 'rights'

export interface AgentRoleRef {
  roleId: string
  version: number
}

export interface AgentSkillRef {
  skillId: string
  version: number
}

export interface AgentRoleExample {
  input: string
  focus: string
}

export interface AgentRoleSoulSummary {
  format: 'markdown'
  source: 'builtin' | 'local' | 'imported'
  markdown: string
  contentHash: string
}

export interface AgentRoleSummary extends AgentRoleRef {
  source: 'builtin' | 'local' | 'imported'
  archived: boolean
  isLatest: boolean
  createdAt: number
  label: string
  description: string
  icon: AgentRoleIcon
  goals: string[]
  suitableFor: string[]
  unsuitableFor: string[]
  instructions: string[]
  boundaries: string[]
  examples: AgentRoleExample[]
  contentHash: string
  recommendedSkillRefs: AgentSkillRef[]
  soul?: AgentRoleSoulSummary
  disclaimer?: string
}

export interface AgentRoleDraft {
  label: string
  description: string
  icon: AgentRoleIcon
  goals: string[]
  suitableFor: string[]
  unsuitableFor: string[]
  instructions: string[]
  boundaries: string[]
  examples: AgentRoleExample[]
  soulMarkdown?: string
  recommendedSkillRefs: AgentSkillRef[]
  disclaimer?: string
}

export interface AgentRoleMutationResult {
  success: boolean
  role?: AgentRoleSummary
  error?: string
}

export interface AgentRoleExportResult {
  success: boolean
  directoryPath?: string
  error?: string
}

export interface AgentRoleImportSkillStatus extends AgentSkillRef {
  available: boolean
  label?: string
}

export interface AgentRoleImportPreview {
  token: string
  sourceLabel: string
  role: AgentRoleSummary
  conflict: 'none' | 'same-content' | 'same-id'
  skillStatuses: AgentRoleImportSkillStatus[]
  warnings: string[]
}

export interface AgentRoleImportPreviewResult {
  success: boolean
  preview?: AgentRoleImportPreview
  error?: string
}

export type AgentRoleImportDecision = 'update' | 'copy'

export interface AgentConversationConfiguration {
  schemaVersion: 1
  roleRef: AgentRoleRef
  revision: number
  updatedAt: number
}

export interface AgentConversationConfigurationEvent {
  id: string
  type: 'configuration-changed'
  fromRoleRef: AgentRoleRef
  toRoleRef: AgentRoleRef
  configurationRevision: number
  timestamp: number
}

export interface AgentRunConfigurationReceipt {
  conversationId: string
  runId: string
  roleRef: AgentRoleRef
  configurationRevision: number
  configurationFingerprint: string | null
  runtimeSessionMode: 'new' | 'resumed'
  skills: AgentRunSkillReceipt[]
}

export interface AgentRunSkillReceipt {
  ref: AgentSkillRef
  contentHash: string
}

export const DEFAULT_AGENT_ROLE_REF: AgentRoleRef = {
  roleId: 'default-assistant',
  version: 1,
}

export function createDefaultAgentConversationConfiguration(
  updatedAt = Date.now(),
  roleRef: AgentRoleRef = DEFAULT_AGENT_ROLE_REF,
): AgentConversationConfiguration {
  return {
    schemaVersion: 1,
    roleRef: { ...roleRef },
    revision: 1,
    updatedAt,
  }
}

export function agentRoleRefsEqual(
  left: AgentRoleRef | null | undefined,
  right: AgentRoleRef | null | undefined,
): boolean {
  return left?.roleId === right?.roleId && left?.version === right?.version
}

export function agentSkillRefsEqual(
  left: AgentSkillRef | null | undefined,
  right: AgentSkillRef | null | undefined,
): boolean {
  return left?.skillId === right?.skillId && left?.version === right?.version
}
