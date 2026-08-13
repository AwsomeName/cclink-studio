import type { AgentSkillRef } from '../../shared/agent-role'
import type { AgentSkillSummary } from '../../shared/agent-skill'

const BUILTIN_AGENT_SKILLS: readonly AgentSkillSummary[] = [
  {
    skillId: 'grill-me',
    version: 1,
    name: 'grill-me',
    label: '方案拷问',
    description: '用 /grilling 风格检查假设、完成度、边界条件、失败路径和下一步。',
    source: 'builtin',
    available: true,
  },
]

export function listBuiltinAgentSkills(): AgentSkillSummary[] {
  return BUILTIN_AGENT_SKILLS.map((skill) => ({ ...skill }))
}

export class BuiltinAgentSkillRegistry {
  private readonly skills = new Map(
    BUILTIN_AGENT_SKILLS.map((skill) => [`${skill.skillId}@${skill.version}`, skill]),
  )

  list(): AgentSkillSummary[] {
    return listBuiltinAgentSkills()
  }

  resolve(ref: AgentSkillRef): AgentSkillSummary | null {
    return this.skills.get(`${ref.skillId}@${ref.version}`) ?? null
  }
}
