import type { WebContents } from 'electron'

/** 与网页 main world 隔离，且不注册任何 preload / IPC 通道。 */
const PLAIN_TEXT_LINK_WORLD_ID = 10_137

/**
 * 只在用户命中的 text node 内识别 HTTP(S) URL。脚本保持自包含，运行于 isolated world；
 * 它不扫描或回传页面正文，也不改写 DOM。
 */
export const PLAIN_TEXT_LINK_SCRIPT = String.raw`
(() => {
  if (globalThis.__cclinkPlainTextLinksInstalled === true) return
  globalThis.__cclinkPlainTextLinksInstalled = true

  const URL_PATTERN = /https?:\/\/[^\s<>"'\u0060]+/giu
  const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、)\]}〉》」』】]+$/u
  const INTERACTIVE_SELECTOR =
    'a[href], [role="link"], [onclick], button, input, textarea, select, option, [contenteditable]:not([contenteditable="false"])'
  let autoSelectedRange = null

  const textPositionAtPoint = (x, y) => {
    if (typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(x, y)
      return range ? { node: range.startContainer, offset: range.startOffset } : null
    }
    if (typeof document.caretPositionFromPoint === 'function') {
      const position = document.caretPositionFromPoint(x, y)
      return position ? { node: position.offsetNode, offset: position.offset } : null
    }
    return null
  }

  const urlAtPoint = (x, y) => {
    const position = textPositionAtPoint(x, y)
    if (!position || position.node.nodeType !== Node.TEXT_NODE) return null
    const parent = position.node.parentElement
    if (!parent || parent.closest(INTERACTIVE_SELECTOR)) return null

    const text = position.node.data || ''
    URL_PATTERN.lastIndex = 0
    for (const match of text.matchAll(URL_PATTERN)) {
      const start = match.index ?? -1
      const raw = match[0]
      const candidate = raw.replace(TRAILING_PUNCTUATION, '')
      const end = start + candidate.length
      if (start < 0 || position.offset < start || position.offset > end || !candidate) continue

      let url
      try {
        url = new URL(candidate)
      } catch {
        continue
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue

      const range = document.createRange()
      range.setStart(position.node, start)
      range.setEnd(position.node, end)
      const hit = Array.from(range.getClientRects()).some(
        (rect) => x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1,
      )
      if (hit) return { url: url.href, range }
    }
    return null
  }

  document.addEventListener(
    'mousedown',
    (event) => {
      if (event.button !== 2) return
      const hit = urlAtPoint(event.clientX, event.clientY)
      const selection = globalThis.getSelection()
      if (!selection) return
      if (!hit) {
        if (
          autoSelectedRange &&
          selection.rangeCount === 1 &&
          selection.getRangeAt(0).compareBoundaryPoints(Range.START_TO_START, autoSelectedRange) ===
            0 &&
          selection.getRangeAt(0).compareBoundaryPoints(Range.END_TO_END, autoSelectedRange) === 0
        ) {
          selection.removeAllRanges()
        }
        autoSelectedRange = null
        return
      }
      selection.removeAllRanges()
      selection.addRange(hit.range)
      autoSelectedRange = hit.range.cloneRange()
    },
    true,
  )

  document.addEventListener(
    'click',
    (event) => {
      if (event.button !== 0 || event.shiftKey || event.altKey) return
      const hit = urlAtPoint(event.clientX, event.clientY)
      if (!hit) return
      event.preventDefault()
      event.stopImmediatePropagation()
      globalThis.open(hit.url, '_blank')
    },
    true,
  )
})()
`

export async function installPlainTextLinkSupport(webContents: WebContents): Promise<void> {
  await webContents.executeJavaScriptInIsolatedWorld(PLAIN_TEXT_LINK_WORLD_ID, [
    { code: PLAIN_TEXT_LINK_SCRIPT },
  ])
}
