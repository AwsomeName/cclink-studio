import { describe, expect, it, vi } from 'vitest'
import { CsdnDraftRecoveryCoordinator } from './csdn-draft-recovery-coordinator'
import { CSDN_ARTICLE_MANAGEMENT_URL } from './csdn-publishing-adapter'

const DRAFT_ID = '164148817'
const DRAFT_URL = `https://mp.csdn.net/mp_blog/creation/editor/${DRAFT_ID}`
const DRAFT_LIST_URL = 'https://mp.csdn.net/mp_blog/manage/article?type=draft'
const ACCOUNT = 'csdn:test-user'

describe('CsdnDraftRecoveryCoordinator', () => {
  it('从草稿箱按原 draftId 找回同账号、同标题且已保存的草稿', async () => {
    const adapter = {
      probeDraftList: vi
        .fn()
        .mockResolvedValueOnce(listProbe([], DRAFT_LIST_URL))
        .mockResolvedValueOnce(
          listProbe([{ draftId: DRAFT_ID, url: DRAFT_URL, title: 'Article' }]),
        ),
      probe: vi.fn(async () => editorProbe()),
    }
    const navigate = vi.fn(async (url: string) => pageAt(url))
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)

    const result = await coordinator.recoverExactDraft({
      expectedDraftId: DRAFT_ID,
      expectedPlatformAccountId: ACCOUNT,
      expectedTitle: 'Article',
      navigate: navigate as never,
    })

    expect(navigate.mock.calls.map(([url]) => url)).toEqual([
      CSDN_ARTICLE_MANAGEMENT_URL,
      DRAFT_LIST_URL,
      DRAFT_URL,
    ])
    expect(result).toMatchObject({
      draftId: DRAFT_ID,
      url: DRAFT_URL,
      platformAccountId: ACCOUNT,
      normalizedTitle: 'Article',
    })
  })

  it('找不到原 draftId 时停止且不新建文章', async () => {
    const adapter = {
      probeDraftList: vi.fn(async () => listProbe([], CSDN_ARTICLE_MANAGEMENT_URL)),
      probe: vi.fn(),
    }
    const navigate = vi.fn(async (url: string) => pageAt(url))
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)

    await expect(
      coordinator.recoverExactDraft({
        expectedDraftId: DRAFT_ID,
        expectedPlatformAccountId: ACCOUNT,
        expectedTitle: 'Article',
        navigate: navigate as never,
      }),
    ).rejects.toThrow(`没有找到原草稿 ${DRAFT_ID}`)
    expect(adapter.probe).not.toHaveBeenCalled()
  })

  it('账号、标题或保存状态不一致时拒绝恢复', async () => {
    const adapter = {
      probeDraftList: vi.fn(async () =>
        listProbe(
          [{ draftId: DRAFT_ID, url: DRAFT_URL, title: 'Article' }],
          CSDN_ARTICLE_MANAGEMENT_URL,
        ),
      ),
      probe: vi.fn(async () => ({ ...editorProbe(), title: { value: 'Other' } })),
    }
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)
    await expect(
      coordinator.recoverExactDraft({
        expectedDraftId: DRAFT_ID,
        expectedPlatformAccountId: ACCOUNT,
        expectedTitle: 'Article',
        navigate: async (url) => pageAt(url) as never,
      }),
    ).rejects.toThrow('标题与任务标题不一致')
  })

  it('发布结果未知时按账号和唯一标题查公开文章，不假设公开 ID 等于草稿 ID', async () => {
    const publicationUrl = 'https://blog.csdn.net/test-user/article/details/999999'
    const adapter = {
      probe: vi
        .fn()
        .mockResolvedValueOnce({
          ...editorProbe(),
          pageKind: 'management',
          url: CSDN_ARTICLE_MANAGEMENT_URL,
          publishedLinks: [{ url: publicationUrl, title: 'Article' }],
        })
        .mockResolvedValueOnce({
          ...editorProbe(),
          pageKind: 'published-article',
          url: publicationUrl,
        }),
    }
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)
    await expect(
      coordinator.recoverExactPublication({
        expectedPlatformAccountId: ACCOUNT,
        expectedTitle: 'Article',
        navigate: async (url) => pageAt(url) as never,
      }),
    ).resolves.toMatchObject({ url: publicationUrl })
  })

  it('多个同名公开文章时停下来让人工选择', async () => {
    const adapter = {
      probe: vi.fn(async () => ({
        ...editorProbe(),
        pageKind: 'management',
        url: CSDN_ARTICLE_MANAGEMENT_URL,
        publishedLinks: [
          { url: 'https://blog.csdn.net/test-user/article/details/1', title: 'Article' },
          { url: 'https://blog.csdn.net/test-user/article/details/2', title: 'Article' },
        ],
      })),
    }
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)
    await expect(
      coordinator.recoverExactPublication({
        expectedPlatformAccountId: ACCOUNT,
        expectedTitle: 'Article',
        navigate: async (url) => pageAt(url) as never,
      }),
    ).rejects.toThrow('需要人工选择')
  })
})

function pageAt(url: string) {
  return { url: () => url, isClosed: () => false }
}

function listProbe(
  candidates: Array<{ draftId: string; url: string; title: string }>,
  draftSectionUrl?: string,
) {
  return {
    adapterId: 'csdn' as const,
    adapterVersion: 1 as const,
    observedAt: '2026-09-01T00:00:00.000Z',
    platformAccountId: ACCOUNT,
    pageSupported: true,
    ...(draftSectionUrl ? { draftSectionUrl } : {}),
    candidates,
  }
}

function editorProbe() {
  return {
    adapterId: 'csdn' as const,
    adapterVersion: 1 as const,
    observedAt: '2026-09-01T00:00:01.000Z',
    url: DRAFT_URL,
    pageKind: 'editor' as const,
    draftId: DRAFT_ID,
    platformAccountId: ACCOUNT,
    editor: {
      recognized: true,
      bodyTextLength: 10,
      imageEnumerationComplete: true,
      images: [],
    },
    title: { value: 'Article' },
    selectors: {},
    saveState: 'saved' as const,
    publishedLinks: [],
  }
}
