import { useEffect, useMemo, useRef } from 'react'
import { useBrowserStore } from '../../stores/browser-store'
import { useTabStore } from '../../stores/tab-store'
import type { Tab } from '../../types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { workspaceRefKey } from '@shared/workspace-ref'

/** 管理内嵌浏览器 WebContentsView 的创建、激活、隐藏和销毁。 */
export function useBrowserViewLifecycle(
  activeTab: Tab | undefined,
  tabs: Tab[],
  workspaceRef: WorkspaceRef,
  enabled = true,
): void {
  const ensureBrowserTab = useBrowserStore((s) => s.ensureTab)
  const setBrowserTabReady = useBrowserStore((s) => s.setReady)
  const activeTabId = activeTab?.id
  const activeWorkspaceKey = workspaceRefKey(workspaceRef)
  const isBrowserTab =
    activeTab?.type === 'browser' &&
    Boolean(activeTab.workspaceRef) &&
    workspaceRefKey(activeTab.workspaceRef!) === activeWorkspaceKey
  const browserTabKey = useMemo(
    () =>
      tabs
        .filter(
          (tab) =>
            tab.type === 'browser' &&
            Boolean(tab.workspaceRef) &&
            workspaceRefKey(tab.workspaceRef!) === activeWorkspaceKey,
        )
        .map((tab) => tab.id)
        .join('\u0000'),
    [activeWorkspaceKey, tabs],
  )
  const browserTabIds = useMemo(
    () => (browserTabKey ? browserTabKey.split('\u0000') : []),
    [browserTabKey],
  )
  const prevBrowserIdsRef = useRef<string[]>(browserTabKey ? browserTabKey.split('\u0000') : [])

  useEffect(() => {
    let cancelled = false

    const manage = async (): Promise<void> => {
      if (!enabled) return
      await window.cclinkStudio.browser.reconcileViews({
        workspaceKey: activeWorkspaceKey,
        validTabIds: browserTabIds,
        activeTabId: null,
      })
      if (cancelled) return

      if (isBrowserTab && activeTabId) {
        const currentTab = useTabStore.getState().tabs.find((tab) => tab.id === activeTabId)
        const initialUrl = currentTab?.initialUrl
        const state = ensureBrowserTab(activeTabId, initialUrl)
        const restore = currentTab?.restore ?? {
          viewMode: state.viewMode,
          zoomMode: state.zoomMode,
          manualZoom: state.zoomFactor,
          history: state.history,
          historyIndex: state.historyIndex,
        }

        if (!state.ready) {
          await window.cclinkStudio.browser.createView(activeTabId, state.url, {
            ...(restore ? { restore } : {}),
            profileId: currentTab?.browserProfile ?? null,
            workspaceKey: activeWorkspaceKey,
          })
          if (cancelled) return
          setBrowserTabReady(activeTabId)
        }
        await window.cclinkStudio.browser.reconcileViews({
          workspaceKey: activeWorkspaceKey,
          validTabIds: browserTabIds,
          activeTabId,
        })
        return
      }

      await window.cclinkStudio.browser.reconcileViews({
        workspaceKey: activeWorkspaceKey,
        validTabIds: browserTabIds,
        activeTabId: null,
      })
    }

    void manage()
    return () => {
      cancelled = true
    }
  }, [
    activeTabId,
    activeWorkspaceKey,
    browserTabIds,
    enabled,
    ensureBrowserTab,
    isBrowserTab,
    setBrowserTabReady,
  ])

  useEffect(() => {
    const next = browserTabKey ? browserTabKey.split('\u0000') : []
    const prev = prevBrowserIdsRef.current
    const removed = prev.filter((id) => !next.includes(id))
    for (const id of removed) {
      useBrowserStore.getState().removeTab(id)
    }
    prevBrowserIdsRef.current = next
  }, [browserTabKey])
}
