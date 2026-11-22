import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { companySections, openCompanyWorkspace } from './company-workspace-commands'
import './company-workspace.css'
import { useFixedSpacesStore } from '../workspace-open/fixed-spaces-store'
import { beginWorkspaceRuntimeTransition } from '../../utils/workspace-transition'
export function CompanySidebar(): React.ReactElement {
  const tab = useTabStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
  const ref = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const boundCompany = useFixedSpacesStore((state) => state.spaces?.company)
  const section = tab?.companyWorkspace?.section
  const current =
    tab?.type === 'company-accounts'
      ? 'finance'
      : tab?.type === 'article-publishing' || section === 'operations'
        ? 'promote'
        : section
  return (
    <nav className="company-navigation" aria-label="公司经营导航">
      {companySections.map((section) => (
        <button
          key={section.id}
          type="button"
          aria-current={current === section.id ? 'page' : undefined}
          disabled={ref.kind !== 'local'}
          onClick={() => openCompanyWorkspace(section.id)}
        >
          {section.label}
        </button>
      ))}
      {ref.kind === 'local' && ref.path === boundCompany?.workspacePath && (
        <button
          className="company-binding-settings"
          onClick={() =>
            useFixedSpacesStore.setState({
              setup: { section: 'overview', generation: beginWorkspaceRuntimeTransition() },
            })
          }
        >
          关联设置
        </button>
      )}
      {ref.kind !== 'local' && <p>请先打开本地工作空间。</p>}
    </nav>
  )
}
