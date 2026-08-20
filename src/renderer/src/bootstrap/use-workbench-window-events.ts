import { useEffect, useState } from 'react'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkbenchWindowStore } from '../stores/workbench-window-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { workspaceRefFromKey } from '../utils/conversation-workspace'

export function useWorkbenchWindowEvents(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const reconcileSelection = (): void => {
      const tabStore = useTabStore.getState()
      const placements = useWorkbenchWindowStore.getState().placements
      const activeWorkspaceKey = workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef)
      const belongsToActiveWorkspace = (
        tabId: string,
        placementWorkspaceKey: string | null,
      ): boolean => {
        const tab = tabStore.tabs.find((item) => item.id === tabId)
        if (!tab) return false
        const tabWorkspaceKey = workspaceRefKey(
          tab.workspaceRef ?? workspaceRefFromKey(placementWorkspaceKey),
        )
        return (
          placementWorkspaceKey === activeWorkspaceKey && tabWorkspaceKey === activeWorkspaceKey
        )
      }

      const authoritativeActive = Object.values(placements).find(
        (placement) =>
          placement.windowId === 'main' &&
          placement.state === 'attached' &&
          placement.active &&
          belongsToActiveWorkspace(placement.tabId, placement.workspaceKey),
      )
      if (authoritativeActive && tabStore.activeTabId !== authoritativeActive.tabId) {
        tabStore.activateTab(authoritativeActive.tabId)
        return
      }

      const activePlacement = tabStore.activeTabId ? placements[tabStore.activeTabId] : undefined
      if (!activePlacement || activePlacement.windowId === 'main') return
      const fallback = tabStore.tabs.find((tab) => {
        const placement = placements[tab.id]
        const workspaceKey = workspaceRefKey(tab.workspaceRef ?? workspaceRefFromKey(null))
        return workspaceKey === activeWorkspaceKey && (!placement || placement.windowId === 'main')
      })
      tabStore.activateTab(fallback?.id ?? null)
    }

    const disposePlacement = window.cclinkStudio.workbenchWindow.onPlacementChanged((placement) => {
      useWorkbenchWindowStore.getState().applyPlacement(placement)
      reconcileSelection()
    })
    const disposeTabs = useTabStore.subscribe(reconcileSelection)
    const disposeWorkspace = useWorkspaceStore.subscribe(reconcileSelection)

    void window.cclinkStudio.workbenchWindow
      .getProjection()
      .then((projection) => {
        if (cancelled) return
        useWorkbenchWindowStore.getState().hydratePlacements(projection.placements)
        reconcileSelection()
      })
      .catch((error) => console.error('[WorkbenchWindow] placement 投影加载失败:', error))
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
      disposePlacement()
      disposeTabs()
      disposeWorkspace()
    }
  }, [])

  return ready
}
