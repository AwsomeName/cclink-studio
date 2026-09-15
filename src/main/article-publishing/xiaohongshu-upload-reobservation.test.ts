import { expect, it, vi } from 'vitest'
import { ArticlePublishingBrowserPolicy } from './article-publishing-browser-policy'

function fixture() {
  const before = {
    url: 'https://creator.xiaohongshu.com/publish/publish?target=image',
    draftId: 'same-draft',
    platformAccountId: 'same-account',
    saveState: 'saved',
    editor: { imageEnumerationComplete: true, images: [] },
  }
  const scope = {
    adapterId: 'xiaohongshu',
    currentStepId: 'upload-assets',
    assets: [],
    affairId: 'affair',
  }
  const record = vi.fn().mockResolvedValue({ success: true })
  const probe = vi.fn().mockResolvedValueOnce(before)
  const current = vi.fn().mockReturnValue(true)
  const owner = {
    resolveTaskScope: async () => scope,
    webAffairService: {
      getProjectSnapshot: () => ({
        success: true,
        data: {
          affairs: [
            {
              id: 'affair',
              articlePublishing: {
                sideEffects: [
                  { key: 'upload-key', kind: 'upload-asset', targetId: 'asset:attempt-1' },
                ],
              },
            },
          ],
        },
      }),
      recordArticlePublishingImageObservation: record,
    },
    adapter: { probe, documentGeneration: () => 1 },
    runtimeSnapshot: () => ({}),
    attestationRuntimeIsCurrent: current,
  }
  const page = { waitForTimeout: vi.fn().mockResolvedValue(undefined) }
  return { before, owner, page, probe, record, current }
}
it('re-reads a changing upload snapshot and records only the unique saved image', async () => {
  const f = fixture()
  f.probe
    .mockRejectedValueOnce(new Error('小红书原稿在回读期间变化，旧证据已废弃'))
    .mockResolvedValue({
      ...f.before,
      editor: {
        imageEnumerationComplete: true,
        images: [{ src: 'https://sns-creator-preview.xhscdn.com/image', loaded: true }],
      },
    })
  const observer = await ArticlePublishingBrowserPolicy.prototype.prepareImageUpload.call(
    f.owner as never,
    { tabId: 'tab' } as never,
    'upload-key',
    f.page as never,
  )
  await observer!.finish()
  expect(f.page.waitForTimeout).toHaveBeenCalledTimes(1)
  expect(f.probe).toHaveBeenCalledTimes(3)
  expect(f.record).toHaveBeenCalledTimes(1)
  expect(f.record).toHaveBeenCalledWith(
    expect.objectContaining({ assetId: 'asset', sideEffectKey: 'upload-key' }),
    expect.any(Function),
  )
})
it('does not retry identity or other verification errors', async () => {
  const f = fixture()
  f.probe.mockRejectedValueOnce(new Error('小红书当前编辑现场不是指定账号的原草稿'))
  const observer = await ArticlePublishingBrowserPolicy.prototype.prepareImageUpload.call(
    f.owner as never,
    { tabId: 'tab' } as never,
    'upload-key',
    f.page as never,
  )
  await expect(observer!.finish()).rejects.toThrow('不是指定账号')
  expect(f.page.waitForTimeout).not.toHaveBeenCalled()
  expect(f.record).not.toHaveBeenCalled()
})
it('stops re-observation when the runtime changes', async () => {
  const f = fixture()
  f.probe.mockRejectedValueOnce(new Error('小红书原稿在回读期间变化，旧证据已废弃'))
  f.current.mockReturnValueOnce(true).mockReturnValue(false)
  const observer = await ArticlePublishingBrowserPolicy.prototype.prepareImageUpload.call(
    f.owner as never,
    { tabId: 'tab' } as never,
    'upload-key',
    f.page as never,
  )
  await expect(observer!.finish()).rejects.toThrow('证据已过期')
  expect(f.page.waitForTimeout).not.toHaveBeenCalled()
  expect(f.record).not.toHaveBeenCalled()
})
