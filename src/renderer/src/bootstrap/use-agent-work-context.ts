import { useEffect } from 'react'
import { useTabStore } from '../stores/tab-store'
import { useUIStore, type WorkContext } from '../stores/ui-store'
import type { Tab } from '../types'

function workContextFromTab(tab: Tab | undefined): WorkContext {
  if (!tab) return 'empty'
  if (
    tab.type === 'browser' ||
    tab.type === 'editor' ||
    tab.type === 'android' ||
    tab.type === 'preview' ||
    tab.type === 'settings'
  ) {
    return tab.type
  }
  if (tab.type === 'data-source-query' || tab.type === 'data-source-result') return 'data-source'
  return 'preview'
}

/** 工作区恢复完成后，根据当前 Tab 自动切换 Agent 面板位置。 */
export function useAgentWorkContext(workspaceReady: boolean): void {
  const applySystemWorkContext = useUIStore((s) => s.applySystemWorkContext)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  useEffect(() => {
    if (!workspaceReady) return
    applySystemWorkContext(workContextFromTab(activeTab))
  }, [activeTab, applySystemWorkContext, workspaceReady])
}
