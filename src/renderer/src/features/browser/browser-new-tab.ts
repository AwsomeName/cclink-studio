import type { BrowserHistoryEntry } from '@shared/ipc/browser'

export const BROWSER_NEW_TAB_URL = 'about:blank'
export const RECENT_BROWSER_HISTORY_LIMIT = 8

export function isBrowserNewTabUrl(url: string | undefined): boolean {
  return url === BROWSER_NEW_TAB_URL
}

export function selectRecentBrowserHistory(
  history: BrowserHistoryEntry[],
  limit = RECENT_BROWSER_HISTORY_LIMIT,
): BrowserHistoryEntry[] {
  const seen = new Set<string>()
  return [...history]
    .sort((left, right) => right.visitedAt - left.visitedAt)
    .filter((entry) => {
      if (seen.has(entry.url)) return false
      try {
        const protocol = new URL(entry.url).protocol
        if (protocol !== 'http:' && protocol !== 'https:') return false
      } catch {
        return false
      }
      seen.add(entry.url)
      return true
    })
    .slice(0, Math.max(0, limit))
}

export function getRecentBrowserUrlLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch {
    return url
  }
}
