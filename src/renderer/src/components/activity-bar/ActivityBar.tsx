import { useUIStore, useTabStore } from '../../stores'
import type { ActivityPanel } from '../../types'
import {
  IconFiles,
  IconDatabase,
  IconGlobe,
  IconProjects,
  IconRobot,
  IconSettings,
  IconSparkle,
  IconTerminal,
  IconTool,
} from '../common/Icons'

// 项目切换暂时统一收口到顶栏；保留 Activity/Sidebar 实现，后续可直接重新启用。
const PROJECT_ACTIVITY_ENABLED = false
// 会话列表和管理已统一收口到 Agent 面板；保留 Sidebar 实现，暂不显示旧入口。
const SESSION_ACTIVITY_ENABLED = false

const MAIN_ICONS: Array<{
  id: ActivityPanel
  Icon: React.ComponentType<{ size?: number }>
  label: string
}> = [
  ...(PROJECT_ACTIVITY_ENABLED
    ? [{ id: 'projects' as const, Icon: IconProjects, label: '项目' }]
    : []),
  ...(SESSION_ACTIVITY_ENABLED
    ? [{ id: 'sessions' as const, Icon: IconRobot, label: '会话' }]
    : []),
  { id: 'files', Icon: IconFiles, label: '文件' },
  { id: 'browser', Icon: IconGlobe, label: '浏览器' },
  { id: 'data-sources', Icon: IconDatabase, label: '数据源' },
  { id: 'terminal', Icon: IconTerminal, label: 'Terminal' },
  { id: 'operations', Icon: IconSparkle, label: '运营' },
  { id: 'production', Icon: IconTool, label: '生产' },
]

export function ActivityBar(): React.ReactElement {
  const activePanel = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const hideSidebar = useUIStore((s) => s.hideSidebar)
  const openTab = useTabStore((s) => s.openTab)

  const handleClick = (id: ActivityPanel): void => {
    setActivePanel(id)
  }

  const handleOpenSettings = (): void => {
    openTab({ type: 'settings', title: '设置', icon: '⚙️' })
    hideSidebar()
  }

  return (
    <div className="activity-bar">
      <div className="activity-bar-main">
        {MAIN_ICONS.map(({ id, Icon, label }) => (
          <div
            key={id}
            className={`activity-bar-icon ${activePanel === id ? 'active' : ''}`}
            onClick={() => handleClick(id)}
            title={label}
          >
            <Icon size={22} />
          </div>
        ))}
      </div>
      <div className="activity-bar-bottom">
        <div className="activity-bar-icon" onClick={handleOpenSettings} title="设置">
          <IconSettings size={22} />
        </div>
      </div>
    </div>
  )
}
