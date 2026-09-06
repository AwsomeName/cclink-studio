import type { BrowserManager } from '../browser/browser-manager'

export interface XiaohongshuSearchResult {
  noteId: string
  title: string
  authorDisplayName?: string
}

export interface XiaohongshuPageInspection {
  url: string
  title: string
  loginRequired: boolean
  noteId: string | null
  imageIndex: number
  totalImages: number
  visibleText: string[]
  authorDisplayName?: string
  results: XiaohongshuSearchResult[]
}

export interface XiaohongshuVisiblePageIdentity {
  browserViewRuntimeGeneration: number
  webContentsId: number
}

const INSPECT_SCRIPT = String.raw`(() => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }
  const bounded = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
  const noteIdFrom = (value) => {
    const match = String(value || '').match(/\/(?:explore|discovery\/item|search_result)\/([a-zA-Z0-9_-]{6,200})/)
    return match ? match[1] : null
  }
  const detailRoots = [...document.querySelectorAll('[role="dialog"], [class*="note-detail"], [class*="noteDetail"]')].filter(visible)
  const detailRoot = detailRoots.at(-1) || null
  let noteId = noteIdFrom(location.href)
  if (!noteId && detailRoot) {
    const identityNode = [...detailRoot.querySelectorAll('[data-note-id]')].find(visible)
    noteId = bounded(identityNode?.getAttribute('data-note-id'), 200) || null
  }
  if (!noteId && detailRoot) {
    const identityAnchor = [...detailRoot.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/search_result/"]')].find(visible)
    noteId = noteIdFrom(identityAnchor?.getAttribute('href'))
  }

  const resultMap = new Map()
  for (const anchor of document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/search_result/"]')) {
    if (!visible(anchor) || (detailRoot && detailRoot.contains(anchor))) continue
    const resultNoteId = noteIdFrom(anchor.getAttribute('href'))
    const text = bounded(anchor.innerText, 500)
    if (!resultNoteId || !text || resultMap.has(resultNoteId)) continue
    const lines = text.split(/\n+/).map((line) => bounded(line, 300)).filter(Boolean)
    resultMap.set(resultNoteId, {
      noteId: resultNoteId,
      title: lines[0] || '未命名笔记',
      ...(lines.length > 1 ? { authorDisplayName: lines.at(-1) } : {}),
    })
    if (resultMap.size >= 10) break
  }

  const visibleText = []
  let visibleTextLength = 0
  const textRoot = detailRoot || document
  const textSelectors = [
    'h1',
    '[class*="title"]',
    '[class*="desc"]',
    '[class*="tag"]',
  ]
  for (const selector of textSelectors) {
    for (const element of textRoot.querySelectorAll(selector)) {
      if (!visible(element) || visibleText.length >= 20) continue
      const value = bounded(element.innerText, 500)
      if (!value || visibleText.includes(value) || visibleTextLength + value.length > 2000) continue
      visibleText.push(value)
      visibleTextLength += value.length
    }
  }

  const authorElement = detailRoot
    ? [...detailRoot.querySelectorAll('[class*="author"], [class*="user-name"], [class*="username"]')].find(visible)
    : null
  const dots = detailRoot
    ? [...detailRoot.querySelectorAll('.swiper-pagination-bullet, [class*="indicator"] [class*="dot"]')].filter(visible)
    : []
  let imageIndex = 0
  for (let index = 0; index < dots.length; index += 1) {
    if (/active|current|selected/i.test(dots[index].className || '')) {
      imageIndex = index
      break
    }
  }
  const bodyText = bounded(document.body?.innerText, 5000)
  return {
    url: location.href,
    title: bounded(document.title, 500),
    loginRequired: bodyText.includes('登录后查看搜索结果') || !!document.querySelector('input[placeholder*="手机号"]'),
    noteId,
    imageIndex,
    totalImages: Math.max(1, dots.length),
    visibleText,
    ...(authorElement ? { authorDisplayName: bounded(authorElement.innerText, 200) } : {}),
    results: [...resultMap.values()],
  }
})()`

export class XiaohongshuVisiblePageAdapter {
  constructor(
    private readonly browserManager: BrowserManager,
    private readonly identity?: XiaohongshuVisiblePageIdentity,
  ) {}

  inspect(tabId: string): Promise<XiaohongshuPageInspection> {
    return this.browserManager.executeJavaScriptInView<XiaohongshuPageInspection>(
      tabId,
      INSPECT_SCRIPT,
      this.executionOptions(),
    )
  }

  async waitForInspectablePage(
    tabId: string,
    timeoutMs = 8_000,
  ): Promise<XiaohongshuPageInspection> {
    const deadline = Date.now() + timeoutMs
    let latest = await this.inspect(tabId)
    while (
      Date.now() < deadline &&
      !latest.loginRequired &&
      !latest.noteId &&
      latest.results.length === 0 &&
      !latest.url.includes('/404')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      latest = await this.inspect(tabId)
    }
    return latest
  }

  async openResult(tabId: string, noteId: string): Promise<boolean> {
    const script = String.raw`(() => {
      const expected = ${JSON.stringify(noteId)}
      const visible = (element) => {
        if (!(element instanceof Element)) return false
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }
      const noteIdFrom = (value) => {
        const match = String(value || '').match(/\/(?:explore|discovery\/item|search_result)\/([a-zA-Z0-9_-]{6,200})/)
        return match ? match[1] : null
      }
      const anchor = [...document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"], a[href*="/search_result/"]')]
        .find((item) => visible(item) && noteIdFrom(item.getAttribute('href')) === expected)
      if (!anchor) return false
      anchor.click()
      return true
    })()`
    return this.browserManager.executeJavaScriptInView<boolean>(tabId, script, {
      ...this.executionOptions(),
      userGesture: true,
    })
  }

  async moveToImageIndex(tabId: string, target: number): Promise<void> {
    for (let index = 0; index < target; index += 1) {
      const clicked = await this.browserManager.executeJavaScriptInView<boolean>(
        tabId,
        String.raw`(() => {
          const visible = (element) => {
            if (!(element instanceof Element)) return false
            const style = getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          }
          const root = [...document.querySelectorAll('[role="dialog"], [class*="note-detail"], [class*="noteDetail"]')].filter(visible).at(-1)
          if (!root) return false
          const next = [...root.querySelectorAll('button[aria-label*="下一"], [class*="next"]')].find(visible)
          if (!next) return false
          next.click()
          return true
        })()`,
        { ...this.executionOptions(), userGesture: true },
      )
      if (!clicked) break
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }

  private executionOptions(): {
    expectedRuntimeGeneration?: number
    expectedWebContentsId?: number
  } {
    return {
      expectedRuntimeGeneration: this.identity?.browserViewRuntimeGeneration,
      expectedWebContentsId: this.identity?.webContentsId,
    }
  }
}
