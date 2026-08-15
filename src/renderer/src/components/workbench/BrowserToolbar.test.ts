import { describe, expect, it } from 'vitest'
import {
  inferWebResourceDisplayName,
  normalizeBrowserZoomPercent,
  shouldNavigateBrowserAddress,
} from './BrowserToolbar'

describe('shouldNavigateBrowserAddress', () => {
  it('submits an ordinary Enter key', () => {
    expect(
      shouldNavigateBrowserAddress({
        key: 'Enter',
        nativeIsComposing: false,
        compositionActive: false,
      }),
    ).toBe(true)
  })

  it('does not submit the Enter used to confirm an IME composition', () => {
    expect(
      shouldNavigateBrowserAddress({
        key: 'Enter',
        nativeIsComposing: true,
        compositionActive: true,
      }),
    ).toBe(false)
  })

  it('keeps the composition guard when Chromium reports a stale native flag', () => {
    expect(
      shouldNavigateBrowserAddress({
        key: 'Enter',
        nativeIsComposing: false,
        compositionActive: true,
      }),
    ).toBe(false)
  })

  it('ignores non-submit keys', () => {
    expect(
      shouldNavigateBrowserAddress({
        key: 'a',
        nativeIsComposing: false,
        compositionActive: false,
      }),
    ).toBe(false)
  })
})

describe('inferWebResourceDisplayName', () => {
  it('prefills the account name from the visible page title', () => {
    expect(
      inferWebResourceDisplayName({
        title: 'V2EX',
        url: 'https://www.v2ex.com/',
        urlInput: 'https://www.v2ex.com/',
      }),
    ).toBe('V2EX')
  })

  it('falls back to a readable hostname', () => {
    expect(
      inferWebResourceDisplayName({
        title: null,
        url: 'https://www.example.com/account',
        urlInput: 'https://www.example.com/account',
      }),
    ).toBe('example.com')
  })

  it('does not invent a name for an invalid address', () => {
    expect(
      inferWebResourceDisplayName({ title: null, url: 'about:blank', urlInput: 'not a url' }),
    ).toBe('')
  })
})

describe('normalizeBrowserZoomPercent', () => {
  it('accepts a plain percentage or a trailing percent sign', () => {
    expect(normalizeBrowserZoomPercent('125')).toBe(125)
    expect(normalizeBrowserZoomPercent(' 80% ')).toBe(80)
  })

  it('clamps manual zoom to the browser contract range', () => {
    expect(normalizeBrowserZoomPercent('10')).toBe(30)
    expect(normalizeBrowserZoomPercent('500')).toBe(300)
  })

  it('rejects empty and malformed input instead of changing zoom', () => {
    expect(normalizeBrowserZoomPercent('')).toBeNull()
    expect(normalizeBrowserZoomPercent('100px')).toBeNull()
  })
})
