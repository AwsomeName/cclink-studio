import type { RefObject } from 'react'
import type { AgentMountedResourceKind } from '../../types'
import { FloatingSurface } from '../../components/common/FloatingSurface'
import {
  IconFile,
  IconFolder,
  IconGlobe,
  IconMobile,
  IconDatabase,
  IconSearch,
  IconSparkle,
  IconTerminal,
} from '../../components/common/Icons'
import type { AgentResourceCandidate, AgentSkillCandidate } from './view-model'

export function ResourceCandidateMenu({
  candidates,
  selectedIndex = 0,
  onActiveIndexChange,
  onPick,
  anchorRef,
  onRequestClose,
}: {
  candidates: AgentResourceCandidate[]
  selectedIndex?: number
  onActiveIndexChange?: (index: number) => void
  onPick: (candidate: AgentResourceCandidate) => void
  anchorRef: RefObject<HTMLElement | null>
  onRequestClose: () => void
}): React.ReactElement {
  return (
    <FloatingSurface
      anchorRef={anchorRef}
      open
      placement="top-start"
      gap={6}
      matchAnchorWidth
      className="agent-resource-menu"
      role="listbox"
      style={{ maxHeight: 'min(188px, calc(100vh - 16px))' }}
      onRequestClose={onRequestClose}
    >
      {candidates.length === 0 ? (
        <div className="agent-resource-menu-empty">
          <IconSearch size={13} />
          没有匹配资源
        </div>
      ) : (
        candidates.map((candidate, index) => (
          <button
            key={candidate.id}
            className={`agent-resource-menu-row${index === selectedIndex ? ' selected' : ''}`}
            role="option"
            aria-selected={index === selectedIndex}
            onMouseEnter={() => onActiveIndexChange?.(index)}
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(candidate)
            }}
            title={candidate.detail}
          >
            {resourceMenuIcon(candidate.kind)}
            <span>{candidate.label}</span>
            <em>{resourceSourceLabel(candidate)}</em>
          </button>
        ))
      )}
    </FloatingSurface>
  )
}

export function SkillCandidateMenu({
  candidates,
  selectedIndex = 0,
  onActiveIndexChange,
  onPick,
  anchorRef,
  onRequestClose,
}: {
  candidates: AgentSkillCandidate[]
  selectedIndex?: number
  onActiveIndexChange?: (index: number) => void
  onPick: (candidate: AgentSkillCandidate) => void
  anchorRef: RefObject<HTMLElement | null>
  onRequestClose: () => void
}): React.ReactElement {
  return (
    <FloatingSurface
      anchorRef={anchorRef}
      open
      placement="top-start"
      gap={6}
      matchAnchorWidth
      className="agent-resource-menu agent-skill-menu"
      role="listbox"
      style={{ maxHeight: 'min(188px, calc(100vh - 16px))' }}
      onRequestClose={onRequestClose}
    >
      {candidates.length === 0 ? (
        <div className="agent-resource-menu-empty">
          <IconSearch size={13} />
          没有匹配 Skill
        </div>
      ) : (
        candidates.map((candidate, index) => (
          <button
            key={candidate.id}
            className={`agent-resource-menu-row${index === selectedIndex ? ' selected' : ''}`}
            role="option"
            aria-selected={index === selectedIndex}
            onMouseEnter={() => onActiveIndexChange?.(index)}
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(candidate)
            }}
            title={candidate.description}
          >
            <IconSparkle size={13} />
            <span>/{candidate.label}</span>
            <em>{skillSourceLabel(candidate)}</em>
          </button>
        ))
      )}
    </FloatingSurface>
  )
}

function resourceMenuIcon(kind: AgentMountedResourceKind): React.ReactElement {
  switch (kind) {
    case 'browser':
      return <IconGlobe size={13} />
    case 'android':
      return <IconMobile size={13} />
    case 'terminal':
      return <IconTerminal size={13} />
    case 'data-source':
    case 'saved-query':
    case 'data-query':
    case 'data-record':
      return <IconDatabase size={13} />
    case 'file':
    case 'tab':
    case 'artifact':
      return <IconFile size={13} />
    case 'folder':
    case 'project':
      return <IconFolder size={13} />
    default:
      return <IconFile size={13} />
  }
}

function skillSourceLabel(candidate: AgentSkillCandidate): string {
  switch (candidate.source) {
    case 'builtin':
      return '内置'
    case 'workspace':
      return '项目'
    case 'user':
    default:
      return '用户 Skill'
  }
}

function resourceSourceLabel(candidate: AgentResourceCandidate): string {
  switch (candidate.source) {
    case 'workspace':
      return '当前项目'
    case 'selected-file':
      return '当前文件'
    case 'open-tab':
      return candidate.kind === 'browser' ? '浏览器 Tab' : '打开 Tab'
    case 'draft':
      return '草稿'
    case 'data-source':
      return candidate.kind === 'saved-query' ? 'Saved Query' : '数据源'
    default:
      return '资源'
  }
}
