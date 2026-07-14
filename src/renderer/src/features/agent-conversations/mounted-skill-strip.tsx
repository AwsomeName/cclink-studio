import type { ReactElement } from 'react'
import type { AgentMountedSkill } from '../../types'
import { IconClose, IconSparkle } from '../../components/common/Icons'

export function MountedSkillStrip({
  skills,
  onRemove,
}: {
  skills: AgentMountedSkill[]
  onRemove: (skillId: string) => void
}): ReactElement | null {
  if (skills.length === 0) return null

  return (
    <div className="agent-skill-strip" title="当前会话已挂载 Skill">
      <span className="agent-skill-strip-label">技能</span>
      <div className="agent-skill-list">
        {skills.map((skill) => (
          <span key={skill.id} className="agent-skill-chip" title={skill.description}>
            <IconSparkle size={11} />
            <span>/{skill.label}</span>
            <button onClick={() => onRemove(skill.id)} title="移除 Skill">
              <IconClose size={10} />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
