import { useEffect, useState } from 'react'
import type { WorkbenchPlacementChanged } from '@shared/ipc/workbench-window'
import { workspaceRefKey } from '@shared/workspace-ref'
import { useTabStore } from '../stores/tab-store'
import { useWorkbenchWindowStore } from '../stores/workbench-window-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import type { Tab } from '../types'
import { workspaceRefFromKey } from '../utils/conversation-workspace'

export function resolveMainWindowActiveTabId(input: {
  tabs: Tab[]
  activeTabId: string | null
  placements: Record<string, WorkbenchPlacementChanged>
  activeWorkspaceKey: string | null
  preferredActiveTabId?: string
  preferProjectedActive?: boolean
}): string | null {
  const preferredActiveTabId =
    input.preferredActiveTabId ??
    (input.preferProjectedActive
      ? Object.values(input.placements)
          .filter(
            (placement) =>
              placement.windowId === 'main' && placement.state === 'attached' && placement.active,
          )
          .at(-1)?.tabId
      : undefined)

  if (preferredActiveTabId) {
    const preferredTab = input.tabs.find((tab) => tab.id === preferredActiveTabId)
    const preferredPlacement = input.placements[preferredActiveTabId]
    const preferredWorkspaceKey = preferredTab
      ? workspaceRefKey(
          preferredTab.workspaceRef ??
            workspaceRefFromKey(preferredPlacement?.workspaceKey ?? null),
        )
      : undefined
    if (
      preferredTab &&
      preferredPlacement?.windowId === 'main' &&
      preferredPlacement.state === 'attached' &&
      preferredWorkspaceKey === input.activeWorkspaceKey
    ) {
      return preferredTab.id
    }
  }

  if (!input.activeTabId) return null

  const activeTab = input.tabs.find((tab) => tab.id === input.activeTabId)
  if (!activeTab) return input.activeTabId

  const activePlacement = input.placements[input.activeTabId]
  if (!activePlacement || activePlacement.windowId === 'main') return input.activeTabId

  const fallback = input.tabs.find((tab) => {
    const placement = input.placements[tab.id]
    const workspaceKey = workspaceRefKey(tab.workspaceRef ?? workspaceRefFromKey(null))
    return (
      workspaceKey === input.activeWorkspaceKey && (!placement || placement.windowId === 'main')
    )
  })
  return fallback?.id ?? null
}

export function useWorkbenchWindowEvents(): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let preferProjectionAfterWorkspaceChange = false
    const reconcileSelection = (
      preferredActiveTabId?: string,
      preferProjectedActive = false,
    ): void => {
      const tabStore = useTabStore.getState()
      const placements = useWorkbenchWindowStore.getState().placements
      const activeWorkspaceKey = workspaceRefKey(useWorkspaceStore.getState().activeWorkspaceRef)
      const nextActiveTabId = resolveMainWindowActiveTabId({
        tabs: tabStore.tabs,
        activeTabId: tabStore.activeTabId,
        placements,
        activeWorkspaceKey,
        preferredActiveTabId,
        preferProjectedActive,
      })
      if (nextActiveTabId !== tabStore.activeTabId) tabStore.activateTab(nextActiveTabId)
    }

    const disposePlacement = window.cclinkStudio.workbenchWindow.onPlacementChanged((placement) => {
      useWorkbenchWindowStore.getState().applyPlacement(placement)
      // 返回主窗口的 transition 可以一次性建议激活；后续 TabStore 更新必须服从
      // TabModel/用户选择，不能持续重放 placement 中可能已经过期的 native active 投影。
      reconcileSelection(placement.active ? placement.tabId : undefined)
    })
    const disposeTabs = useTabStore.subscribe(() => {
      const preferProjectedActive = preferProjectionAfterWorkspaceChange
      preferProjectionAfterWorkspaceChange = false
      reconcileSelection(undefined, preferProjectedActive)
    })
    const disposeWorkspace = useWorkspaceStore.subscribe((state, previousState) => {
      if (
        workspaceRefKey(state.activeWorkspaceRef) !==
        workspaceRefKey(previousState.activeWorkspaceRef)
      ) {
        preferProjectionAfterWorkspaceChange = true
      }
    })

    void window.cclinkStudio.workbenchWindow
      .getProjection()
      .then((projection) => {
        if (cancelled) return
        useWorkbenchWindowStore.getState().hydratePlacements(projection.placements)
        reconcileSelection(undefined, true)
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
