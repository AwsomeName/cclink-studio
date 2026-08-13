import type { ReactElement } from 'react'
import type { AgentMountedSkill } from '../../types'
import type { AgentSkillSummary } from '@shared/agent-skill'
import { IconClose, IconSparkle } from '../../components/common/Icons'

export function MountedSkillStrip({
  skills,
  availableSkills,
  onRemove,
}: {
  skills: AgentMountedSkill[]
  availableSkills: AgentSkillSummary[]
  onRemove: (skill: AgentMountedSkill) => void
}): ReactElement | null {
  if (skills.length === 0) return null

  return (
    <div className="agent-skill-strip" title="当前会话已挂载 Skill">
      <span className="agent-skill-strip-label">技能</span>
      <div className="agent-skill-list">
        {skills.map((skillRef) => {
          const skill = availableSkills.find(
            (candidate) =>
              candidate.skillId === skillRef.skillId && candidate.version === skillRef.version,
          )
          return (
            <span
              key={`${skillRef.skillId}@${skillRef.version}`}
              className={`agent-skill-chip${skill ? '' : ' unavailable'}`}
              title={skill?.description ?? `Skill 不可用: ${skillRef.skillId}@${skillRef.version}`}
            >
              <IconSparkle size={11} />
              <span>/{skill?.label ?? skillRef.skillId}</span>
              <button onClick={() => onRemove(skillRef)} title="移除 Skill">
                <IconClose size={10} />
              </button>
            </span>
          )
        })}
      </div>
    </div>
  )
}
