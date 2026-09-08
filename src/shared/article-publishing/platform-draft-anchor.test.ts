import { describe, expect, it } from 'vitest'
import {
  isSamePlatformDraft,
  parsePlatformDraftAnchor,
  isPlatformImageUrl,
} from './platform-draft-anchor'
import { articlePublishingDetailDefinitions } from './article-publishing-plan'

describe('platform draft identity', () => {
  it('keeps the exact Zhihu draft ID without converting a 19 digit ID to a number', () => {
    expect(
      parsePlatformDraftAnchor('https://zhuanlan.zhihu.com/p/2080754524944339658/edit?source=test'),
    ).toEqual({
      adapterId: 'zhihu',
      draftId: '2080754524944339658',
      url: 'https://zhuanlan.zhihu.com/p/2080754524944339658/edit',
    })
  })
  it('never treats a public article, new editor, credential URL or foreign origin as a draft', () => {
    for (const url of [
      'https://zhuanlan.zhihu.com/write',
      'https://zhuanlan.zhihu.com/p/123',
      'https://zhuanlan.zhihu.com.evil.test/p/123/edit',
      'https://user@zhuanlan.zhihu.com/p/123/edit',
    ])
      expect(parsePlatformDraftAnchor(url)).toBeNull()
  })
  it('does not confuse equal numeric IDs on different platforms', () => {
    expect(
      isSamePlatformDraft(
        'https://mp.csdn.net/mp_blog/creation/editor/123',
        'https://zhuanlan.zhihu.com/p/123/edit',
      ),
    ).toBe(false)
    expect(
      isSamePlatformDraft(
        'https://zhuanlan.zhihu.com/p/123/edit',
        'https://zhuanlan.zhihu.com/p/123/edit?from=creator',
      ),
    ).toBe(true)
  })
  it('shows recovery before launch when an existing draft was selected', () => {
    const rows = articlePublishingDetailDefinitions({
      adapterId: 'zhihu',
      assets: [],
      fields: { title: 't', summary: '', tags: [], category: '' },
      draft: { platformDraftId: '123' },
    })
    expect(rows.some((r) => r.id === 'recovery.locate')).toBe(true)
    expect(rows.some((r) => r.id === 'initial.anchor')).toBe(false)
    expect(rows.some((r) => r.id === 'field.summary.dispatch')).toBe(false)
  })
})

it('accepts only each platform image hosts at the upload observation boundary', () => {
  expect(isPlatformImageUrl('zhihu', 'https://pic-private.zhihu.com/v2-image.png')).toBe(true)
  expect(isPlatformImageUrl('zhihu', 'https://picx.zhimg.com/v2-image.png')).toBe(true)
  for (const url of [
    'https://pic-private.zhihu.com.evil.test/a.png',
    'https://evil.test/a.png',
    'http://picx.zhimg.com/a.png',
    'https://user@picx.zhimg.com/a.png',
    'https://picx.zhimg.com:444/a.png',
  ])
    expect(isPlatformImageUrl('zhihu', url)).toBe(false)
  expect(isPlatformImageUrl('csdn', 'https://picx.zhimg.com/a.png')).toBe(false)
  expect(isPlatformImageUrl('csdn', 'https://i-blog.csdnimg.cn/a.png')).toBe(true)
})
