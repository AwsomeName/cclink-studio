import { describe, expect, it, vi } from 'vitest'
import { CsdnPublishingAdapter } from './csdn-publishing-adapter'

describe('CsdnPublishingAdapter recovery evidence', () => {
  it('extracts exact draft identities from a supported management page', async () => {
    const adapter = new CsdnPublishingAdapter()
    const page = {
      evaluate: vi.fn(async () => ({
        url: 'https://mp.csdn.net/mp_blog/manage/article',
        draftSectionUrl: 'https://mp.csdn.net/mp_blog/manage/article?type=draft',
        platformAccountCandidates: ['csdn:test-user'],
        links: [
          {
            url: 'https://editor.csdn.net/md/?articleId=164148817&from=drafts',
            title: 'Article',
          },
        ],
      })),
    }

    const result = await adapter.probeDraftList(page as never)

    expect(result).toMatchObject({
      pageSupported: true,
      draftSectionUrl: 'https://mp.csdn.net/mp_blog/manage/article?type=draft',
      candidates: [
        {
          draftId: '164148817',
          url: 'https://editor.csdn.net/md/?articleId=164148817&from=drafts',
          title: 'Article',
        },
      ],
    })
    expect(result.platformAccountId).toBe('csdn:test-user')
  })

  it('does not follow a draft-section link outside the supported CSDN management surface', async () => {
    const adapter = new CsdnPublishingAdapter()
    const page = {
      evaluate: vi.fn(async () => ({
        url: 'https://mp.csdn.net/mp_blog/manage/article',
        draftSectionUrl: 'javascript:alert(1)',
        platformAccountCandidates: [],
        links: [],
      })),
    }

    await expect(adapter.probeDraftList(page as never)).resolves.not.toHaveProperty(
      'draftSectionUrl',
    )
  })

  it('marks image absence comparison incomplete when a platform image cannot be downloaded', async () => {
    const adapter = new CsdnPublishingAdapter()
    const get = vi.fn(async () => {
      throw new Error('network failed')
    })
    const page = { context: () => ({ request: { get } }) }
    const result = await adapter.matchAssetsByContentHash(
      page as never,
      {
        editor: {
          recognized: true,
          bodyTextLength: 10,
          imageEnumerationComplete: true,
          images: [{ src: 'https://img-blog.csdnimg.cn/transformed.png', alt: '' }],
        },
      } as never,
      ['b'.repeat(64)],
    )

    expect(result).toEqual({
      matches: {},
      matchedPlatformHashes: {},
      platformHashesByUrl: {},
      comparisonComplete: false,
    })
  })
})
