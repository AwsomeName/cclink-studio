import type { Tab } from '../../types'
import { contentPresentation } from '../../utils/content-presentation'
import { useCommandStore } from '../../stores/command-store'
import { useToastStore } from '../common/Toast'
import { workspaceRefKey } from '@shared/workspace-ref'
import './content-presentation.css'

export function ContentPresentationBar({ tab }: { tab?: Tab }): React.ReactElement | null {
  const presentation = tab ? contentPresentation(tab) : null
  if (!tab || !presentation) return null
  return (
    <div className="content-presentation-bar" role="region" aria-label="当前内容版面">
      <strong>{presentation.label}</strong>
      <label>
        打开方式{' '}
        <select
          aria-label="打开方式"
          value={presentation.selected}
          disabled={presentation.options.length < 2}
          onChange={(event) => {
            void useCommandStore
              .getState()
              .executeCommand(`workbench.openAs.${event.target.value}`, {
                source: 'toolbar',
                target: {
                  kind: 'tab',
                  tabId: tab.id,
                  tabType: tab.type,
                  workspaceKey: tab.workspaceRef ? workspaceRefKey(tab.workspaceRef) : null,
                },
              })
              .then((result) => {
                if (!result.ok)
                  useToastStore.getState().show(result.message ?? '打开方式切换失败', 'error')
              })
          }}
        >
          {presentation.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <span title={presentation.detail}>{presentation.detail}</span>
    </div>
  )
}
