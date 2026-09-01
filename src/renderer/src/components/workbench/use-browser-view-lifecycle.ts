import { useEffect, useMemo, useRef } from 'react'
import { useBrowserStore } from '../../stores/browser-store'
import { useTabStore } from '../../stores/tab-store'
import type { Tab } from '../../types'
import type { WorkspaceRef } from '@shared/workspace-ref'
import { workspaceRefKey } from '@shared/workspace-ref'
import type { BrowserViewBinding } from '@shared/ipc/browser'
import { useBrowserFindStore } from '../../features/browser/browser-find-store'
import { isBrowserNewTabUrl } from '../../features/browser/browser-new-tab'

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
  const activeBrowserUrl = useBrowserStore((state) =>
    activeTabId ? state.tabs[activeTabId]?.url : undefined,
  )
  const activeWorkspaceKey = workspaceRefKey(workspaceRef)
  const isBrowserTab =
    activeTab?.type === 'browser' &&
    Boolean(activeTab.workspaceRef) &&
    workspaceRefKey(activeTab.workspaceRef!) === activeWorkspaceKey
  const showNativeBrowserView =
    isBrowserTab && !isBrowserNewTabUrl(activeBrowserUrl ?? activeTab?.initialUrl)
  const browserViewBindingKey = useMemo(
    () =>
      JSON.stringify(
        tabs
          .filter(
            (tab) =>
              tab.type === 'browser' &&
              Boolean(tab.workspaceRef) &&
              workspaceRefKey(tab.workspaceRef!) === activeWorkspaceKey,
          )
          .map((tab) => ({
            tabId: tab.id,
            profileId: tab.browserProfile ?? null,
            accountId: tab.webResourceRef?.accountId ?? null,
          })),
      ),
    [activeWorkspaceKey, tabs],
  )
  const browserViews = useMemo(
    () => JSON.parse(browserViewBindingKey) as BrowserViewBinding[],
    [browserViewBindingKey],
  )
  const browserTabIds = useMemo(() => browserViews.map(({ tabId }) => tabId), [browserViews])
  const prevBrowserIdsRef = useRef<string[]>(browserTabIds)

  useEffect(() => {
    let cancelled = false

    const manage = async (): Promise<void> => {
      if (!enabled) return
      await window.cclinkStudio.browser.reconcileViews({
        workspaceKey: activeWorkspaceKey,
        views: browserViews,
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

        await window.cclinkStudio.browser.createView(activeTabId, state.url, {
          ...(restore ? { restore } : {}),
          profileId: currentTab?.browserProfile ?? null,
          workspaceKey: activeWorkspaceKey,
        })
        if (cancelled) return
        setBrowserTabReady(activeTabId)
        await window.cclinkStudio.browser.reconcileViews({
          workspaceKey: activeWorkspaceKey,
          views: browserViews,
          activeTabId: showNativeBrowserView ? activeTabId : null,
        })
        return
      }

      await window.cclinkStudio.browser.reconcileViews({
        workspaceKey: activeWorkspaceKey,
        views: browserViews,
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
    browserViews,
    enabled,
    ensureBrowserTab,
    isBrowserTab,
    setBrowserTabReady,
    showNativeBrowserView,
  ])

  useEffect(() => {
    const next = browserTabIds
    const prev = prevBrowserIdsRef.current
    const removed = prev.filter((id) => !next.includes(id))
    for (const id of removed) {
      useBrowserStore.getState().removeTab(id)
      useBrowserFindStore.getState().remove(id)
    }
    prevBrowserIdsRef.current = next
  }, [browserTabIds])
}
