import type { ReactElement } from 'react'
import type { AgentMountedResource, AgentMountedResourceKind } from '../../types'
import {
  IconClose,
  IconDatabase,
  IconFile,
  IconFolder,
  IconGlobe,
  IconMobile,
  IconRobot,
} from '../../components/common/Icons'

export function MountedResourceBar({
  resources,
  onRemove,
  onOpen,
}: {
  resources: AgentMountedResource[]
  onRemove: (resourceId: string) => void
  onOpen?: (resource: AgentMountedResource) => void
}): ReactElement {
  return (
    <div className="agent-resource-bar" title="当前会话已挂载资源">
      <div className="agent-resource-bar-label">资源</div>
      <div className="agent-resource-list">
        {resources.length === 0 ? (
          <span className="agent-resource-empty">输入 @ 挂载文件、Tab 或任务资源</span>
        ) : (
          resources.map((resource) => (
            <span
              key={resource.id}
              className={`agent-resource-chip${resource.kind === 'file-range' ? ' transient' : ''}`}
              title={resource.detail}
              onClick={() => onOpen?.(resource)}
            >
              {resourceIcon(resource.kind)}
              <span className="agent-resource-chip-main">@ {resource.label}</span>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  onRemove(resource.id)
                }}
                title="移除资源"
              >
                <IconClose size={10} />
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  )
}

function resourceIcon(kind: AgentMountedResourceKind): ReactElement {
  switch (kind) {
    case 'file':
    case 'file-range':
    case 'tab':
    case 'artifact':
      return <IconFile size={12} />
    case 'folder':
    case 'project':
      return <IconFolder size={12} />
    case 'browser':
      return <IconGlobe size={12} />
    case 'android':
      return <IconMobile size={12} />
    case 'terminal':
      return <IconRobot size={12} />
    case 'data-source':
    case 'saved-query':
    case 'data-query':
    case 'data-record':
      return <IconDatabase size={12} />
    default:
      return <IconFile size={12} />
  }
}
