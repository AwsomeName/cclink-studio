import { EventEmitter } from 'node:events'
import { readToutiaoPublicationReview } from './toutiao-publication-review'
vi.mock('./toutiao-publication-review', () => ({
  TOUTIAO_PUBLICATION_MANAGEMENT_URL: 'https://mp.toutiao.com/profile_v4/weitoutiao',
  readToutiaoPublicationReview: vi.fn(),
}))
import { describe, expect, it, vi } from 'vitest'
import { toutiaoResponseShape, observeToutiaoSubmission } from './toutiao-submission'

describe('Toutiao bounded submit diagnostics', () => {
  it('retains platform result code and exact string IDs without content or secrets', () => {
    const shape = toutiaoResponseShape({
      code: 0,
      data: {
        item_id: '1234567890123456789',
        title: 'private body',
        content: 'private body',
        url: 'https://signed.test/?secret=x',
        access_token: 'secret',
        signature: 'secret',
        user: { name: 'private name' },
      },
    })
    expect(shape.code).toBe(0)
    expect(shape['data.item_id']).toBe('1234567890123456789')
    expect(JSON.stringify(shape)).not.toMatch(/private|signed.test|secret|signature|access_token/u)
  })
  it('bounds field enumeration and does not guess an ID from an unsafe numeric representation', () => {
    const shape = toutiaoResponseShape({
      id: 1234567890123456789,
      ...Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          `field${i}`,
          { value: { nested: { tooDeep: 'x' } } },
        ]),
      ),
    })
    expect(shape.id).toBe('number')
    expect(Object.keys(shape).length).toBeLessThanOrEqual(40)
    expect(JSON.stringify(shape)).not.toContain('tooDeep')
  })
})

describe('Toutiao submission receipt plus management evidence', () => {
  it.each([
    'accepted',
    'rejected',
    'duplicate',
    'wrong-endpoint',
    'unarmed',
    'unmatched-card',
  ] as const)(
    'requires a single armed platform response and matching actual card: %s',
    async (mode) => {
      vi.useFakeTimers()
      const page = Object.assign(new EventEmitter(), { waitForURL: vi.fn(async () => undefined) })
      const expected = { uid: '12345', title: 'Article', images: ['image-a'] }
      vi.mocked(readToutiaoPublicationReview).mockResolvedValue({
        current: true,
        candidates:
          mode === 'unmatched-card'
            ? []
            : [{ status: '审核中', images: [], urls: [], region: 'card', titleSelector: 'p' }],
        diagnostics: [],
      })
      const observer = observeToutiaoSubmission(page as never, expected)
      const request = () => ({
        method: () => 'POST',
        url: () =>
          `https://mp.toutiao.com/mp/agw/${mode === 'wrong-endpoint' ? 'draft/save' : 'article/wtt'}`,
        resourceType: () => 'fetch',
        postData: () => '{"content":"private"}',
      })
      const r = request()
      if (mode !== 'unarmed') observer.arm()
      page.emit('request', r)
      if (mode === 'duplicate') page.emit('request', request())
      page.emit('response', {
        request: () => r,
        url: r.url,
        status: () => 200,
        text: async () => JSON.stringify({ code: mode === 'rejected' ? 1 : 0 }),
      })
      const result = observer.finish().then(
        (value) => ({ value, error: '' }),
        (error) => ({ value: undefined, error: String(error) }),
      )
      await vi.advanceTimersByTimeAsync(15_000)
      const settled = await result
      expect(Boolean(settled.value)).toBe(mode === 'accepted')
      if (mode === 'accepted') {
        expect(settled.value).toEqual({ status: '审核中' })
        expect(readToutiaoPublicationReview).toHaveBeenLastCalledWith(page, expected)
      }
      observer.dispose()
      expect(page.listenerCount('request')).toBe(0)
      expect(page.listenerCount('response')).toBe(0)
      vi.useRealTimers()
    },
  )
})
