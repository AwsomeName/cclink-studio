import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { observeCsdnInitialDraftSave } from './csdn-initial-draft-save'

function fixture() {
  const frame = {}
  const page = Object.assign(new EventEmitter(), { mainFrame: () => frame })
  const request = (patch: Record<string, unknown> = {}) => ({
    url: () => 'https://bizapi.csdn.net/blog-console-api/v1/postedit/saveArticle',
    frame: () => frame,
    method: () => 'POST',
    postDataJSON: () => ({ status: 2, article_id: '', title: 'Article', content: '', ...patch }),
  })
  const response = (req: unknown, id = '164148900') => ({
    request: () => req,
    ok: () => true,
    json: async () => ({ code: 200, data: { article_id: id } }),
  })
  return {
    page,
    request,
    response,
    observer: observeCsdnInitialDraftSave(page as never, 'Article'),
  }
}

describe('CSDN first save response identity', () => {
  it('ignores pre-dispatch and foreign requests, captures the exact response, then removes listeners', async () => {
    const { page, request, response, observer } = fixture()
    page.emit('request', request())
    observer.arm()
    const own = request()
    page.emit('request', { ...request(), frame: () => ({}) })
    page.emit('request', own)
    page.emit('response', response(request(), '999'))
    page.emit('response', response(own))
    expect(await observer.result).toEqual({ draftId: '164148900' })
    observer.dispose()
    expect(page.eventNames()).toEqual([])
  })

  it.each([
    { status: 0 },
    { article_id: 'old-draft' },
    { title: 'Other' },
    { content: 'x'.repeat(100) },
  ])('does not claim a response outside the initial draft authorization: %j', async (patch) => {
    const { page, request, response, observer } = fixture()
    observer.arm()
    const req = request(patch)
    page.emit('request', req)
    page.emit('response', response(req))
    expect(await observer.result).toMatchObject({ error: expect.any(String) })
    observer.dispose()
  })

  it('keeps a disconnected or duplicate initial save unknown instead of inventing an ID', async () => {
    for (const event of ['requestfailed', 'request']) {
      const { page, request, observer } = fixture()
      observer.arm()
      const req = request()
      page.emit('request', req)
      page.emit(event, req)
      expect(await observer.result).toMatchObject({ error: expect.any(String) })
      observer.dispose()
    }
  })

  it('times out without authorizing a retry', async () => {
    vi.useFakeTimers()
    const { observer } = fixture()
    try {
      observer.arm()
      await vi.advanceTimersByTimeAsync(15_000)
      expect(await observer.result).toMatchObject({
        error: expect.stringContaining('禁止再次创建'),
      })
    } finally {
      observer.dispose()
      vi.useRealTimers()
    }
  })
})
