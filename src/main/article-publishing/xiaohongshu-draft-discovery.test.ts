import { beforeEach, expect, it, vi } from 'vitest'
import { discoverXiaohongshuDraft } from './xiaohongshu-draft-discovery'
import { readXiaohongshuEditor } from './xiaohongshu-publishing-adapter'
import { readXiaohongshuLocalDrafts } from './xiaohongshu-local-draft'

vi.mock('./xiaohongshu-publishing-adapter', () => ({ readXiaohongshuEditor: vi.fn() }))
vi.mock('./xiaohongshu-local-draft', async (original) => ({
  ...(await original<typeof import('./xiaohongshu-local-draft')>()),
  readXiaohongshuLocalDrafts: vi.fn(),
}))
const uid = '65361844000000000301e75a'
const draft = {
  uid,
  draftId: '496f849d-fdaa-4c57-9563-a6be54f5cf76',
  title: '原稿',
  description: '',
  descriptionHtml: '',
  savedAt: 1,
  images: [{ fileId: 'uploaded-id', name: 'cover.png', width: 1086, height: 1448, uploaded: true }],
}
const page = { url: vi.fn(() => 'https://creator.xiaohongshu.com/publish/publish') }
beforeEach(() => {
  vi.resetAllMocks()
  page.url.mockReturnValue('https://creator.xiaohongshu.com/publish/publish')
  vi.mocked(readXiaohongshuEditor).mockResolvedValue({ uid } as never)
  vi.mocked(readXiaohongshuLocalDrafts).mockResolvedValue([draft])
})
it('projects only the unique saved draft for the live account', async () => {
  vi.mocked(readXiaohongshuLocalDrafts).mockResolvedValue([
    draft,
    { ...draft, draftId: 'other', uid: 'other' },
  ])
  const result = await discoverXiaohongshuDraft(page as never, '原稿')
  expect(result.localDraftId).toBe(draft.draftId)
  expect(result.platformAccountId).toBe(uid)
  expect(result.images).toEqual([{ name: 'cover.png', width: 1086, height: 1448 }])
  expect(result).not.toHaveProperty('description')
})
it('rejects ambiguous same-account drafts', async () => {
  vi.mocked(readXiaohongshuLocalDrafts).mockResolvedValue([draft, { ...draft, draftId: 'other' }])
  await expect(discoverXiaohongshuDraft(page as never, '原稿')).rejects.toThrow('不唯一')
})
it('rejects an incomplete upload', async () => {
  vi.mocked(readXiaohongshuLocalDrafts).mockResolvedValue([
    { ...draft, images: [{ ...draft.images[0], uploaded: false }] },
  ])
  await expect(discoverXiaohongshuDraft(page as never, '原稿')).rejects.toThrow('未完成上传')
})
it('rejects account changes while reading', async () => {
  vi.mocked(readXiaohongshuEditor)
    .mockResolvedValueOnce({ uid } as never)
    .mockResolvedValueOnce({ uid: 'changed' } as never)
  await expect(discoverXiaohongshuDraft(page as never, '原稿')).rejects.toThrow('账号变化')
})
it('does not inspect other origins', async () => {
  page.url.mockReturnValue('https://creator.xiaohongshu.com.attacker.test/')
  await expect(discoverXiaohongshuDraft(page as never, '原稿')).rejects.toThrow('创作后台')
  expect(readXiaohongshuEditor).not.toHaveBeenCalled()
  expect(readXiaohongshuLocalDrafts).not.toHaveBeenCalled()
})
