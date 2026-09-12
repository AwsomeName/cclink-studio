import { describe, expect, it, vi } from 'vitest'
import { parseToutiaoPublicationUrl, readToutiaoPublication } from './toutiao-publication'

describe('Toutiao public result evidence', () => {
  it('keeps exact digit IDs and rejects lookalike origins, credentials and non-result routes', () => {
    expect(parseToutiaoPublicationUrl('https://www.toutiao.com/w/1876018407641100/')?.id).toBe(
      '1876018407641100',
    )
    for (const url of [
      'https://www.toutiao.com.evil.test/w/123/',
      'https://x@www.toutiao.com/w/123/',
      'https://mp.toutiao.com/profile_v4/weitoutiao',
      'https://www.toutiao.com/w/123/?other=1',
    ])
      expect(parseToutiaoPublicationUrl(url)).toBeNull()
  })
  it.each(['current', 'duplicate', 'wrong-title', 'no-images', 'navigation'] as const)(
    'reads a unique body/gallery without borrowing another card: %s',
    async (mode) => {
      const url = 'https://www.toutiao.com/w/123/'
      const body = {}
      const base = { getBoundingClientRect: () => ({ width: 100, height: 100 }) }
      const image = {
        currentSrc: `https://p11-sign.toutiaoimg.com/tos-cn-i-ezhpy3drpa/${'a'.repeat(32)}~tplv-obj.image?x-signature=secret`,
        complete: true,
        naturalWidth: 100,
      }
      const makeLeaf = () => ({
        ...base,
        innerText: mode === 'wrong-title' ? 'Other' : 'Article\nActual body',
        children: [],
        parentElement: body,
        className: 'actual-content',
        querySelectorAll: () => (mode === 'no-images' ? [] : [image]),
      })
      vi.stubGlobal('document', {
        body,
        querySelectorAll: () => [makeLeaf(), ...(mode === 'duplicate' ? [makeLeaf()] : [])],
      })
      vi.stubGlobal('location', {
        href: mode === 'navigation' ? 'https://www.toutiao.com/w/456/' : url,
      })
      vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible', display: 'block' }))
      const page = {
        url: () => url,
        getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
        evaluate: async (fn: (v: unknown) => unknown, args: unknown) => fn(args),
      }
      try {
        const result = await readToutiaoPublication(page as never, 'Article')
        expect(result.recognized).toBe(mode === 'current')
        if (mode === 'current') {
          expect(result.text).toBe('Article\nActual body')
          expect(result.images[0].loaded).toBe(true)
          expect(result.images[0].src).not.toContain('signature')
        }
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )
})
