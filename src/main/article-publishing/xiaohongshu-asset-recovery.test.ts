import { afterEach, expect, it, vi } from 'vitest'
import { ArticlePublishingService } from './article-publishing-service'
import * as xhs from './xiaohongshu-publishing-adapter'
import { PublishingAdapter } from './publishing-adapter'
afterEach(() => vi.restoreAllMocks())
it.each([
  'correct',
  'wrong-account',
  'changed-after-read',
  'wrong-file',
  'multiple-images',
] as const)(
  'imports only an explicitly confirmed matching image from the XHS original draft: %s',
  async (scenario) => {
    const affairId = '33333333-3333-4333-8333-333333333333'
    const attemptId = '44444444-4444-4444-8444-444444444444'
    let account = scenario === 'wrong-account' ? 'other' : 'account'
    const page = { url: () => 'https://creator.xiaohongshu.com/publish/publish?target=image' }
    const affair = {
      id: affairId,
      attempts: [{ id: attemptId, profileId: 'profile' }],
      articlePublishing: {
        adapterId: 'xiaohongshu',
        accountId: 'account',
        fields: { title: '标题' },
        draft: {
          platformDraftId: '123',
          platformAccountId: 'owner',
          recovery: { status: 'verified' },
        },
        execution: { currentAttemptId: attemptId, currentGeneration: 2 },
        assets: [
          {
            id: 'asset',
            status: 'pending',
            uploadAttempts: [],
            sourcePath: '/workspace/cover.png',
          },
        ],
      },
    }
    vi.spyOn(xhs, 'readXiaohongshuEditor').mockResolvedValue({
      images: [
        {
          loaded: true,
          name: scenario === 'wrong-file' ? 'other.png' : 'cover.png',
          fileId: 'spectrum/image',
        },
      ],
    } as never)
    vi.spyOn(PublishingAdapter.prototype, 'documentGeneration').mockReturnValue(1)
    vi.spyOn(PublishingAdapter.prototype, 'probe').mockImplementation(async () => {
      if (scenario === 'changed-after-read') account = 'other'
      return {
        draftId: '123',
        platformAccountId: 'owner',
        title: { value: '标题' },
        saveState: 'saved',
        url: page.url(),
        editor: {
          images: [
            { src: 'https://sns-creator-preview.xhscdn.com/spectrum/image', loaded: true },
            ...(scenario === 'multiple-images'
              ? [{ src: 'https://sns-creator-preview.xhscdn.com/spectrum/other', loaded: true }]
              : []),
          ],
        },
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
