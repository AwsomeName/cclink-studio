import { afterEach, expect, it, vi } from 'vitest'
import { ArticlePublishingService } from './article-publishing-service'
import { PublishingAdapter } from './publishing-adapter'
afterEach(() => vi.restoreAllMocks())
it.each(['correct', 'wrong-account', 'changed-after-read'] as const)(
  'reconciles a visible original draft after its old runtime binding was cleared: %s',
  async (scenario) => {
    const affairId = '33333333-3333-4333-8333-333333333333'
    const attemptId = '44444444-4444-4444-8444-444444444444'
    let account = scenario === 'wrong-account' ? 'other' : 'account'
    const page = { url: () => 'https://juejin.cn/editor/drafts/123' }
    const affair = {
      id: affairId,
      attempts: [{ id: attemptId, profileId: 'profile' }],
      articlePublishing: {
        adapterId: 'juejin',
        accountId: 'account',
        fields: { title: '标题' },
        draft: { platformDraftId: '123', platformAccountId: 'owner' },
        execution: { currentAttemptId: attemptId, currentGeneration: 2 },
        assets: [{ id: 'asset', status: 'result-unknown' }],
      },
    }
    vi.spyOn(PublishingAdapter.prototype, 'documentGeneration').mockReturnValue(1)
    vi.spyOn(PublishingAdapter.prototype, 'probe').mockImplementation(async () => {
      if (scenario === 'changed-after-read') account = 'other'
      return {
        draftId: '123',
        platformAccountId: 'owner',
        title: { value: '标题' },
        saveState: 'saved',
        url: page.url(),
        editor: { images: [{ src: 'https://p0-xtjj-private.juejin.cn/image', loaded: true }] },
      } as never
    })
    const resolve = vi.fn(async (_a, _b, _c, _d, observation) => ({
      success: observation.isCurrent(),
    }))
    const manager = {
      getActiveViewIdForWorkspace: () => 'visible',
      isViewVisible: () => true,
      getViewProfileId: () => 'profile',
      getViewAccountId: () => account,
      getViewWorkspaceKey: () => '/workspace',
    }
    const service = new ArticlePublishingService(
      {} as never,
      {
        getProjectSnapshot: () => ({ success: true, data: { affairs: [affair] } }),
        resolveArticlePublishingAsset: resolve,
      } as never,
      undefined,
      {
        getBrowserManager: () => manager,
        getPlaywrightBridge: () => ({ getPageById: () => page }),
      } as never,
    )
    try {
      const result = await service.resolveAsset(
        {
          workspaceRef: { kind: 'local', path: '/workspace' },
          affairId,
          assetId: 'asset',
          resolution: 'present',
        },
        'workspace',
      )
      expect(result.success).toBe(scenario === 'correct')
      if (scenario === 'wrong-account') expect(resolve).not.toHaveBeenCalled()
    } finally {
      service.dispose()
    }
  },
)
