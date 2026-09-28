import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArticlePublishingBrowserPolicy } from './article-publishing-browser-policy'
import * as weibo from './weibo-publication'
import * as toutiao from './toutiao-publication-review'

afterEach(() => vi.restoreAllMocks())

describe('same-Run read-only publication recovery', () => {
  it.each([
    'weibo',
    'toutiao',
    'cancelled',
    'stale-generation',
    'wrong-account',
    'private',
    'body-mismatch',
    'navigation-cancelled',
    'document-changed',
    'no-candidate',
    'multiple-candidates',
    'under-review',
    'wrong-draft',
  ])('requires public account, frozen body and current owner: %s', async (mode) => {
    const adapterId = ['toutiao', 'multiple-candidates', 'under-review', 'wrong-draft'].includes(
      mode,
    )
      ? 'toutiao'
      : 'weibo'
    const url =
      adapterId === 'weibo'
        ? 'https://weibo.com/5961101548/RhAKon2wi'
        : 'https://www.toutiao.com/w/123456789/'
    const scope = {
      adapterId,
      workspaceId: 'workspace',
      affairId: 'affair',
      attemptId: 'attempt',
      executionGeneration: 3,
      launchOperationId: 'launch',
      expectedTitle: 'Article',
      expectedPlatformAccountId: '5961101548',
      expectedPlatformDraftId: '123456789',
      assets: [{ platformUrl: 'https://wx1.sinaimg.cn/large/imageA.jpg' }],
    }
    const controller = new AbortController()
    if (mode === 'cancelled') controller.abort()
    const execution = {
      status: 'running',
      currentAttemptId: 'attempt',
      currentGeneration: mode === 'stale-generation' ? 4 : 3,
      currentLaunchOperationId: 'launch',
      currentStepId: 'publish',
    }
    const task = {
      id: 'task',
      tabId: 'tab',
      status: 'running',
      correlation: { agentRunId: 'agent', profileId: 'profile' },
    }
    const page = { url: () => url, isClosed: () => false }
    let generation = 1
    const navigate = vi.fn(async () => {
      if (mode === 'navigation-cancelled') controller.abort()
    })
    const record = vi.fn(async (_input: unknown, _current: () => boolean) => ({ success: true }))
    const candidate = {
      status: mode === 'under-review' ? '审核中' : '已发布',
      urls: [mode === 'wrong-draft' ? 'https://www.toutiao.com/w/999/' : url],
    }
    vi.spyOn(weibo, 'findWeiboPublicationCandidate').mockResolvedValue(
      mode === 'no-candidate'
        ? null
        : { uid: scope.expectedPlatformAccountId, id: 'RhAKon2wi', url },
    )
    vi.spyOn(toutiao, 'readToutiaoPublicationReview').mockResolvedValue({
      current: true,
      candidates: mode === 'multiple-candidates' ? [candidate, candidate] : [candidate],
    } as never)
    const receiver = {
      browserTaskRuntime: { getTask: () => task },
      webAffairService: {
        getProjectSnapshot: () => ({
          success: true,
          data: { affairs: [{ id: 'affair', articlePublishing: { execution } }] },
        }),
        recordWeiboPublicationLocation: record,
        recordToutiaoPublicationLocation: record,
      },
      browserManager: {
        getViewProfileId: () => 'profile',
        isViewVisible: () => true,
        navigate,
        ensurePlaywrightPage: vi.fn(),
        getViewRuntimeIdentity: () => ({
          webContentsId: 1,
          browserViewRuntimeGeneration: 1,
          documentGeneration: generation,
        }),
      },
      playwrightBridge: { getPageById: () => page },
      awaitRuntimeConvergence: vi.fn(),
      adapter: {
        probe: async () => {
          if (mode === 'document-changed') generation++
          return {
            pageKind: 'published-article',
            platformAccountId: mode === 'wrong-account' ? 'other' : scope.expectedPlatformAccountId,
            publicationBlocker: mode === 'private' ? '仅自己可见' : undefined,
            editor: { images: [{ src: scope.assets[0].platformUrl }] },
          }
        },
      },
      verifyFrozenBody: vi.fn(
        async (_scope, _page, current) => mode !== 'body-mismatch' && current(),
      ),
    }
    const result = Reflect.get(
      ArticlePublishingBrowserPolicy.prototype,
      'recoverSubmittedPublication',
    ).call(receiver, task, scope, page, { agentRunId: 'agent', abortSignal: controller.signal })
    if (['weibo', 'toutiao'].includes(mode)) {
      await expect(result).resolves.toBeUndefined()
      expect(record).toHaveBeenCalledTimes(1)
      expect(record.mock.calls[0]?.[0]).toMatchObject({
        url,
        attemptId: 'attempt',
        executionGeneration: 3,
      })
      expect(navigate).toHaveBeenCalledExactlyOnceWith('tab', url)
    } else {
      await expect(result).rejects.toThrow()
      expect(record).not.toHaveBeenCalled()
    }
    if (
      [
        'cancelled',
        'stale-generation',
        'no-candidate',
        'multiple-candidates',
        'under-review',
        'wrong-draft',
      ].includes(mode)
    )
      expect(navigate).not.toHaveBeenCalled()
  })
})
