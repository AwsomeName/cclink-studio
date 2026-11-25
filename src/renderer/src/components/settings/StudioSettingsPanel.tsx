import { useFloatingSurfaceRegistration } from '../common/floating-surface-registry'
import { useAppPageStore } from '../../stores/app-page-store'
import { SettingsPage } from './SettingsPage'
import './studio-settings-panel.css'

/** Studio 设置的独立页面：与 Owner 一样占据整个主区域，不属于任何项目。 */
export function StudioSettingsPanel(): React.ReactElement | null {
  const open = useAppPageStore((s) => s.page === 'settings')
  const section = useAppPageStore((s) => s.settingsSection)
  const request = useAppPageStore((s) => s.settingsRequest)
  const close = useAppPageStore((s) => s.showWorkbench)
  // 主区域被隐藏时，原生浏览器视图不能继续浮在页面上。
  useFloatingSurfaceRegistration(open)
  if (!open) return null
  return (
    <section id="studio-settings-page" className="studio-settings-panel" aria-label="Studio 设置">
      <header>
        <b>⚙　Studio 设置</b>
        <span>全局设置，对所有项目生效</span>
        <button type="button" onClick={close}>
          返回工作台
        </button>
      </header>
      <div className="studio-settings-panel-body">
        <SettingsPage initialSection={section} sectionRequest={request} />
      </div>
    </section>
  )
}
