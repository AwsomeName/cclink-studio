import { describe, expect, it } from 'vitest'
import {
  isSamePlatformDraft,
  parsePlatformDraftAnchor,
  isPlatformImageUrl,
} from './platform-draft-anchor'
import { articlePublishingDetailDefinitions } from './article-publishing-plan'

describe('platform draft identity', () => {
  it('keeps an exact Toutiao micro-post draft and rejects ambiguous or foreign addresses', () => {
    const url = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=1876018407641100'
    expect(parsePlatformDraftAnchor(url)).toEqual({
      adapterId: 'toutiao',
      draftId: '1876018407641100',
      url,
    })
    for (const other of [
      url + '&draft_id=2',
      url.replace('mp.toutiao.com', 'mp.toutiao.com.evil.test'),
      url.replace('https://', 'https://user@'),
      url.replace('1876018407641100', 'new'),
      url.split('?')[0],
    ])
      expect(parsePlatformDraftAnchor(other)).toBeNull()
    expect(isSamePlatformDraft(url, 'https://zhuanlan.zhihu.com/p/1876018407641100/edit')).toBe(
      false,
    )
  })
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

it('keeps Juejin draft IDs exact and isolates its image hosts', () => {
  const id = '7683025447916847150'
  expect(parsePlatformDraftAnchor(`https://juejin.cn/editor/drafts/${id}`)).toEqual({
    adapterId: 'juejin',
    draftId: id,
    url: `https://juejin.cn/editor/drafts/${id}`,
  })
  for (const url of [
    `https://juejin.cn/editor/drafts/new`,
    `https://juejin.cn/post/${id}`,
    `https://juejin.cn.evil.test/editor/drafts/${id}`,
    `https://user@juejin.cn/editor/drafts/${id}`,
  ])
    expect(parsePlatformDraftAnchor(url)).toBeNull()
  expect(
    isPlatformImageUrl('juejin', 'https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/image.png'),
  ).toBe(true)
  expect(isPlatformImageUrl('juejin', 'https://p3-juejin.byteimg.com.evil.test/image.png')).toBe(
    false,
  )
  expect(isPlatformImageUrl('juejin', 'https://picx.zhimg.com/a.png')).toBe(false)
})

it('requires an explicit local XHS draft ID, never treats the shared editor URL as identity', () => {
  const url = 'https://creator.xiaohongshu.com/publish/publish?target=image'
  const id = '071c3c48-ca3e-49c3-bb52-a43c1a73def8'
  expect(parsePlatformDraftAnchor(url)).toBeNull()
  expect(parsePlatformDraftAnchor(url, id)).toEqual({ adapterId: 'xiaohongshu', draftId: id, url })
  for (const other of [
    'https://creator.xiaohongshu.com.evil.test/publish/publish',
    'https://user@creator.xiaohongshu.com/publish/publish',
    'https://creator.xiaohongshu.com/new/home',
  ])
    expect(parsePlatformDraftAnchor(other, id)).toBeNull()
  expect(parsePlatformDraftAnchor(url, '------------------------------------')).toBeNull()
  expect(
    isPlatformImageUrl('xiaohongshu', 'https://sns-creator-preview.xhscdn.com/spectrum/image'),
  ).toBe(true)
  expect(
    isPlatformImageUrl(
      'xiaohongshu',
      'https://sns-creator-preview.xhscdn.com.evil.test/spectrum/image',
    ),
  ).toBe(false)
})
