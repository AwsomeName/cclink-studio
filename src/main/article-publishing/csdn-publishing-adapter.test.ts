import { describe, expect, it, vi } from 'vitest'
import {
  CSDN_ACCOUNT_EVIDENCE_REGION_SELECTOR,
  CSDN_SAVE_STATUS_SELECTOR,
  CsdnPublishingAdapter,
  classifyCsdnSaveStatus,
  resolveCsdnPlatformAccountId,
} from './csdn-publishing-adapter'

describe('CsdnPublishingAdapter recovery evidence', () => {
  it('does not treat article-body profile links or saved-looking prose as account/save evidence', () => {
    expect(CSDN_ACCOUNT_EVIDENCE_REGION_SELECTOR).not.toMatch(/body|article|main/iu)
    expect(CSDN_SAVE_STATUS_SELECTOR).not.toMatch(/body|article|main/iu)
    expect(
      resolveCsdnPlatformAccountId('https://mp.csdn.net/mp_blog/creation/editor/164148817', []),
    ).toBeUndefined()
    expect(classifyCsdnSaveStatus([])).toEqual({ state: 'unknown' })
  })

  it('prefers an active saving signal over a stale saved signal in bounded status controls', () => {
    expect(classifyCsdnSaveStatus(['草稿已保存 18:20', '正在保存...'])).toEqual({
      state: 'saving',
      evidence: '正在保存',
    })
  })

  it('rejects ambiguous account evidence from the bounded account chrome', () => {
    expect(
      resolveCsdnPlatformAccountId('https://mp.csdn.net/mp_blog/manage/article', [
        'https://blog.csdn.net/right-user',
        'https://blog.csdn.net/wrong-user',
      ]),
    ).toBeUndefined()
  })

  it('extracts exact draft identities from a supported management page', async () => {
    const adapter = new CsdnPublishingAdapter()
    const page = {
      evaluate: vi.fn(async () => ({
        url: 'https://mp.csdn.net/mp_blog/manage/article',
        draftSectionUrl: 'https://mp.csdn.net/mp_blog/manage/article?type=draft',
        accountHrefCandidates: ['https://blog.csdn.net/test-user'],
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
        accountHrefCandidates: [],
        links: [],
      })),
    }

    await expect(adapter.probeDraftList(page as never)).resolves.not.toHaveProperty(
      'draftSectionUrl',
    )
  })
})
