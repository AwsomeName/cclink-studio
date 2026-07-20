import { useEffect } from 'react'
import { useBrowserStore } from '../../stores/browser-store'

/** 将主进程浏览器事件分发到 per-tab browser store。 */
export function useBrowserEvents(): void {
  useEffect(() => {
    const offUrlChanged = window.cclinkStudio.browser.onUrlChanged((payload) => {
      useBrowserStore.getState().setUrl(payload.tabId, payload.url, payload)
    })
    const offPageMetaChanged = window.cclinkStudio.browser.onPageMetaChanged((payload) => {
      useBrowserStore.getState().setPageMeta(payload.tabId, payload)
    })
    const offViewStateChanged = window.cclinkStudio.browser.onViewStateChanged((state) => {
      if (state?.tabId) {
        useBrowserStore.getState().setViewState(state.tabId, state)
      }
    })
    return () => {
      offUrlChanged()
      offPageMetaChanged()
      offViewStateChanged()
    }
  }, [])
}
