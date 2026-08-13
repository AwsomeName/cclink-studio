import { createHash } from 'node:crypto'
import type { AgentSkillRef } from '../../shared/agent-role'
import type { AgentSkillSummary } from '../../shared/agent-skill'
import grillMeSkillSource from './skills/grill-me/SKILL.md?raw'

const MAX_BUILTIN_SKILL_LENGTH = 32 * 1024

function normalizeBuiltinSkill(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n').trim()
  if (!normalized) throw new Error('内置 Skill 内容不能为空')
  if (normalized.length > MAX_BUILTIN_SKILL_LENGTH) {
    throw new Error(`内置 Skill 内容不能超过 ${MAX_BUILTIN_SKILL_LENGTH} 个字符`)
  }
  return normalized
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export interface BuiltinAgentSkill extends AgentSkillSummary {
  markdown: string
}

const grillMeMarkdown = normalizeBuiltinSkill(grillMeSkillSource)

const BUILTIN_AGENT_SKILLS: readonly BuiltinAgentSkill[] = [
  {
    skillId: 'grill-me',
    version: 1,
    name: 'grill-me',
    label: '方案拷问',
    description: '用 /grilling 风格检查假设、完成度、边界条件、失败路径和下一步。',
    source: 'builtin',
    available: true,
    contentHash: hashContent(grillMeMarkdown),
    markdown: grillMeMarkdown,
  },
]

export function listBuiltinAgentSkills(): AgentSkillSummary[] {
  return BUILTIN_AGENT_SKILLS.map(({ markdown: _markdown, ...skill }) => ({ ...skill }))
}

export class BuiltinAgentSkillRegistry {
  private readonly skills = new Map(
    BUILTIN_AGENT_SKILLS.map((skill) => [`${skill.skillId}@${skill.version}`, skill]),
  )

  list(): AgentSkillSummary[] {
    return listBuiltinAgentSkills()
  }

  resolve(ref: AgentSkillRef): BuiltinAgentSkill | null {
    return this.skills.get(`${ref.skillId}@${ref.version}`) ?? null
  }

  resolveRequired(ref: AgentSkillRef): BuiltinAgentSkill {
    const skill = this.resolve(ref)
    if (!skill || !skill.available) {
      throw new Error(`Agent Skill 不可用: ${ref.skillId}@${ref.version}`)
    }
    return skill
  }

  resolveMany(refs: AgentSkillRef[]): BuiltinAgentSkill[] {
    const seen = new Set<string>()
    return refs
      .map((ref) => this.resolveRequired(ref))
      .filter((skill) => {
        const key = `${skill.skillId}@${skill.version}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }
}
