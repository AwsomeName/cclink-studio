import type { Page } from 'playwright-core'
import {
  readToutiaoPage,
  TOUTIAO_BODY_SELECTOR,
  TOUTIAO_FILE_SELECTOR,
} from '../article-publishing/toutiao-publishing-adapter'

function assertDraft(page: Page, permit: (() => void) | undefined): asserts permit is () => void {
  const url = new URL(page.url())
  if (
    !permit ||
    url.origin !== 'https://mp.toutiao.com' ||
    url.pathname !== '/profile_v4/weitoutiao/publish' ||
    url.searchParams.getAll('draft_id').length !== 1 ||
    !/^\d{1,24}$/u.test(url.searchParams.get('draft_id') ?? '')
  )
    throw new Error('头条写入必须绑定原草稿和主进程派发许可')
  permit()
}

/** Persist the native editor mutation within the same tracked operation. The
 * caller still verifies the same draft's server body and gallery; pressing this
 * button is never itself proof of saving. No publication control is used. */
async function saveDraft(page: Page, permit: () => void) {
  assertDraft(page, permit)
  const save = page.locator('button.save-draft')
  if (
    (await save.count()) !== 1 ||
    !(await save.isVisible()) ||
    !(await save.isEnabled()) ||
    (await save.innerText()).trim() !== '存草稿'
  )
    throw new Error('头条原稿保存控件不唯一或不可用；停止，不重复写入')
  permit()
  // The native assistant can cover the button. Keyboard activation preserves
  // the platform handler without force-clicking through another control.
  await save.press('Enter')
}

export async function fillToutiaoDraft(
  page: Page,
  selector: string,
  text: string,
  permit?: () => void,
) {
  assertDraft(page, permit)
  if (selector !== TOUTIAO_BODY_SELECTOR || !text.trim())
    throw new Error('头条正文目标或冻结正文不匹配')
  await page.locator(selector).fill(text)
  await saveDraft(page, permit)
}

export async function uploadToutiaoDraftImage(
  page: Page,
  selector: string,
  paths: string[],
  permit?: () => void,
) {
  assertDraft(page, permit)
  if (selector !== TOUTIAO_FILE_SELECTOR || paths.length !== 1)
    throw new Error('头条每次只允许原稿上传面板中的一张冻结图片')
  const before = await readToutiaoPage(page)
  if (!before.editorRecognized || !before.imageEnumerationComplete || !before.hasFileInput)
    throw new Error('头条上传前图集或本地上传入口尚未核验')
  const known = new Set(before.images.map((image) => image.src))
  permit()
  await page.locator(selector).setInputFiles(paths)
  const deadline = Date.now() + 30_000
  let insertionDispatched = false
  let saveDispatched = false
  let lastDiagnostic = ''
  while (Date.now() < deadline) {
    assertDraft(page, permit)
    const after = await readToutiaoPage(page)
    lastDiagnostic = after.draftReadDiagnostic ?? ''
    const added = after.images.filter((image) => !known.has(image.src))
    if (after.url !== before.url || after.uid !== before.uid || added.length > 1)
      throw new Error('头条上传后账号、原稿或新增图片不唯一；只核验，不重传')
    if (after.imageEnumerationComplete && added.length === 1 && added[0].loaded) {
      if (!saveDispatched) {
        saveDispatched = true
        await saveDraft(page, permit)
      }
      return
    }
    // Native uploads first land in the visible upload drawer, not the article.
    // Confirm that single loaded result once within this same tracked upload.
    if (!insertionDispatched) {
      const drawer = page.locator('.byte-drawer:visible:has(input[type="file"])')
      if ((await drawer.count()) === 1) {
        const ready = await drawer.evaluate((root) => {
          const visible = (element: Element) => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden'
            )
          }
          const images = [...root.querySelectorAll('img')].filter(visible)
          return (
            /已上传\s*1\s*张图片/u.test((root as HTMLElement).innerText) &&
            images.length === 1 &&
            images[0].complete &&
            images[0].naturalWidth > 0 &&
            images[0].naturalHeight > 0
          )
        })
        if (ready) {
          const confirm = drawer.getByRole('button', { name: '确定', exact: true })
          if (
            (await confirm.count()) !== 1 ||
            !(await confirm.isVisible()) ||
            !(await confirm.isEnabled())
          )
            throw new Error('头条已上传图片的插入确认不唯一；只核验不重传')
          assertDraft(page, permit)
          insertionDispatched = true
          await confirm.click()
          // Persist the one authorized native insertion before waiting for its
          // durable image identity. Saving is not upload verification; the
          // complete gallery and platform readback must still pass afterwards.
          saveDispatched = true
          await saveDraft(page, permit)
        }
      }
    }
    await page.waitForTimeout(500)
  }
  throw new Error(
    `头条已选择文件，但未出现唯一已加载正文图片；保留现场，只核验不重传。${lastDiagnostic}`,
  )
}
