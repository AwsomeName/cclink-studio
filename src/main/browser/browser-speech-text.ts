/** Fixed, read-only isolated-world extractor. Never evaluates page-provided code or modifies DOM. */
export function browserSpeechScript(selection: boolean): string {
  return `(${extractBrowserSpeech.toString()})(${selection ? 'true' : 'false'})`
}

function extractBrowserSpeech(selection: boolean): { text: string; tooLarge: boolean } {
  const limit = 120_000
  if (selection) {
    const text = window.getSelection()?.toString() ?? ''
    return { text: text.slice(0, limit), tooLarge: text.length > limit }
  }
  const excluded =
    'nav,header,footer,aside,form,button,input,textarea,select,script,style,noscript,pre,code,[hidden],[aria-hidden="true"],[role="navigation"],[role="dialog"]'
  const visible = (element: Element): boolean => {
    if (element.closest(excluded)) return false
    const style = window.getComputedStyle(element)
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' &&
      (style.display === 'contents' || element.getClientRects().length > 0)
    )
  }
  const roots = Array.from(document.querySelectorAll('article,main,[role="main"]')).filter(visible)
  const candidates = roots.length ? roots : [document.body]
  let best = ''
  for (const root of candidates.slice(0, 30)) {
    if (!visible(root)) continue
    // Walk text nodes once. Reading every ancestor's innerText duplicates nested
    // list/quote content and includes excluded descendants inside a paragraph.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element
          if (!visible(element)) return NodeFilter.FILTER_REJECT
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let text = ''
    let previousBlock: Element | null = null
    let count = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (++count > 12_000) return { text: '', tooLarge: true }
      if (node.nodeType === Node.ELEMENT_NODE) {
        if ((node as Element).tagName === 'BR') text += '\n'
        continue
      }
      const value = (node.textContent ?? '').replace(/\s+/gu, ' ')
      if (!value.trim()) {
        if (text && !/\s$/u.test(text)) text += ' '
        continue
      }
      const block =
        node.parentElement?.closest(
          'h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,div,section,article,main',
        ) ?? root
      if (block !== previousBlock && text) text += '\n\n'
      text += value
      previousBlock = block
      if (text.length > limit) return { text: '', tooLarge: true }
    }
    if (text.length > best.length) best = text
  }
  return { text: best.trim(), tooLarge: false }
}
