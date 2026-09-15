import { describe, expect, it, vi } from 'vitest'
import {
  openToutiaoPublicationResult,
  TOUTIAO_PUBLICATION_MANAGEMENT_URL,
} from './toutiao-publication-review'

describe('Toutiao published entry navigation', () => {
  it.each(['popup', 'same-tab', 'aliases', 'different', 'cancelled'] as const)(
    'waits for an exact public URL and rejects ambiguous results: %s',
    async (mode) => {
      let active = true
      const click = vi.fn(async () => {
        if (mode === 'cancelled') active = false
      })
      const check = async (predicate: (url: URL) => boolean) => {
        expect(predicate(new URL(TOUTIAO_PUBLICATION_MANAGEMENT_URL))).toBe(false)
        expect(predicate(new URL('https://www.toutiao.com/'))).toBe(false)
        expect(predicate(new URL('https://www.toutiao.com.evil.test/w/123/'))).toBe(false)
        expect(predicate(new URL('https://www.toutiao.com/w/123/'))).toBe(true)
      }
      let navigated = false
      const page = {
        url: () =>
          navigated ? 'https://www.toutiao.com/w/123/' : TOUTIAO_PUBLICATION_MANAGEMENT_URL,
        getByText: () => ({ first: () => ({ waitFor: async () => undefined }) }),
        evaluate: async (_fn: unknown, args?: unknown) =>
          args
            ? {
                current: true,
                candidates: [{ status: '已发布', titleSelector: 'body > p' }],
              }
            : { uid: '12345' },
        locator: () => ({ count: async () => 1, innerText: async () => 'Article', click }),
        waitForEvent: async () => {
          if (mode === 'same-tab') throw new Error('no popup')
          return {
            waitForURL: check,
            url: () => `https://toutiao.com/w/${mode === 'different' ? '456' : '123'}/`,
          }
        },
        waitForURL: async (predicate: (url: URL) => boolean) => {
          await check(predicate)
          if (mode === 'popup' || mode === 'cancelled') throw new Error('no navigation')
          navigated = true
        },
      }
      const result = openToutiaoPublicationResult(
        page as never,
        { uid: '12345', title: 'Article', images: [] },
        () => active,
      )
      if (mode === 'different' || mode === 'cancelled')
        await expect(result).rejects.toThrow('未返回唯一公开地址')
      else await expect(result).resolves.toBe('https://www.toutiao.com/w/123/')
      expect(click).toHaveBeenCalledTimes(1)
    },
  )
})
