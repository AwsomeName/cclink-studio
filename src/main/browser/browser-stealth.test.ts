import { describe, expect, it } from 'vitest'
import { normalizeDesktopUserAgent } from './browser-stealth'

describe('browser stealth', () => {
  it('removes the localized packaged product token and Electron token', () => {
    expect(
      normalizeDesktopUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) CCLinkStudio开源版/0.1.37 Chrome/150.0.7871.114 Electron/43.1.1 Safari/537.36',
      ),
    ).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.114 Safari/537.36',
    )
  })

  it('keeps an already normalized Chrome user agent unchanged', () => {
    const userAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.114 Safari/537.36'

    expect(normalizeDesktopUserAgent(userAgent)).toBe(userAgent)
  })
})
