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
  it.each(['disposed', 'close', 'crash', 'expired'] as const)(
    'ends pending receipt waits and cannot rearm after %s',
    async (mode) => {
      vi.useFakeTimers()
      const page = new EventEmitter()
      const observer = observeBilibiliSubmission(page as never, {
        uid: '3546384070347419',
        text: '冻结正文',
        images: [img],
      })
      try {
        const rejected = expect(observer.finish()).rejects.toThrow()
        if (mode === 'expired') await vi.advanceTimersByTimeAsync(30000)
        else {
          observer.arm()
          expect(() => observer.arm()).toThrow('不可重新启用')
          if (mode === 'disposed') await observer.dispose()
          else page.emit(mode)
        }
        await rejected
        expect(observer.canConfirm()).toBe(false)
        expect(() => observer.arm()).toThrow()
      } finally {
        await observer.dispose()
        vi.useRealTimers()
      }
      for (const name of ['request', 'response', 'requestfailed', 'close', 'crash'])
        expect(page.listenerCount(name)).toBe(0)
    },
  )

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
      status: () => 200,
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

  it.each([
    'text-mismatch',
    'invalid-body',
    'platform-error',
    'transport-failed',
    'multiple-requests',
  ] as const)('preserves bounded diagnostics and never claims success after %s', async (mode) => {
    const page = new EventEmitter()
    const facts: unknown[] = []
    const observer = observeBilibiliSubmission(
      page as never,
      {
        uid: '3546384070347419',
        text: '冻结正文',
        images: [img],
      },
      async (fact) => {
        facts.push(fact)
      },
    )
    const request = {
      method: () => 'POST',
      url: () => 'https://api.bilibili.com/x/dynamic/feed/create/dyn',
      postDataJSON: () =>
        mode === 'invalid-body'
          ? { secret: 'do-not-persist' }
          : {
              dyn_req: {
                content: {
                  contents: [{ raw_text: mode === 'text-mismatch' ? '其他稿' : '冻结正文' }],
                },
                pics: [{ img_src: img }],
              },
            },
    }
    observer.arm()
    const pending = expect(observer.finish()).rejects.toThrow(
      mode === 'platform-error'
        ? '平台错误码 -101'
        : mode === 'transport-failed'
          ? '网络失败'
          : mode === 'multiple-requests'
            ? '多个提交请求'
            : '不匹配',
    )
    page.emit('request', request)
    expect(observer.canConfirm()).toBe(false)
    if (mode === 'transport-failed') page.emit('requestfailed', request)
    else if (mode === 'multiple-requests') page.emit('request', { ...request })
    else
      page.emit('response', {
        request: () => request,
        status: () => 200,
        json: async () => ({
          code: mode === 'platform-error' ? -101 : 0,
          data: { dyn_id_str: '1246694229973925912' },
          secret: 'do-not-persist',
        }),
      })
    await pending
    await observer.dispose()
    expect(facts.at(-1)).toMatchObject({
      requestObserved: true,
      observationEnded: true,
      requestMatch: mode === 'platform-error' || mode === 'transport-failed' ? 'matched' : mode,
    })
    if (mode === 'transport-failed') expect(facts.at(-1)).toMatchObject({ transportFailed: true })
    else if (mode !== 'multiple-requests')
      expect(facts.at(-1)).toMatchObject({
        responseStatus: 200,
        platformCode: mode === 'platform-error' ? -101 : 0,
      })
    expect(JSON.stringify(facts)).not.toContain('do-not-persist')
    expect(page.listenerCount('requestfailed')).toBe(0)
  })
})

describe('B站 first publication agreement continuation', () => {
  it.each(['cancelled', 'storage-failed'] as const)(
    'does not click if %s while persisting the confirmation attempt',
    async (mode) => {
      vi.useFakeTimers()
      let current = true
      const facts: unknown[] = []
      const click = vi.fn()
      const page = Object.assign(new EventEmitter(), {
        url: () => 'https://t.bilibili.com/',
        frameLocator: () => ({ getByRole: () => ({ waitFor: async () => undefined }) }),
        getByRole: () => ({ waitFor: async () => undefined, click }),
        evaluate: async () => 'recognized',
      })
      const observer = observeBilibiliSubmission(
        page as never,
        {
          uid: '3546384070347419',
          text: '冻结正文',
          images: [img],
        },
        async (observation) => {
          facts.push(observation)
          if (observation.confirmationAttempted) {
            if (mode === 'storage-failed') throw new Error('disk failed')
            current = false
          }
        },
      )
      observer.arm()
      try {
        const result = finishBilibiliSubmission(page as never, observer, {
          isCurrent: () => current,
          revalidate: async () => undefined,
          record: async () => undefined,
        })
        const rejected = expect(result).rejects.toThrow(
          mode === 'storage-failed' ? 'disk failed' : 'Runtime',
        )
        await vi.advanceTimersByTimeAsync(30000)
        await rejected
        expect(click).not.toHaveBeenCalled()
        expect(facts).toContainEqual({
          confirmationAttempted: true,
          requestObserved: false,
          observationEnded: false,
        })
      } finally {
        await observer.dispose().catch(() => undefined)
        vi.useRealTimers()
      }
    },
  )

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
      frameLocator: () => ({ getByRole: () => ({ waitFor: async () => undefined }) }),
      getByRole: () => ({
        waitFor: () => (mode === 'direct' ? new Promise<void>(() => {}) : Promise.resolve()),
        click,
      }),
      url: () => (mode === 'navigated' ? url : 'https://t.bilibili.com/'),
      evaluate: vi.fn(async () => (mode === 'unrecognized' ? '规范文档不可读' : 'recognized')),
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
      markConfirmationAttempted: vi.fn(async () => undefined),
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
        frameLocator: () => ({ getByRole: () => ({ waitFor: async () => undefined }) }),
        url: () => 'https://t.bilibili.com/',
        evaluate: vi.fn(async () => 'recognized'),
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
