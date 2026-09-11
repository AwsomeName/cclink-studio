import type { Page } from 'playwright-core'
import type { ArticlePublishingDetailResult } from '../../shared/article-publishing/article-publishing-types'
import { readXiaohongshuLocalDrafts, requireXiaohongshuDraft } from './xiaohongshu-local-draft'
import {
  readXiaohongshuEditor,
  XiaohongshuPublishingAdapter,
} from './xiaohongshu-publishing-adapter'
import { clickXiaohongshuControl } from './xiaohongshu-publish-control'

type Observe = (
  value: Pick<ArticlePublishingDetailResult, 'id' | 'status' | 'evidence' | 'reason'>,
) => Promise<void>
type Expected = { draftId: string; uid: string; title: string }

export async function openXiaohongshuLocalDraft(
  page: Page,
  expected: Expected,
  assertCurrent: () => void | Promise<void>,
  observe?: Observe,
) {
  await assertCurrent()
  await page.locator('#app').waitFor()
  await page.waitForFunction(
    () =>
      Boolean(
        (
          document.querySelector('#app') as Element & {
            __vue_app__?: {
              config?: {
                globalProperties?: {
                  $store?: { state?: { Auth?: { userInfo?: { userId?: string } } } }
                }
              }
            }
          }
        )?.__vue_app__?.config?.globalProperties?.$store?.state?.Auth?.userInfo?.userId,
      ),
    undefined,
    { timeout: 10000 },
  )
  const live = await readXiaohongshuEditor(page)
  if (live.uid !== expected.uid) throw new Error('小红书草稿箱账号不一致')
  const drafts = await readXiaohongshuLocalDrafts(page)
  const original = requireXiaohongshuDraft(drafts, expected)
  await observe?.({ id: 'recovery.account', status: 'completed', evidence: `当前账号 ${live.uid}` })
  // The visible list has no ID attribute. Never choose a same-title duplicate by position.
  if (drafts.filter((d) => d.uid === expected.uid && d.title === expected.title).length !== 1)
    throw new Error('小红书同名本地草稿不唯一，不能按位置猜测')
  await observe?.({
    id: 'recovery.locate',
    status: 'completed',
    evidence: `本地原稿 ${original.draftId} · ${original.savedAt}`,
  })
  const title = page.locator('.draft-title-text').filter({ hasText: expected.title })
  if (
    !(await page
      .getByText(/^图文笔记\(\d+\)$/u)
      .isVisible()
      .catch(() => false))
  ) {
    const box = page.getByText(/^草稿箱\(\d+\)$/u)
    await box.waitFor({ state: 'visible', timeout: 10000 })
    if ((await box.count()) !== 1) throw new Error('小红书草稿箱入口不唯一')
    await assertCurrent()
    await box.click()
  }
  const imageDraftTab = page.getByText(/^图文笔记\(\d+\)$/u)
  await imageDraftTab.waitFor({ state: 'visible', timeout: 10000 })
  if ((await imageDraftTab.count()) !== 1) throw new Error('图文草稿分类不唯一')
  await assertCurrent()
  await imageDraftTab.click()
  await title.waitFor({ state: 'visible', timeout: 10000 })
  if ((await title.count()) !== 1 || (await title.innerText()) !== expected.title)
    throw new Error('原草稿行不唯一')
  const row = title.locator('xpath=../..')
  const edit = row.getByText('编辑', { exact: true })
  if ((await edit.count()) !== 1) throw new Error('原草稿编辑控件不唯一')
  await assertCurrent()
  await edit.click()
  await page
    .locator('.tiptap.ProseMirror[contenteditable="true"]')
    .waitFor({ state: 'visible', timeout: 10000 })
  await assertCurrent()
  const adapter = new XiaohongshuPublishingAdapter()
  const deadline = Date.now() + 10000
  let probe: Awaited<ReturnType<typeof adapter.inspectDraft>> | undefined
  let pendingReason = '小红书恢复后全文或图片未与本地原稿一致'
  do {
    await assertCurrent()
    const current = await readXiaohongshuEditor(page)
    if (
      current.uid !== expected.uid ||
      current.draftId !== expected.draftId ||
      current.title !== expected.title
    )
      throw new Error('小红书恢复时原账号、原稿或标题已变化')
    try {
      probe = await adapter.inspectDraft(page, expected)
      if (probe.saveState === 'saved') break
    } catch (error) {
      pendingReason = error instanceof Error ? error.message : String(error)
      // A newly loaded image invalidates that snapshot. Only retry read-only verification.
      if (!pendingReason.includes('回读期间变化')) throw error
    }
    await page.waitForTimeout(300)
  } while (Date.now() < deadline)
  if (!probe || probe.saveState !== 'saved') throw new Error(pendingReason)
  await assertCurrent()
  await observe?.({
    id: 'recovery.open',
    status: 'completed',
    evidence: `当前编辑器 draftId ${probe.draftId}`,
  })
  for (const [field, value] of [
    ['account', probe.uid],
    ['id', probe.draftId],
    ['title', probe.title],
    ['saved', probe.saveState],
  ])
    await observe?.({
      id: `recovery.verify.${field}`,
      status: 'completed',
      evidence: `当前原稿 ${field} = ${value}`,
    })
  return {
    draftId: expected.draftId,
    url: probe.url,
    platformAccountId: expected.uid,
    normalizedTitle: expected.title,
    observedAt: probe.observedAt,
    images: probe.images.map((img) => ({
      src: `https://sns-creator-preview.xhscdn.com/${img.fileId}`,
      loaded: img.loaded,
    })),
    imageEnumerationComplete: probe.imageEnumerationComplete,
  }
}

