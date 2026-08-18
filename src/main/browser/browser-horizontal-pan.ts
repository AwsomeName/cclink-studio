import type { WebContents } from 'electron'

/** 与网页 main world 隔离，且不注册任何 preload / IPC 通道。 */
const HORIZONTAL_PAN_WORLD_ID = 10_138

/**
 * Chromium 会处理正常的横向滚动容器。这里仅为仍有横向范围、但网站显式隐藏滚动的容器
 * 提供触控板横滑与 Shift + 滚轮兜底；不读取正文、不改写 DOM，也不建立通信通道。
 */
export const HORIZONTAL_PAN_SCRIPT = String.raw`
(() => {
  if (globalThis.__cclinkHorizontalPanInstalled === true) return
  globalThis.__cclinkHorizontalPanInstalled = true

  const MIN_DELTA = 0.5

  const scaledDelta = (event) => {
    const raw = Math.abs(event.deltaX) >= MIN_DELTA
      ? event.deltaX
      : event.shiftKey && Math.abs(event.deltaY) >= MIN_DELTA
        ? event.deltaY
        : 0
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return raw * 32
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return raw * Math.max(globalThis.innerWidth, 1)
    return raw
  }

  const canMove = (element, delta) => {
    const max = Math.max(0, element.scrollWidth - element.clientWidth)
    if (max <= MIN_DELTA) return false
    const next = Math.min(max, Math.max(0, element.scrollLeft + delta))
    return Math.abs(next - element.scrollLeft) >= MIN_DELTA
  }

  const candidatesFor = (event) => {
    const candidates = []
    const seen = new Set()
    const add = (candidate) => {
      if (!candidate || candidate.nodeType !== Node.ELEMENT_NODE || seen.has(candidate)) return
      seen.add(candidate)
      candidates.push(candidate)
    }

    if (typeof event.composedPath === 'function') {
      for (const candidate of event.composedPath()) add(candidate)
    } else {
      let candidate = event.target instanceof Element ? event.target : event.target?.parentElement
      while (candidate) {
        add(candidate)
        candidate = candidate.parentElement
      }
    }
    add(document.scrollingElement)
    add(document.documentElement)
    add(document.body)
    return candidates
  }

  document.addEventListener(
    'wheel',
    (event) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return
      const delta = scaledDelta(event)
      if (Math.abs(delta) < MIN_DELTA) return

      const candidates = candidatesFor(event)
      const nativeScroller = candidates.some((element) => {
        const overflowX = globalThis.getComputedStyle(element).overflowX
        return (overflowX === 'auto' || overflowX === 'scroll') && canMove(element, delta)
      })
      if (nativeScroller) return

      const viewportOverflowHidden = [document.documentElement, document.body].some(
        (element) => element && globalThis.getComputedStyle(element).overflowX === 'hidden',
      )
      for (const element of candidates) {
        const hiddenScroller =
          globalThis.getComputedStyle(element).overflowX === 'hidden' ||
          (element === document.scrollingElement && viewportOverflowHidden)
        if (!hiddenScroller || !canMove(element, delta)) {
          continue
        }
        const before = element.scrollLeft
        const max = Math.max(0, element.scrollWidth - element.clientWidth)
        element.scrollLeft = Math.min(max, Math.max(0, before + delta))
        if (Math.abs(element.scrollLeft - before) < MIN_DELTA) continue
        event.preventDefault()
        return
      }
    },
    { capture: true, passive: false },
  )
})()
`

export async function installHorizontalPanSupport(webContents: WebContents): Promise<void> {
  await webContents.executeJavaScriptInIsolatedWorld(HORIZONTAL_PAN_WORLD_ID, [
    { code: HORIZONTAL_PAN_SCRIPT },
  ])
}
