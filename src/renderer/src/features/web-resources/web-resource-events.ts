export const WEB_RESOURCES_CHANGED_EVENT = 'cclink:web-resources-changed'

export function notifyWebResourcesChanged(): void {
  window.dispatchEvent(new Event(WEB_RESOURCES_CHANGED_EVENT))
}

export function observeWebResourcesChanged(listener: () => void): () => void {
  window.addEventListener(WEB_RESOURCES_CHANGED_EVENT, listener)
  return () => window.removeEventListener(WEB_RESOURCES_CHANGED_EVENT, listener)
}
