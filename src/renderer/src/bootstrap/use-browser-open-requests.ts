import { useEffect } from 'react'
import type { BrowserOpenTabRequest } from '@shared/ipc/browser'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkspaceStore } from '../stores/workspace-store'

export function openRequestedBrowserTab(request: BrowserOpenTabRequest): void {
  const tabState = useTabStore.getState()
  const activeWorkspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
  const activeWorkspaceKey = workspaceRefKey(activeWorkspaceRef)
  if (request.workspaceKey !== activeWorkspaceKey) return

  const activeTab = tabState.tabs.find((tab) => tab.id === tabState.activeTabId)
  if (
    activeTab?.type === 'browser' &&
    activeTab.workspaceRef &&
    workspaceRefKey(activeTab.workspaceRef) === activeWorkspaceKey
  ) {
    return
  }

  const existingBrowserTab = tabState.tabs.find(
    (tab) =>
      tab.type === 'browser' &&
      tab.workspaceRef &&
      workspaceRefKey(tab.workspaceRef) === activeWorkspaceKey,
  )
  if (existingBrowserTab) {
    tabState.activateTab(existingBrowserTab.id)
    return
  }

  tabState.openTab({
    type: 'browser',
    title: '浏览器',
    icon: '🌐',
    initialUrl: request.initialUrl,
    workspaceRef: activeWorkspaceRef,
    forceNew: true,
  })
}

export function useBrowserOpenRequests(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    return window.cclinkStudio.browser.onRequestOpenTab(openRequestedBrowserTab)
  }, [enabled])
}
