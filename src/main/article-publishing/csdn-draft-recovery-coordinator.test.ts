import { describe, expect, it, vi } from 'vitest'
import { CsdnDraftRecoveryCoordinator } from './csdn-draft-recovery-coordinator'
import { CSDN_ARTICLE_MANAGEMENT_URL } from './csdn-publishing-adapter'

const DRAFT_ID = '164148817'
const DRAFT_URL = `https://mp.csdn.net/mp_blog/creation/editor/${DRAFT_ID}`
const DRAFT_LIST_URL = 'https://mp.csdn.net/mp_blog/manage/article?type=draft'
const ACCOUNT = 'csdn:test-user'

describe('CsdnDraftRecoveryCoordinator', () => {
  it.each(['owner', 'other'])(
    'recovers an observed public URL by readback only and checks the original owner: %s',
    async (owner) => {
      const url = 'https://zhuanlan.zhihu.com/p/2080754524944339658'
      const adapter = {
        probe: vi.fn(async () => ({
          ...editorProbe(),
          adapterId: 'zhihu',
          pageKind: 'published-article',
          platformAccountId: owner,
          url,
        })),
        probeDraftList: vi.fn(),
      }
      const navigate = vi.fn(async (url: string) => pageAt(url) as never)
      const result = new CsdnDraftRecoveryCoordinator(adapter as never).recoverExactPublication({
        visiblePublicationUrl: url,
        expectedPlatformAccountId: 'owner',
        expectedTitle: 'Article',
        navigate,
      })
      if (owner === 'owner') await expect(result).resolves.toMatchObject({ url })
      else await expect(result).rejects.toThrow('原平台账号')
      expect(navigate).toHaveBeenCalledTimes(1)
      expect(navigate).toHaveBeenCalledWith(url)
      expect(adapter.probeDraftList).not.toHaveBeenCalled()
    },
  )

  it('emits independently verified recovery steps and points at a title mismatch before permitting writes', async () => {
    const observe = vi.fn(async () => undefined)
    const adapter = {
      probeDraftList: vi.fn(async () =>
        listProbe(
          [{ draftId: DRAFT_ID, url: DRAFT_URL, title: 'Article' }],
          CSDN_ARTICLE_MANAGEMENT_URL,
        ),
      ),
      probe: vi.fn(async () => ({ ...editorProbe(), title: { value: 'Wrong article' } })),
    }
    await expect(
      new CsdnDraftRecoveryCoordinator(adapter as never).recoverExactDraft({
        expectedDraftId: DRAFT_ID,
        expectedPlatformAccountId: ACCOUNT,
        expectedTitle: 'Article',
        navigate: async (url) => pageAt(url) as never,
        observe,
      }),
    ).rejects.toThrow('标题')
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'recovery.locate', status: 'completed' }),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'recovery.verify.id', status: 'completed' }),
    )
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'recovery.verify.title',
        status: 'failed',
        evidence: expect.stringContaining('Wrong article'),
      }),
    )
  })

  it('waits for actual image loading and server save comparison during recovery hydration', async () => {
    const image = { src: 'https://i-blog.csdnimg.cn/direct/one.png', alt: '', loaded: true }
    const ready = { ...editorProbe(), editor: { ...editorProbe().editor, images: [image] } }
    const adapter = {
      probe: vi
        .fn()
        .mockResolvedValueOnce({ ...ready, saveState: 'unknown' })
        .mockResolvedValueOnce({
          ...ready,
          editor: { ...ready.editor, images: [{ ...image, loaded: false }] },
        })
        .mockResolvedValue(ready),
    }
    const result = await new CsdnDraftRecoveryCoordinator(adapter as never).verifyExactDraftPage({
      page: pageAt(DRAFT_URL) as never,
      expectedDraftId: DRAFT_ID,
      expectedPlatformAccountId: ACCOUNT,
      expectedTitle: 'Article',
    })
    expect(adapter.probe).toHaveBeenCalledTimes(3)
    expect(result.images).toEqual([image])
  })

  it('retries only reads across the real management redirect and CKEditor hydration', async () => {
    const adapter = {
      probeDraftList: vi
        .fn()
        .mockRejectedValueOnce(
          new Error('Execution context was destroyed, most likely because of a navigation.'),
        )
        .mockResolvedValue(
          listProbe(
            [{ draftId: DRAFT_ID, url: DRAFT_URL, title: 'Article' }],
            CSDN_ARTICLE_MANAGEMENT_URL,
          ),
        ),
      probe: vi
        .fn()
        .mockResolvedValueOnce({ ...editorProbe(), editor: { recognized: false } })
        .mockResolvedValue(editorProbe()),
    }
    const navigate = vi.fn(async (url: string) => pageAt(url))
    await expect(
      new CsdnDraftRecoveryCoordinator(adapter as never).recoverExactDraft({
        expectedDraftId: DRAFT_ID,
        expectedPlatformAccountId: ACCOUNT,
        expectedTitle: 'Article',
        navigate: navigate as never,
      }),
    ).resolves.toMatchObject({ draftId: DRAFT_ID })
    expect(navigate.mock.calls.map(([url]) => url)).toEqual([
      CSDN_ARTICLE_MANAGEMENT_URL,
      DRAFT_URL,
    ])
    expect(adapter.probeDraftList).toHaveBeenCalledTimes(2)
    expect(adapter.probe).toHaveBeenCalledTimes(2)
  })

  it('does not click the draft tab when cancelled while reading the management page', async () => {
    let cancelled = false
    const click = vi.fn()
    const adapter = {
      probeDraftList: vi.fn(async () => {
        cancelled = true
        return { ...listProbe([]), draftSectionTabName: '草稿箱(1)' }
      }),
    }
    await expect(
      new CsdnDraftRecoveryCoordinator(adapter as never).recoverExactDraft({
        expectedDraftId: DRAFT_ID,
        expectedPlatformAccountId: ACCOUNT,
        expectedTitle: 'Article',
        navigate: async (url) => ({ ...pageAt(url), getByRole: () => ({ click }) }) as never,
        assertActive: () => {
          if (cancelled) throw new Error('cancelled')
        },
      }),
    ).rejects.toThrow('cancelled')
    expect(click).not.toHaveBeenCalled()
  })

  it('uses the observed same-URL draft tab and discards candidates from the all-articles tab', async () => {
    const tab = {
      count: vi.fn(async () => 1),
      isVisible: vi.fn(async () => true),
      click: vi.fn(async () => undefined),
    }
    const page = {
      ...pageAt(CSDN_ARTICLE_MANAGEMENT_URL),
      getByRole: vi.fn((_role: string, _options: { name: RegExp }) => tab),
      waitForTimeout: vi.fn(),
    }
    const adapter = {
      probeDraftList: vi
        .fn()
        .mockResolvedValueOnce({
          ...listProbe([{ draftId: DRAFT_ID, url: 'https://mp.csdn.net/wrong', title: 'decoy' }]),
          draftSectionTabName: '草稿箱(1)',
        })
        .mockResolvedValueOnce(
          listProbe([{ draftId: DRAFT_ID, url: DRAFT_URL, title: 'Article' }]),
        ),
      probe: vi.fn(async () => editorProbe()),
    }
    const navigate = vi.fn(async (url: string) =>
      url === CSDN_ARTICLE_MANAGEMENT_URL ? page : pageAt(url),
    )
    await new CsdnDraftRecoveryCoordinator(adapter as never).recoverExactDraft({
      expectedDraftId: DRAFT_ID,
      expectedPlatformAccountId: ACCOUNT,
      expectedTitle: 'Article',
      navigate: navigate as never,
    })
    const name = page.getByRole.mock.calls[0]?.[1]?.name as RegExp
    expect(name).toBeInstanceOf(RegExp)
    expect(name.test('草稿箱(1)')).toBe(true)
    expect(name.test('草稿箱(2)')).toBe(true)
    expect(name.test('回收站(2)')).toBe(false)
    expect(name.test('草稿箱管理说明')).toBe(false)
    expect(tab.click).toHaveBeenCalledOnce()
    expect(navigate.mock.calls.map(([url]) => url)).toEqual([
      CSDN_ARTICLE_MANAGEMENT_URL,
      DRAFT_URL,
    ])
  })

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
          publishedLinks: [],
        })
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
  return { url: () => url, isClosed: () => false, waitForTimeout: vi.fn() }
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
