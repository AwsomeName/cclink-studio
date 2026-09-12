import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  bilibiliImageUrl,
  finishBilibiliSubmission,
  observeBilibiliSubmission,
  parseBilibiliPublicationUrl,
} from './bilibili-publication'
const url = 'https://t.bilibili.com/1246694229973925912'
const img = 'https://i0.hdslb.com/bfs/new_dyn/example.png'
describe('B站 single native submission evidence', () => {
  it('keeps platform IDs as strings and rejects unrelated origins and secret URLs', () => {
    expect(parseBilibiliPublicationUrl(`${url}?spm_id_from=native`)).toEqual({
      id: '1246694229973925912',
      url,
    })
    for (const bad of [
      url.replace('t.bilibili.com', 'evil.test'),
      `${url}?token=secret`,
      url.replace('https:', 'http:'),
      'https://t.bilibili.com/',
      url.replace('t.bilibili.com', 'user@t.bilibili.com'),
    ])
      expect(parseBilibiliPublicationUrl(bad)).toBeNull()
    expect(bilibiliImageUrl(`${img}@402w_536h_1c_1s.webp`)).toBe(img)
    expect(bilibiliImageUrl(img.replace('https:', 'http:'))).toBe(img)
    expect(bilibiliImageUrl('http://evil.test/bfs/new_dyn/example.png')).toBeNull()
    expect(bilibiliImageUrl('http://i0.hdslb.com:8080/bfs/new_dyn/example.png')).toBeNull()
    for (const bad of [
      img.replace('i0.hdslb.com', 'evil.test'),
      `${img}?token=x`,
      'blob:preview',
      img.replace('/new_dyn/', '/face/'),
    ])
      expect(bilibiliImageUrl(bad)).toBeNull()
  })
  it.each([
    'exact',
    'wrong-text',
    'wrong-image',
    'unarmed',
    'wrong-origin',
    'wrong-endpoint',
    'other-response',
    'numeric-id',
    'platform-error',
  ] as const)('does not invent a receipt: %s', async (mode) => {
    vi.useFakeTimers()
    const page = new EventEmitter()
    const observer = observeBilibiliSubmission(page as never, {
      uid: '3546384070347419',
      text: '冻结正文',
      images: [img],
    })
    const request = {
      method: () => 'POST',
      url: () =>
        mode === 'wrong-origin'
          ? 'https://evil.test/submit'
          : mode === 'wrong-endpoint'
            ? 'https://api.bilibili.com/other'
            : 'https://api.bilibili.com/x/dynamic/feed/create/dyn',
      postDataJSON: () => ({
        dyn_req: {
          content: { contents: [{ raw_text: mode === 'wrong-text' ? '其他正文' : '冻结正文' }] },
          pics: [{ img_src: mode === 'wrong-image' ? img.replace('example', 'other') : img }],
        },
      }),
    }
    const pending = observer.finish()
    const checked =
      mode === 'exact'
        ? expect(pending).resolves.toEqual({
            uid: '3546384070347419',
            id: '1246694229973925912',
            url,
          })
        : expect(pending).rejects.toThrow()
    if (mode !== 'unarmed') observer.arm()
    page.emit('request', request)
    page.emit('response', {
      request: () => (mode === 'other-response' ? {} : request),
      json: async () => ({
        code: mode === 'platform-error' ? -1 : 0,
        data: { dyn_id_str: mode === 'numeric-id' ? 1246694229973925900 : '1246694229973925912' },
      }),
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await checked
    observer.dispose()
    expect(page.listenerCount('request') + page.listenerCount('response')).toBe(0)
    vi.useRealTimers()
  })
})

describe('B站 first publication agreement continuation', () => {
  it.each([
    'terms',
    'direct',
    'cancelled',
    'navigated',
    'changed-body',
    'unrecognized',
    'already-requested',
    'cancel-during-recheck',
    'request-during-recheck',
    'accepted-click-error',
    'cancel-after-accepted',
  ] as const)('only confirms the same live unsubmitted operation: %s', async (mode) => {
    const receipt = { uid: '3546384070347419', id: '1246694229973925912', url }
    let resolve!: (value: typeof receipt) => void
    const pending = new Promise<typeof receipt>((yes) => {
      resolve = yes
    })
    let active = mode !== 'cancelled'
    let requestSeen = mode === 'already-requested'
    const click = vi.fn(async () => {
      requestSeen = true
      resolve(receipt)
      if (mode === 'accepted-click-error') throw new Error('click disconnected after submit')
      if (mode === 'cancel-after-accepted') active = false
    })
    const page = {
      getByRole: () => ({
        waitFor: () => (mode === 'direct' ? new Promise<void>(() => {}) : Promise.resolve()),
        click,
      }),
      url: () => (mode === 'navigated' ? url : 'https://t.bilibili.com/'),
      evaluate: vi.fn(async () => mode !== 'unrecognized'),
    }
    const record = vi.fn(async (_result: unknown) => {
      if (mode === 'cancel-after-accepted' && !active) throw new Error('cancelled owner write')
    })
    const revalidate = vi.fn(async () => {
      if (mode === 'changed-body') throw new Error('body mismatch')
      if (mode === 'cancel-during-recheck') active = false
      if (mode === 'request-during-recheck') requestSeen = true
    })
    const observer = {
      finish: () => pending,
      hasSubmissionRequest: () => requestSeen,
      canConfirm: () => !requestSeen,
      arm: vi.fn(),
      dispose: vi.fn(),
    }
    if (mode === 'direct') resolve(receipt)
    const result = finishBilibiliSubmission(page as never, observer, {
      isCurrent: () => active,
      revalidate,
      record,
    })
    if (['terms', 'direct', 'accepted-click-error', 'cancel-after-accepted'].includes(mode)) {
      await expect(result).resolves.toEqual(receipt)
      expect(click).toHaveBeenCalledTimes(mode === 'direct' ? 0 : 1)
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'bilibili.submission.receipt',
          status: 'completed',
        }),
      )
      if (mode !== 'accepted-click-error')
        expect(record).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'bilibili.agreement.confirm',
            status: mode === 'direct' ? 'skipped' : 'completed',
          }),
        )
    } else {
      await expect(result).rejects.toThrow()
      expect(click).not.toHaveBeenCalled()
    }
  })

  it.each(['timeout', 'disposed'] as const)(
    'does not send when the original observer becomes %s during revalidation',
    async (mode) => {
      vi.useFakeTimers()
      const page = Object.assign(new EventEmitter(), {
        url: () => 'https://t.bilibili.com/',
        evaluate: vi.fn(async () => true),
        getByRole: () => ({ waitFor: async () => undefined, click }),
      })
      const click = vi.fn()
      const observer = observeBilibiliSubmission(page as never, {
        uid: '3546384070347419',
        text: '冻结正文',
        images: [img],
      })
      observer.arm()
      try {
        expect(observer.canConfirm()).toBe(true)
        const result = finishBilibiliSubmission(page as never, observer, {
          isCurrent: () => true,
          record: async () => undefined,
          revalidate: async () => {
            if (mode === 'timeout') await vi.advanceTimersByTimeAsync(30_000)
            else observer.dispose()
          },
        })
        await expect(result).rejects.toThrow('回执观察已失效')
        expect(observer.canConfirm()).toBe(false)
        expect(click).not.toHaveBeenCalled()
      } finally {
        observer.dispose()
        vi.useRealTimers()
      }
    },
  )
})
