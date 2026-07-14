import type { ReactElement } from 'react'
import type { AgentContextChip } from './view-model'
import { IconFile, IconGlobe, IconMobile, IconRobot } from '../../components/common/Icons'

export function AgentContextBar({ chips }: { chips: AgentContextChip[] }): ReactElement {
  return (
    <div className="agent-context-bar" title="当前会话会优先参考这些工作现场">
      <div className="agent-context-label">上下文</div>
      <div className="agent-context-chips">
        {chips.map((chip) => (
          <span
            key={chip.id}
            className={`agent-context-chip ${chip.muted ? 'muted' : ''}`}
            title={chip.detail ? `${chip.detail}: ${chip.label}` : chip.label}
          >
            {contextIcon(chip.kind)}
            <span className="agent-context-chip-main">{chip.label}</span>
            {chip.detail && <span className="agent-context-chip-detail">{chip.detail}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

function contextIcon(kind: AgentContextChip['kind']): ReactElement {
  switch (kind) {
    case 'workspace':
      return <IconFile size={12} />
    case 'scope':
      return <IconRobot size={12} />
    case 'tab':
      return <IconGlobe size={12} />
    case 'file':
      return <IconFile size={12} />
    case 'browser':
      return <IconGlobe size={12} />
    case 'android':
      return <IconMobile size={12} />
    case 'more':
      return <IconRobot size={12} />
  }
}
