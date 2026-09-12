import { describe, expect, it, vi } from 'vitest'
import { ArticlePublishingService } from './article-publishing-service'
import { PublishingAdapter } from './publishing-adapter'

const affairId = '33333333-3333-4333-8333-333333333333'
const assetIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
const urls = ['a', 'b'].map(
  (c) => `https://p3-sign.toutiaoimg.com/tos-cn-i-ezhpy3drpa/${c.repeat(32)}`,
)
const draftUrl = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=123'

describe('manual Toutiao original-image correspondence', () => {
  it.each(['valid', 'count', 'duplicate', 'order', 'running', 'unsaved', 'stale'] as const)(
    'only accepts the explicitly selected gallery position with current saved evidence: %s',
    async (mode) => {
      const state = {
        adapterId: 'toutiao',
        accountId: 'account',
        fields: { title: 'Article' },
        execution: {
          currentAttemptId: 'attempt',
          currentGeneration: 7,
          status: mode === 'running' ? 'running' : 'waiting-human',
        },
        draft: {
          platformDraftId: '123',
          platformAccountId: 'uid',
          recovery: { status: 'verified' },
        },
        assets: assetIds.map((id, index) => ({
          id,
          kind: 'local',
          sourcePath: `/workspace/${index}.png`,
          status: 'pending',
          uploadAttempts: [],
          occurrences: [{}],
          ...(mode === 'order' && index === 0 ? { platformUrl: urls[1] } : {}),
        })),
      }
      const affair = {
        id: affairId,
        articlePublishing: state,
        attempts: [{ id: 'attempt', tabId: 'tab', profileId: 'profile' }],
      }
      const resolved = vi.fn(async (_id, _asset, _resolution, _workspace, observation) => ({
        success: observation.isCurrent(),
      }))
      const web = {
        getProjectSnapshot: () => ({ success: true, data: { affairs: [affair] } }),
        resolveArticlePublishingAsset: resolved,
      }
      const page = { url: () => draftUrl }
      const manager = {
        isViewVisible: () => true,
        getViewProfileId: () => 'profile',
        getViewAccountId: () => 'account',
        getViewWorkspaceKey: () => '/workspace',
      }
      const images = (
        mode === 'count' ? urls.slice(0, 1) : mode === 'duplicate' ? [urls[0], urls[0]] : urls
      ).map((src) => ({ src, loaded: true }))
      const probe = vi.spyOn(PublishingAdapter.prototype, 'probe').mockResolvedValue({
        draftId: '123',
        platformAccountId: 'uid',
        title: { value: 'Article' },
        url: draftUrl,
        saveState: mode === 'unsaved' ? 'unknown' : 'saved',
        editor: { images, imageEnumerationComplete: true },
      } as never)
      let reads = 0
      const generation = vi
        .spyOn(PublishingAdapter.prototype, 'documentGeneration')
        .mockImplementation(() => (mode === 'stale' ? ++reads : 1))
      const service = new ArticlePublishingService({} as never, web as never, undefined, {
        getBrowserManager: () => manager,
        getPlaywrightBridge: () => ({ getPageById: () => page }),
      } as never)
      try {
        const result = await service.resolveAsset(
          {
            workspaceRef: { kind: 'local', path: '/workspace' },
            affairId,
            assetId: assetIds[1],
            resolution: 'present',
          },
          'workspace',
        )
        expect(result.success).toBe(mode === 'valid')
        if (mode === 'valid')
          expect(resolved).toHaveBeenCalledWith(
            affairId,
            assetIds[1],
            'present',
            'workspace',
            expect.objectContaining({ platformUrl: urls[1] }),
          )
        else if (mode !== 'stale') expect(resolved).not.toHaveBeenCalled()
      } finally {
        probe.mockRestore()
        generation.mockRestore()
        service.dispose()
      }
    },
  )
})
