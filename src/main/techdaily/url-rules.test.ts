import { describe, expect, it } from 'vitest'
import {
  articleKey,
  extractPublishedDate,
  extractUrlDate,
  freshnessGate,
  normalizeUrl,
} from './url-rules'

const today = '2026-11-25'

describe('normalizeUrl', () => {
  it('lowercases host, drops tracking params, fragment, default port and trailing slash', () => {
    expect(
      normalizeUrl('HTTPS://News.Example.COM:443/a/b/?utm_source=x&b=2&spm=1&a=1&from=hn#top'),
    ).toBe('https://news.example.com/a/b?a=1&b=2')
  })

  it('keeps non-default ports and meaningful params', () => {
    expect(normalizeUrl('http://example.com:8080/news?id=7')).toBe(
      'http://example.com:8080/news?id=7',
    )
  })

  it('gives the same key to tracking variants of one article', () => {
    expect(articleKey('https://a.com/x?id=1&utm_medium=feed')).toBe(
      articleKey('https://A.com/x/?id=1'),
    )
    expect(articleKey('https://a.com/x?id=1')).not.toBe(articleKey('https://a.com/x?id=2'))
  })
})

describe('extractUrlDate', () => {
  it.each([
    ['https://x.com/2026/11-24/123.html', '2026-11-24'],
    ['https://x.com/2026-1124/abc.html', '2026-11-24'],
    ['https://www.stcn.com/2026/1124/abc.shtml', '2026-11-24'],
    ['https://finance.sina.com.cn/doc-20261124abcd.shtml', '2026-11-24'],
    ['https://finance.eastmoney.com/a/202611243864222147.html', '2026-11-24'],
    ['https://stock.stockstar.com/RB2026112400007741.shtml', '2026-11-24'],
    ['https://news.fx678.com/content/202611240932451234.html', '2026-11-24'],
    ['https://www.dzwww.com/c/202611/t20261124_1234567.html', '2026-11-24'],
    ['https://news.qq.com/rain/a/20261124A0720X00', '2026-11-24'],
    ['https://x.com/view?id=9&pub_date=2026-11-24', '2026-11-24'],
    ['https://x.com/news/20261124.html', '2026-11-24'],
  ])('%s → %s', (url, day) => {
    expect(extractUrlDate(url, today)).toBe(day)
  })

  it('rejects future dates and impossible days', () => {
    expect(extractUrlDate('https://x.com/2026/12-30/a.html', today)).toBeNull()
    expect(extractUrlDate('https://x.com/2026/02-30/a.html', today)).toBeNull()
    expect(extractUrlDate('https://x.com/2026/11-26/a.html', today)).toBe('2026-11-26') // tomorrow tolerated
  })

  it('does not read a date out of the middle of a long id', () => {
    expect(extractUrlDate('https://x.com/p/a920261124123456789b', today)).toBeNull()
  })
})

describe('freshnessGate', () => {
  it('prefers the URL date, falls back to the result date, keeps undated', () => {
    expect(freshnessGate('https://x.com/2026/11-20/a', '2026-11-25T01:00:00Z', 3, today)).toEqual({
      keep: false,
      date: '2026-11-20',
    })
    expect(freshnessGate('https://x.com/a', '2026-11-23T08:00:00', 3, today)).toEqual({
      keep: true,
      date: '2026-11-23',
    })
    expect(freshnessGate('https://x.com/a', null, 3, today)).toEqual({ keep: true, date: null })
  })

  it('reads compact published dates only when the whole string is a date', () => {
    expect(extractPublishedDate('20261124', today)).toBe('2026-11-24')
    expect(extractPublishedDate('id 20261124 x', today)).toBeNull()
  })
})
