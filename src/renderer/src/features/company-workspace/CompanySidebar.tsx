import { useCommandStore } from '../../stores/command-store'
import { useTabStore } from '../../stores/tab-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useToastStore } from '../../components/common/Toast'
import { companySections } from './company-workspace-commands'
import './company-workspace.css'
export function CompanySidebar(): React.ReactElement {
  const tab = useTabStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
  const ref = useWorkspaceStore((state) => state.activeWorkspaceRef)
  const execute = useCommandStore((state) => state.executeCommand)
  const show = useToastStore((state) => state.show)
  const current =
    tab?.type === 'company-accounts'
      ? 'finance'
      : tab?.type === 'article-publishing'
        ? 'operations'
        : tab?.companyWorkspace?.section
  return (
    <nav className="company-navigation" aria-label="公司经营导航">
      {companySections.map((section) => (
        <button
          key={section.id}
          type="button"
          aria-current={current === section.id ? 'page' : undefined}
          disabled={ref.kind !== 'local'}
          onClick={() => {
            void execute('company.' + section.id, { source: 'toolbar' }).then((result) => {
              if (!result.ok) show(result.message ?? '无法打开公司视图', 'error')
            })
          }}
        >
          {section.label}
        </button>
      ))}
      <p>业务项目关联工作、支出、内容与资料。</p>
      {ref.kind !== 'local' && <p>请先打开本地工作空间。</p>}
    </nav>
  )
}