/** Save the current platform draft, then reopen its same ID. No new draft or storage mutation. */
export async function saveXiaohongshuLocalDraft(
  page: Page,
  expected: Expected,
  assertCurrent: () => void | Promise<void>,
  observe?: Observe,
) {
  await assertCurrent()
  let before = await readXiaohongshuEditor(page)
  const uploadDeadline = Date.now() + 30000
  while (before.images.some((img) => !img.fileId || !img.loaded) && Date.now() < uploadDeadline) {
    if (
      before.uid !== expected.uid ||
      before.draftId !== expected.draftId ||
      before.title !== expected.title
    )
      throw new Error('小红书等待图片期间原账号原稿已变化')
    await page.waitForTimeout(300)
    await assertCurrent()
    before = await readXiaohongshuEditor(page)
  }
  if (!before.imageEnumerationComplete || before.images.some((img) => !img.fileId || !img.loaded))
    throw new Error('小红书图片上传或预览尚未完成，未派发暂存')
  if (
    before.uid !== expected.uid ||
    before.draftId !== expected.draftId ||
    before.title !== expected.title ||
    !before.renderedMatches
  )
    throw new Error('小红书暂存前不是原账号原稿')
  await observe?.({
    id: 'save.dispatch',
    status: 'running',
    evidence: `暂存本地原稿 ${expected.draftId}`,
  })
  await clickXiaohongshuControl(page, 'save', assertCurrent)
  await observe?.({
    id: 'save.dispatch',
    status: 'completed',
    evidence: '暂存离开动作已派发；保存结果独立核验',
  })
  const deadline = Date.now() + 10000
  let saved
  do {
    await assertCurrent()
    saved = requireXiaohongshuDraft(await readXiaohongshuLocalDrafts(page), expected)
    if (
      saved.description === before.description &&
      saved.descriptionHtml === before.descriptionHtml &&
      saved.images.length === before.images.length &&
      saved.images.every((img, i) => img.fileId === before.images[i].fileId)
    )
      break
    await page.waitForTimeout(300)
  } while (Date.now() < deadline)
  if (
    !saved ||
    saved.description !== before.description ||
    saved.descriptionHtml !== before.descriptionHtml ||
    saved.images.length !== before.images.length ||
    saved.images.some((img, i) => img.fileId !== before.images[i].fileId)
  )
    throw new Error('小红书暂存结果尚未与写入内容一致')
  await observe?.({
    id: 'save.verify',
    status: 'completed',
    evidence: `已从平台本地库回读 ${saved.draftId} · ${saved.images.length} 张图 · ${saved.savedAt}`,
  })
  await page
    .getByText(/^(?:图文笔记|草稿箱)\(\d+\)$/u)
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
  await assertCurrent()
  return openXiaohongshuLocalDraft(page, expected, assertCurrent)
}
