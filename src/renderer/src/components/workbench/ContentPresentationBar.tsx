import { useTabStore } from '../../stores/tab-store'
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
        打开方式 <OpenAsSelect tab={tab} presentation={presentation} />
      </label>
      <span title={presentation.detail}>{presentation.detail}</span>
    </div>
  )
}

function openAs(tab: Tab, mode: string): void {
  void useCommandStore
    .getState()
    .executeCommand(`workbench.openAs.${mode}`, {
      source: 'toolbar',
      target: {
        kind: 'tab',
        tabId: tab.id,
        tabType: tab.type,
        workspaceKey: tab.workspaceRef ? workspaceRefKey(tab.workspaceRef) : null,
      },
    })
    .then((result) => {
      if (!result.ok) useToastStore.getState().show(result.message ?? '打开方式切换失败', 'error')
    })
}

function OpenAsSelect({
  tab,
  presentation,
}: {
  tab: Tab
  presentation: NonNullable<ReturnType<typeof contentPresentation>>
}): React.ReactElement {
  return (
    <select
      className="content-open-as"
      aria-label="打开方式"
      value={presentation.selected}
      disabled={presentation.options.length < 2}
      onChange={(event) => {
        openAs(tab, event.target.value)
      }}
    >
      {presentation.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
export function MarkdownOpenAs({ tabId }: { tabId: string }): React.ReactElement | null {
  const tab = useTabStore((state) => state.tabs.find((item) => item.id === tabId))
  const presentation = tab && contentPresentation(tab)
  if (!tab || !presentation || presentation.options.length < 2) return null
  const source = presentation.selected === 'source'
  return (
    <button
      type="button"
      className="markdown-mode-toggle"
      onClick={() => openAs(tab, source ? 'markdown' : 'source')}
    >
      {source ? '切到正文' : '切到源码'}
    </button>
  )
}
