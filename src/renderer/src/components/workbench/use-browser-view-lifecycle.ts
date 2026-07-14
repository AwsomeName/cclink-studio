import { useEffect, useMemo, useRef } from 'react'
import { useBrowserStore } from '../../stores/browser-store'
import { useTabStore } from '../../stores/tab-store'
import type { Tab } from '../../types'

/** 管理内嵌浏览器 WebContentsView 的创建、激活、隐藏和销毁。 */
export function useBrowserViewLifecycle(activeTab: Tab | undefined, tabs: Tab[]): void {
  const ensureBrowserTab = useBrowserStore((s) => s.ensureTab)
  const setBrowserTabReady = useBrowserStore((s) => s.setReady)
  const activeTabId = activeTab?.id
  const isBrowserTab = activeTab?.type === 'browser'
  const browserTabKey = useMemo(
    () => tabs.filter((tab) => tab.type === 'browser').map((tab) => tab.id).join('\u0000'),
    [tabs],
  )
  const prevBrowserIdsRef = useRef<string[]>(browserTabKey ? browserTabKey.split('\u0000') : [])

  useEffect(() => {
    let cancelled = false

    const manage = async (): Promise<void> => {
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
          await window.deepink.browser.createView(activeTabId, state.url, {
            ...(restore ? { restore } : {}),
            profileId: currentTab?.browserProfile ?? null,
          })
          if (cancelled) return
          setBrowserTabReady(activeTabId)
        }
        await window.deepink.browser.setActive(activeTabId)
        return
      }

      await window.deepink.browser.setActive(null)
    }

    void manage()
    return () => {
      cancelled = true
    }
  }, [activeTabId, isBrowserTab, ensureBrowserTab, setBrowserTabReady])

  useEffect(() => {
    const next = browserTabKey ? browserTabKey.split('\u0000') : []
    const prev = prevBrowserIdsRef.current
    const removed = prev.filter((id) => !next.includes(id))
    for (const id of removed) {
      window.deepink.browser.destroyView(id)
      useBrowserStore.getState().removeTab(id)
    }
    prevBrowserIdsRef.current = next
  }, [browserTabKey])
}
