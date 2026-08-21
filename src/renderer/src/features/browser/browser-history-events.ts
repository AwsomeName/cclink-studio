export const BROWSER_HISTORY_CHANGED_EVENT = 'cclink:browser-history-changed'

export function notifyBrowserHistoryChanged(): void {
  window.dispatchEvent(new Event(BROWSER_HISTORY_CHANGED_EVENT))
}

export function observeBrowserHistoryChanged(listener: () => void): () => void {
  window.addEventListener(BROWSER_HISTORY_CHANGED_EVENT, listener)
  return () => window.removeEventListener(BROWSER_HISTORY_CHANGED_EVENT, listener)
}
