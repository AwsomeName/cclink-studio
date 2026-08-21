import { describe, expect, it } from 'vitest'
import type { BrowserHistoryEntry } from '@shared/ipc/browser'
import {
  getRecentBrowserUrlLabel,
  isBrowserNewTabUrl,
  selectRecentBrowserHistory,
} from './browser-new-tab'

function historyEntry(
  id: string,
  url: string,
  visitedAt: number,
  title: string | null = null,
): BrowserHistoryEntry {
  return { id, url, visitedAt, title }
}

describe('browser new tab history', () => {
  it('recognizes only the explicit blank browser tab', () => {
    expect(isBrowserNewTabUrl('about:blank')).toBe(true)
    expect(isBrowserNewTabUrl('https://example.com')).toBe(false)
    expect(isBrowserNewTabUrl(undefined)).toBe(false)
  })

  it('keeps the eight most recent unique web addresses', () => {
    const history = Array.from({ length: 10 }, (_, index) =>
      historyEntry(`history-${index}`, `https://example.com/${index}`, index),
    )
    history.push(historyEntry('duplicate', 'https://example.com/9', 100))
    history.push(historyEntry('internal', 'about:blank', 101))

    const recent = selectRecentBrowserHistory(history)

    expect(recent).toHaveLength(8)
    expect(recent.map((entry) => entry.url)).toEqual([
      'https://example.com/9',
      'https://example.com/8',
      'https://example.com/7',
      'https://example.com/6',
      'https://example.com/5',
      'https://example.com/4',
      'https://example.com/3',
      'https://example.com/2',
    ])
  })

  it('formats recent addresses without a redundant root slash', () => {
    expect(getRecentBrowserUrlLabel('https://www.example.com/')).toBe('www.example.com')
    expect(getRecentBrowserUrlLabel('https://example.com/docs')).toBe('example.com/docs')
  })
})
