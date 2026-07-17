import type { AgentMountedResource } from '../../types'
import { useTabStore } from '../../stores/tab-store'

export interface MarkdownRevealRange {
  filePath?: string
  tabId?: string
  startLine: number
  endLine: number
  startColumn?: number
  endColumn?: number
}

export const MARKDOWN_REVEAL_RANGE_EVENT = 'cclink:markdown-reveal-range'
export const AGENT_FOCUS_COMPOSER_EVENT = 'cclink:agent-focus-composer'

export function openFileRangeResource(resource: AgentMountedResource): void {
  if (resource.kind !== 'file-range') return
  const filePath = resource.ref.path
  const tabId = resource.ref.tabId
  const startLine = resource.ref.startLine
  const endLine = resource.ref.endLine
  if ((!filePath && !tabId) || typeof startLine !== 'number' || typeof endLine !== 'number') {
    return
  }

  if (filePath) {
    const existing = useTabStore.getState().tabs.find((tab) => tab.filePath === filePath)
    if (existing) {
      useTabStore.getState().activateTab(existing.id)
    } else {
      useTabStore.getState().openTab({
        type: 'editor',
        title: filePath.split('/').pop() || 'Markdown',
        icon: '📄',
        filePath,
      })
    }
  } else if (tabId && useTabStore.getState().tabs.some((tab) => tab.id === tabId)) {
    useTabStore.getState().activateTab(tabId)
  }

  requestAnimationFrame(() => {
    window.dispatchEvent(
      new CustomEvent<MarkdownRevealRange>(MARKDOWN_REVEAL_RANGE_EVENT, {
        detail: {
          filePath,
          tabId,
          startLine,
          endLine,
          startColumn: resource.ref.startColumn,
          endColumn: resource.ref.endColumn,
        },
      }),
    )
  })
}

export function focusAgentComposer(): void {
  window.dispatchEvent(new Event(AGENT_FOCUS_COMPOSER_EVENT))
}
