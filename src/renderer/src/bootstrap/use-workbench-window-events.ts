import { useEffect } from 'react'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkbenchWindowStore } from '../stores/workbench-window-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { workspaceRefFromKey } from '../utils/conversation-workspace'

export function useWorkbenchWindowEvents(): void {
  useEffect(
    () =>
      window.cclinkStudio.workbenchWindow.onPlacementChanged((placement) => {
        useWorkbenchWindowStore.getState().applyPlacement(placement)
        if (placement.windowId !== 'main' || placement.state !== 'attached') return
        const tabStore = useTabStore.getState()
        if (tabStore.activeTabId) return
        const tab = tabStore.tabs.find((item) => item.id === placement.tabId)
        if (!tab) return
        const activeWorkspaceKey = workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef)
        const tabWorkspaceKey = workspaceRefKey(
          tab.workspaceRef ?? workspaceRefFromKey(placement.workspaceKey),
        )
        if (
          placement.workspaceKey === activeWorkspaceKey &&
          tabWorkspaceKey === activeWorkspaceKey
        ) {
          tabStore.activateTab(placement.tabId)
        }
      }),
    [],
  )
}
