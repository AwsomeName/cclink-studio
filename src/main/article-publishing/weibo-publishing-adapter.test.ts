import type { Page } from 'playwright-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WeiboPublishingAdapter } from './weibo-publishing-adapter'
import { readWeiboPublication } from './weibo-publication'

afterEach(() => vi.unstubAllGlobals())

describe('Weibo publication document identity', () => {
  it.each([
    'https://weibo.com/5961101548/RiX22ovwL?pagetype=profilefeed',
    'https://weibo.com/5961101548/RiX22ovwL/',
    'https://weibo.com/5961101548/RiX22ovwL#comments',
  ])('preserves the observed URL for runtime attestation: %s', async (url) => {
    vi.stubGlobal('document', { querySelectorAll: () => [] })
    vi.stubGlobal('location', { href: url })
    const page = {
      url: () => url,
      evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
    } as unknown as Page

    const probe = await new WeiboPublishingAdapter().probe(page)
    expect(probe.url).toBe(page.url())
    const publication = await readWeiboPublication(page)
    expect(publication.url).toBe('https://weibo.com/5961101548/RiX22ovwL')
    expect(publication.documentUrl).toBe(url)
    expect(probe.pageKind).toBe('unsupported')
    expect(probe.publishedLinks).toEqual([])
  })

  it('exposes navigation during observation instead of echoing the prior URL', async () => {
    vi.stubGlobal('document', { querySelectorAll: () => [] })
    vi.stubGlobal('location', { href: 'https://weibo.com/5961101548/Another1' })
    const page = {
      url: () => 'https://weibo.com/5961101548/RiX22ovwL',
      evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
    } as unknown as Page
    const probe = await new WeiboPublishingAdapter().probe(page)
    expect(probe.url).not.toBe(page.url())
  })
})
