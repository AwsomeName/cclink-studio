import { EventEmitter } from 'node:events'
import type { Page, Request, Response } from 'playwright-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  observeWeiboSubmission,
  parseWeiboPublicationUrl,
  weiboImageIdentity,
} from './weibo-publication'

const target = { uid: '5961101548', text: 'Frozen article\n正文', imageIds: ['imageA', 'imageB'] }
function fixture() {
  const events = new EventEmitter()
  const observer = observeWeiboSubmission(events as unknown as Page, target)
  const request = (data: unknown = { status: target.text, pic_ids: target.imageIds }) =>
    ({
      method: () => 'POST',
      url: () => 'https://weibo.com/ajax/statuses/update',
      postData: () => JSON.stringify(data),
    }) as Request
  const response = (req: Request, overrides: object = {}) =>
    ({
      request: () => req,
      json: async () => ({
        ok: 1,
        data: {
          user: { idstr: target.uid },
          mblogid: 'RhAKon2wi',
          pic_ids: target.imageIds,
          ...overrides,
        },
      }),
    }) as Response
  return { events, observer, request, response }
}
afterEach(() => vi.useRealTimers())
describe('Weibo bound submission receipt', () => {
  it('accepts only an armed matching request, preserving the platform post ID', async () => {
    const f = fixture()
    f.observer.arm()
    const req = f.request()
    f.events.emit('request', req)
    f.events.emit('response', f.response(req))
    await expect(f.observer.finish()).resolves.toEqual({
      uid: target.uid,
      id: 'RhAKon2wi',
      url: 'https://weibo.com/5961101548/RhAKon2wi',
    })
    f.observer.dispose()
    expect(f.events.listenerCount('request')).toBe(0)
    expect(f.events.listenerCount('response')).toBe(0)
  })
  it.each(['unarmed', 'wrong-text', 'wrong-images', 'unrelated-response'] as const)(
    'never attributes %s traffic',
    async (scenario) => {
      vi.useFakeTimers()
      const f = fixture()
      if (scenario !== 'unarmed') f.observer.arm()
      const req = f.request({
        status: scenario === 'wrong-text' ? 'other' : target.text,
        pic_ids: scenario === 'wrong-images' ? ['other'] : target.imageIds,
      })
      f.events.emit('request', req)
      f.events.emit('response', f.response(scenario === 'unrelated-response' ? f.request() : req))
      const check = expect(f.observer.finish()).rejects.toThrow('禁止再次发送')
      await vi.advanceTimersByTimeAsync(30_000)
      await check
      f.observer.dispose()
    },
  )
  it.each([
    { user: { idstr: '1234567890' } },
    { pic_ids: ['imageB', 'imageA'] },
    { mblogid: '../../other' },
  ])('rejects a receipt with mismatched identity %j', async (fields) => {
    const f = fixture()
    f.observer.arm()
    const req = f.request()
    f.events.emit('request', req)
    f.events.emit('response', f.response(req, fields))
    await expect(f.observer.finish()).rejects.toThrow('只核验，不重发')
    f.observer.dispose()
  })
  it('does not accept two matching dispatches as one result', async () => {
    const f = fixture()
    f.observer.arm()
    f.events.emit('request', f.request())
    f.events.emit('request', f.request())
    await expect(f.observer.finish()).rejects.toThrow('多个同稿提交')
    f.observer.dispose()
  })
  it('rejects lookalike origins and keeps platform image identity across sizes', () => {
    expect(parseWeiboPublicationUrl('https://weibo.com.evil/5961101548/RhAKon2wi')).toBeNull()
    expect(parseWeiboPublicationUrl('https://x@weibo.com/5961101548/RhAKon2wi')).toBeNull()
    expect(weiboImageIdentity('https://wx1.sinaimg.cn/bmiddle/imageA.jpg')).toBe('imageA')
    expect(weiboImageIdentity('https://wx2.sinaimg.cn/large/imageA.jpg')).toBe('imageA')
    expect(weiboImageIdentity('https://wx1.sinaimg.cn.evil/large/imageA.jpg')).toBeNull()
  })
})
