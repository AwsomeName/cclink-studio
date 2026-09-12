import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { observeBilibiliImageUpload, bilibiliUploadReceiptFailure } from './bilibili-upload-receipt'

describe('B站 native single-file upload receipt', () => {
  it('explains a rejected receipt without exposing response secrets', () => {
    const value = {
      code: 0,
      data: {
        image_url: 'http://i0.hdslb.com/bfs/new_dyn/cover.png',
        image_width: 1086,
        image_height: 1448,
      },
      token: 'private',
    }
    expect(bilibiliUploadReceiptFailure(value)).toContain(
      'http://i0.hdslb.com/bfs/new_dyn/cover.png',
    )
    expect(bilibiliUploadReceiptFailure(value)).toContain('1086×1448')
    const unsafe = bilibiliUploadReceiptFailure({
      ...value,
      data: { ...value.data, image_url: 'https://i0.hdslb.com/bfs/new_dyn/cover.png?token=secret' },
    })
    expect(unsafe).not.toContain('secret')
    expect(unsafe).not.toContain('private')
  })
  it.each([
    'exact',
    'unarmed',
    'other-origin',
    'other-path',
    'other-response',
    'platform-error',
    'missing-size',
    'unsafe-url',
    'duplicate',
  ] as const)('%s', async (mode) => {
    vi.useFakeTimers()
    const page = new EventEmitter()
    const observer = observeBilibiliImageUpload(page as never)
    const url = 'https://i0.hdslb.com/bfs/new_dyn/original.png'
    const request = {
      method: () => 'POST',
      url: () =>
        mode === 'other-origin'
          ? 'https://evil.test/x/dynamic/feed/draw/upload_bfs'
          : mode === 'other-path'
            ? 'https://api.bilibili.com/other'
            : 'https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs',
    }
    const check =
      mode === 'exact'
        ? expect(observer.finish()).resolves.toBe(url)
        : expect(observer.finish()).rejects.toThrow()
    if (mode !== 'unarmed') observer.arm()
    page.emit('request', request)
    if (mode === 'duplicate') page.emit('request', { ...request })
    page.emit('response', {
      request: () => (mode === 'other-response' ? {} : request),
      json: async () => ({
        code: mode === 'platform-error' ? -1 : 0,
        data: {
          image_url:
            mode === 'unsafe-url' ? 'https://evil.test/image.png' : url.replace('https:', 'http:'),
          image_width: mode === 'missing-size' ? 0 : 1086,
          image_height: 1448,
        },
      }),
    })
    await vi.advanceTimersByTimeAsync(30000)
    await check
    if (mode === 'exact') {
      observer.assertUnique()
      page.emit('request', { ...request })
      expect(() => observer.assertUnique()).toThrow()
    }
    observer.dispose()
    expect(page.listenerCount('request') + page.listenerCount('response')).toBe(0)
    vi.useRealTimers()
  })
})
