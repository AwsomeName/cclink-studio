import { describe, expect, it } from 'vitest'
import {
  TAB_IDENTITY_COLORS,
  browserMonogram,
  desktopIdentity,
  identityColorFor,
  nextIdentityColor,
  normalizeTabShortName,
  shortNameFromLabel,
} from './tab-identity'
import { accountBadgeFor } from './TabIdentityIcon'
import { normalizeDesktopIdentity } from '../../stores/tab-store'

describe('shortNameFromLabel', () => {
  it('takes one Chinese character or two Latin initials', () => {
    expect(shortNameFromLabel('家里 Mac mini')).toBe('家')
    expect(shortNameFromLabel('公司电脑')).toBe('公')
    expect(shortNameFromLabel('MacBook Pro')).toBe('MP')
    expect(shortNameFromLabel('studio')).toBe('St')
    expect(shortNameFromLabel('M1')).toBe('M1')
    expect(shortNameFromLabel('  ')).toBe('')
    expect(shortNameFromLabel('···')).toBe('')
  })
})

describe('identity colors', () => {
  it('is stable per key and cycles through the palette', () => {
    expect(identityColorFor('device-1')).toBe(identityColorFor('device-1'))
    const seen = new Set(Array.from({ length: 40 }, (_, i) => identityColorFor(`device-${i}`)))
    expect(seen.size).toBeGreaterThan(4)
    expect(nextIdentityColor(TAB_IDENTITY_COLORS[TAB_IDENTITY_COLORS.length - 1]!)).toBe(
      TAB_IDENTITY_COLORS[0],
    )
  })

  it('limits manual short names to two characters', () => {
    expect(normalizeTabShortName('  家 里 电脑 ')).toBe('家里')
    expect(normalizeTabShortName('')).toBe('')
  })
})

describe('desktopIdentity', () => {
  it('uses the device name, then a manual override, then the host', () => {
    const base = { tabId: 't1', target: { deviceId: 'd1' } }
    const named = desktopIdentity({ ...base, title: '家里 Mac' })
    expect(named?.text).toBe('家')
    expect(named?.color).toBe(identityColorFor('d1'))
    expect(
      desktopIdentity({
        ...base,
        title: '家里 Mac',
        override: { shortName: '卧室', color: 'red' },
      }),
    ).toEqual({ text: '卧室', color: 'red' })
    expect(
      desktopIdentity({ tabId: 't1', title: '远程桌面', target: { host: '192.168.1.23' } })?.text,
    ).toBe('.23')
    expect(desktopIdentity({ tabId: 't1', title: '远程桌面' })).toBeNull()
  })
})

describe('browserMonogram', () => {
  it('uses the site name, the domain, then the page title for local servers', () => {
    expect(browserMonogram({ url: 'https://www.zhihu.com/question/1' })?.text).toBe('Z')
    expect(browserMonogram({ url: 'https://docs.github.com/x' })?.text).toBe('G')
    expect(
      browserMonogram({ url: 'http://127.0.0.1:8765/book', pageTitle: '15.4 登录和授权' })?.text,
    ).toBe('登')
    expect(browserMonogram({ url: 'https://example.com', siteName: '博客园' })?.text).toBe('博')
    expect(browserMonogram({ url: 'about:blank' })).toBeNull()
    expect(browserMonogram({ url: 'not a url' })).toBeNull()
  })

  it('gives different local ports different colors keys', () => {
    const a = browserMonogram({ url: 'http://127.0.0.1:8765/', pageTitle: 'A' })
    const b = browserMonogram({ url: 'http://127.0.0.1:8765/other', pageTitle: 'B' })
    expect(a?.color).toBe(b?.color)
    expect(a?.color).toBe(identityColorFor('127.0.0.1:8765'))
  })
})

describe('accountBadgeFor', () => {
  it('shows the last two digits of a phone number, else the first character', () => {
    expect(accountBadgeFor('acc-1', '138 0000 1123')?.text).toBe('23')
    expect(accountBadgeFor('acc-1', '张三')?.text).toBe('张')
    expect(accountBadgeFor('acc-1', 'liuchang')?.text).toBe('L')
    expect(accountBadgeFor('acc-1', '  ')).toBeNull()
  })
})

describe('normalizeDesktopIdentity', () => {
  it('keeps only a valid short name and palette color', () => {
    expect(normalizeDesktopIdentity({ shortName: '家里电脑', color: 'teal' })).toEqual({
      shortName: '家里',
      color: 'teal',
    })
    expect(normalizeDesktopIdentity({ shortName: 7, color: '#fff' })).toBeUndefined()
    expect(normalizeDesktopIdentity(null)).toBeUndefined()
  })
})
