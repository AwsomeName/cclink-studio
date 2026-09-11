import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  matchesXiaohongshuSubmission,
  xiaohongshuSubmittedId,
  observeXiaohongshuSubmission,
} from './xiaohongshu-submission'
const target = {
  title: '原文',
  description: '正文\n原样',
  fileIds: ['spectrum/first', 'spectrum/second'],
}
const request = () => ({
  common: { type: 'normal', note_id: '', title: target.title, desc: target.description },
  image_info: { images: target.fileIds.map((file_id) => ({ file_id })) },
})
describe('小红书单次发布回执绑定', () => {
  it('matches the actual original text and ordered image request, never just the title', () => {
    expect(matchesXiaohongshuSubmission(request(), target)).toBe(true)
    const changed = request()
    changed.common.desc = '其他正文'
    expect(matchesXiaohongshuSubmission(changed, target)).toBe(false)
    const reversed = request()
    reversed.image_info.images.reverse()
    expect(matchesXiaohongshuSubmission(reversed, target)).toBe(false)
    const update = request()
    update.common.note_id = 'already-published'
    expect(matchesXiaohongshuSubmission(update, target)).toBe(false)
    expect(matchesXiaohongshuSubmission({}, target)).toBe(false)
  })
  it('requires a successful response and an exact returned note ID', () => {
    const id = '6a8ed725000000002102ea10'
    expect(xiaohongshuSubmittedId({ code: 0, data: { id } })).toBe(id)
    expect(xiaohongshuSubmittedId({ success: true, data: { note_id: id } })).toBe(id)
    for (const value of [
      { code: -1, data: { id } },
      { id },
      { code: 0, data: { id: 'wrong' } },
      { code: 0, data: {} },
    ])
      expect(xiaohongshuSubmittedId(value)).toBeNull()
  })
})

it('binds only the armed matching request and its own response, then detaches listeners', async () => {
  const page = new EventEmitter()
  const observer = observeXiaohongshuSubmission(page as never, target)
  const req = () => ({
    method: () => 'POST',
    url: () => 'https://edith.xiaohongshu.com/web_api/sns/v2/note',
    postDataJSON: () => request(),
  })
  const earlier = req(),
    actual = req()
  page.emit('request', earlier)
  observer.arm()
  page.emit('request', actual)
  page.emit('response', {
    request: () => earlier,
    ok: () => true,
    json: async () => ({ code: 0, data: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } }),
  })
  page.emit('response', {
    request: () => actual,
    ok: () => true,
    json: async () => ({ code: 0, data: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb' } }),
  })
  expect(await observer.finish()).toBe('bbbbbbbbbbbbbbbbbbbbbbbb')
  observer.dispose()
  expect(page.listenerCount('request')).toBe(0)
  expect(page.listenerCount('response')).toBe(0)
})
