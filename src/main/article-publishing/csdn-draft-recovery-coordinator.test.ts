import { describe, expect, it, vi } from 'vitest'
import { CsdnDraftRecoveryCoordinator } from './csdn-draft-recovery-coordinator'
import { CSDN_ARTICLE_MANAGEMENT_URL } from './csdn-publishing-adapter'

const DRAFT_ID = '164148817'
const DRAFT_URL = `https://mp.csdn.net/mp_blog/creation/editor/${DRAFT_ID}`
const DRAFT_LIST_URL = 'https://mp.csdn.net/mp_blog/manage/article?type=draft'

describe('CsdnDraftRecoveryCoordinator', () => {
  it('finds one exact persisted draft through the visible draft list before opening it', async () => {
    const adapter = {
      probeDraftList: vi
        .fn()
        .mockResolvedValueOnce(listProbe([], DRAFT_LIST_URL))
        .mockResolvedValueOnce(
          listProbe([{ draftId: DRAFT_ID, url: DRAFT_URL, title: 'Article' }]),
        ),
      probe: vi.fn(async () => editorProbe()),
      captureSavedEditorSnapshot: vi.fn(async () => platformSnapshot()),
    }
    const navigate = vi.fn(async (url: string) => pageAt(url))
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)

    const result = await coordinator.recoverExactDraft({
      expectedDraftId: DRAFT_ID,
      expectedSnapshot: platformSnapshot(),
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
      snapshot: { snapshotHash: 'a'.repeat(64) },
    })
  })

  it('stops without opening an editor when the exact draft ID is absent', async () => {
    const adapter = {
      probeDraftList: vi.fn(async () => listProbe([], CSDN_ARTICLE_MANAGEMENT_URL)),
      probe: vi.fn(),
    }
    const navigate = vi.fn(async (url: string) => pageAt(url))
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)

    await expect(
      coordinator.recoverExactDraft({
        expectedDraftId: DRAFT_ID,
        expectedSnapshot: platformSnapshot(),
        navigate: navigate as never,
      }),
    ).rejects.toThrow(`没有找到原草稿 ${DRAFT_ID}`)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(adapter.probe).not.toHaveBeenCalled()
  })

  it('does not search ordinary article-management links when a draft section is unproven', async () => {
    const adapter = {
      probeDraftList: vi.fn(async () =>
        listProbe([{ draftId: DRAFT_ID, url: DRAFT_URL, title: 'Article' }]),
      ),
      probe: vi.fn(),
    }
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)

    await expect(
      coordinator.recoverExactDraft({
        expectedDraftId: DRAFT_ID,
        expectedSnapshot: platformSnapshot(),
        navigate: async (url) => pageAt(url) as never,
      }),
    ).rejects.toThrow('无法确认草稿箱入口')
    expect(adapter.probe).not.toHaveBeenCalled()
  })

  it('stops before writing when the recovered draft body no longer matches saved evidence', async () => {
    const adapter = {
      probeDraftList: vi.fn(async () =>
        listProbe(
          [{ draftId: DRAFT_ID, url: DRAFT_URL, title: 'Article' }],
          CSDN_ARTICLE_MANAGEMENT_URL,
        ),
      ),
      probe: vi.fn(async () => editorProbe()),
      captureSavedEditorSnapshot: vi.fn(async () =>
        platformSnapshot({ snapshotHash: 'd'.repeat(64) }),
      ),
    }
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)

    await expect(
      coordinator.recoverExactDraft({
        expectedDraftId: DRAFT_ID,
        expectedSnapshot: platformSnapshot(),
        navigate: async (url) => pageAt(url) as never,
      }),
    ).rejects.toThrow('正文、图片或保存状态已变化')
  })

  it('finds an unknown publication only by the original draft ID and account', async () => {
    const publicationUrl = `https://blog.csdn.net/test-user/article/details/${DRAFT_ID}`
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
          publishedArticleId: DRAFT_ID,
        }),
    }
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)
    const result = await coordinator.recoverExactPublication({
      expectedArticleId: DRAFT_ID,
      expectedSnapshot: platformSnapshot(),
      navigate: async (url) => pageAt(url) as never,
    })
    expect(result.url).toBe(publicationUrl)
  })

  it('does not use a same-title article with a different ID as publication proof', async () => {
    const adapter = {
      probe: vi.fn(async () => ({
        ...editorProbe(),
        pageKind: 'management',
        url: CSDN_ARTICLE_MANAGEMENT_URL,
        publishedLinks: [
          {
            url: 'https://blog.csdn.net/test-user/article/details/999999',
            title: 'Article',
          },
        ],
      })),
    }
    const coordinator = new CsdnDraftRecoveryCoordinator(adapter as never)
    await expect(
      coordinator.recoverExactPublication({
        expectedArticleId: DRAFT_ID,
        expectedSnapshot: platformSnapshot(),
        navigate: async (url) => pageAt(url) as never,
      }),
    ).rejects.toThrow(`尚未找到与原草稿 ID 相同的公开文章 ${DRAFT_ID}`)
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
    evidenceHash: 'e'.repeat(64),
    platformAccountId: 'csdn:test-user',
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
    evidenceHash: 'f'.repeat(64),
    url: DRAFT_URL,
    pageKind: 'editor' as const,
    draftId: DRAFT_ID,
    platformAccountId: 'csdn:test-user',
    editor: {
      recognized: true,
      bodyTextLength: 10,
      bodyStructureHash: 'b'.repeat(64),
      imageEnumerationComplete: true,
      images: [],
    },
    title: { value: 'Article' },
    selectors: {},
    saveState: 'saved' as const,
    publishedLinks: [],
  }
}

function platformSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    adapterId: 'csdn' as const,
    adapterVersion: 1 as const,
    platformAccountId: 'csdn:test-user',
    draftId: DRAFT_ID,
    normalizedTitle: 'Article',
    bodyStructureHash: 'b'.repeat(64),
    images: [],
    imageEnumerationComplete: true as const,
    saveState: 'saved' as const,
    snapshotHash: 'a'.repeat(64),
    evidenceHash: 'e'.repeat(64),
    observedAt: '2026-09-01T00:00:01.000Z',
    ...overrides,
  }
}
