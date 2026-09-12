import type { Page } from 'playwright-core'
import { parsePlatformDraftAnchor } from '../../shared/article-publishing/platform-draft-anchor'
import { readToutiaoPage, TOUTIAO_MANAGEMENT_URL } from './toutiao-publishing-adapter'

/** The observed management row has no href. Follow its one real editor popup,
 * then compare the exact ID before navigating the original task Tab. */
export async function locateToutiaoDraft(
  page: Page,
  expected: { draftId: string; uid: string; title: string },
  assertCurrent: () => void,
): Promise<string> {
  assertCurrent()
  if (page.url() !== TOUTIAO_MANAGEMENT_URL) throw new Error('头条恢复必须从草稿箱开始')
  const rowTitle = page.locator('a').filter({ hasText: expected.title })
  await rowTitle.first().waitFor({ state: 'visible', timeout: 10_000 })
  const live = await readToutiaoPage(page)
  assertCurrent()
  if (!live.management || live.uid !== expected.uid) throw new Error('头条草稿箱原账号不一致')
  if ((await rowTitle.count()) !== 1) throw new Error('头条同标题草稿不唯一，不能按位置猜测')
  let row = rowTitle
  let edit = row.getByText('编辑', { exact: true })
  for (let depth = 0; depth < 5 && (await edit.count()) === 0; depth++) {
    row = row.locator('xpath=..')
    edit = row.getByText('编辑', { exact: true })
  }
  if ((await edit.count()) !== 1 || !(await edit.isVisible()))
    throw new Error('头条原稿行内编辑入口不唯一或不可见')
  assertCurrent()
  const popupPromise = page.waitForEvent('popup', { timeout: 10_000 })
  // Attach the rejection handler before clicking; a failed click must not leave an unhandled wait.
  const popupResult = popupPromise.then(
    (popup) => ({ popup }),
    (error) => ({ error }),
  )
  await edit.click()
  const result = await popupResult
  assertCurrent()
  if ('error' in result) throw new Error('头条编辑入口没有返回实际原稿子页；不重复点击')
  await result.popup.waitForLoadState('domcontentloaded', { timeout: 10_000 })
  assertCurrent()
  const anchor = parsePlatformDraftAnchor(result.popup.url())
  if (anchor?.adapterId !== 'toutiao' || anchor.draftId !== expected.draftId)
    throw new Error('头条实际打开的草稿 ID 与原任务不一致，禁止继续')
  if (page.url() !== TOUTIAO_MANAGEMENT_URL || (await readToutiaoPage(page)).uid !== expected.uid)
    throw new Error('头条草稿箱在找回过程中变化，旧候选已废弃')
  assertCurrent()
  return anchor.url
}
