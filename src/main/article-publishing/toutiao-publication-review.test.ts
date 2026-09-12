import { describe, expect, it, vi } from 'vitest'
import {
  readToutiaoPublicationReview,
  TOUTIAO_PUBLICATION_MANAGEMENT_URL,
} from './toutiao-publication-review'

describe('Toutiao management result identity', () => {
  it.each(['current', 'duplicate', 'title', 'order', 'load', 'account', 'navigation'] as const)(
    'reads the actual card without treating a title or count alone as submission evidence: %s',
    async (mode) => {
      const sources = ['a', 'b', 'c'].map(
        (c) => `https://p3-sign.toutiaoimg.com/tos-cn-i-ezhpy3drpa/${c.repeat(32)}`,
      )
      const base = { getBoundingClientRect: () => ({ width: 100, height: 100 }) }
      const body = { ...base, children: [] as unknown[] }
      const makeCard = () => {
        const images = (mode === 'order' ? [...sources].reverse() : sources).map((src) => ({
          ...base,
          src,
          currentSrc: src,
          complete: mode !== 'load',
          naturalWidth: 200,
        }))
        const status = { ...base, innerText: '审核中', children: [] }
        const leaf = {
          ...base,
          innerText: mode === 'title' ? '另一篇文章' : 'Article\n内容',
          children: [],
          tagName: 'P',
          className: 'content',
          parentElement: null as unknown,
          querySelectorAll: () => [],
        }
        const row = {
          ...base,
          tagName: 'DIV',
          className: 'card',
          parentElement: body,
          children: [leaf],
          querySelectorAll: (s: string) =>
            s === 'span,div,p' ? [status] : s === 'img' ? images : [],
        }
        leaf.parentElement = row
        body.children.push(row)
        return leaf
      }
      const leaves = [makeCard(), ...(mode === 'duplicate' ? [makeCard()] : [])]
      vi.stubGlobal('document', { body, querySelectorAll: () => leaves })
      vi.stubGlobal('location', {
        href:
          mode === 'navigation'
            ? 'https://mp.toutiao.com/other'
            : TOUTIAO_PUBLICATION_MANAGEMENT_URL,
      })
      vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible', display: 'block' }))
      const page = {
        url: () => TOUTIAO_PUBLICATION_MANAGEMENT_URL,
        getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
        evaluate: async (fn: (args: unknown) => unknown, args?: unknown) =>
          args ? fn(args) : { uid: mode === 'account' ? 'other' : '12345' },
      }
      try {
        if (mode === 'account')
          await expect(
            readToutiaoPublicationReview(page as never, {
              uid: '12345',
              title: 'Article',
              images: sources,
            }),
          ).rejects.toThrow('不是本次原账号')
        else {
          const result = await readToutiaoPublicationReview(page as never, {
            uid: '12345',
            title: 'Article',
            images: sources,
          })
          expect(result.current && result.candidates.length === 1).toBe(mode === 'current')
          if (mode === 'current')
            expect(result.candidates[0]).toMatchObject({
              status: '审核中',
              urls: [],
              images: sources.map((src) => ({ src, loaded: true })),
            })
          if (mode === 'duplicate') expect(result.candidates).toHaveLength(2)
        }
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )
})
