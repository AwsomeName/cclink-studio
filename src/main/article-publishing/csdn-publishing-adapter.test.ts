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
})
