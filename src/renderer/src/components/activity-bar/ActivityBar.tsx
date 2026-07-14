import { useUIStore, useTabStore } from '../../stores'
import type { ActivityPanel } from '../../types'
import { IconFiles, IconGlobe, IconRobot, IconSettings, IconSparkle } from '../common/Icons'

const MAIN_ICONS: Array<{
  id: ActivityPanel
  Icon: React.ComponentType<{ size?: number }>
  label: string
}> = [
  { id: 'browser', Icon: IconGlobe, label: '浏览器' },
  { id: 'files', Icon: IconFiles, label: '文件' },
  { id: 'operations', Icon: IconSparkle, label: '运营' },
  { id: 'sessions', Icon: IconRobot, label: '会话' },
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
