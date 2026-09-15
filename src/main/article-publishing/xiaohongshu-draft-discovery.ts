import type { Page } from 'playwright-core'
import { readXiaohongshuLocalDrafts, requireXiaohongshuDraft } from './xiaohongshu-local-draft'
import { readXiaohongshuEditor } from './xiaohongshu-publishing-adapter'

/** Preparation only: identify one saved draft; never creates or changes a draft. */
export async function discoverXiaohongshuDraft(page: Page, title: unknown) {
  if (typeof title !== 'string' || !title.trim() || title.length > 200)
    throw new Error('请提供要识别的完整草稿标题')
  const url = page.url()
  if (new URL(url).origin !== 'https://creator.xiaohongshu.com')
    throw new Error('草稿识别只允许在当前账号的小红书创作后台执行')
  const before = await readXiaohongshuEditor(page)
  if (!before.uid || !/^[a-f\d]{24}$/iu.test(before.uid)) throw new Error('当前小红书账号尚未核验')
  const drafts = await readXiaohongshuLocalDrafts(page)
  const matches = drafts.filter((draft) => draft.uid === before.uid && draft.title === title)
  if (matches.length !== 1) throw new Error('当前账号下该标题的草稿不存在或不唯一，未选择草稿')
  const draft = requireXiaohongshuDraft(drafts, {
    draftId: matches[0].draftId,
    uid: before.uid,
    title,
  })
  const after = await readXiaohongshuEditor(page)
  if (page.url() !== url || after.uid !== before.uid) throw new Error('读取期间页面或账号变化')
  return {
    localDraftId: draft.draftId,
    platformAccountId: draft.uid,
    title: draft.title,
    savedAt: draft.savedAt,
    images: draft.images.map(({ name, width, height }) => ({ name, width, height })),
    evidence: '当前创作后台账号与平台本地已保存草稿一致；尚未发布',
  }
}
