import type { Locator } from 'playwright-core'

/** The native paste handler owns rich-text serialization; DOM fill is incompatible with multiline input. */
export async function pasteBilibiliBody(body: Locator, text: string, assertCurrent: () => void) {
  if (!(await body.evaluate((element) => (element as HTMLElement).isContentEditable)))
    throw new Error('B站正文区域不可编辑')
  // Never clear an existing composer while its submission may be unknown.
  if ((await body.innerText()).replace(/[\s\u200b]/gu, ''))
    throw new Error('B站正文不是空白；禁止覆盖或叠加粘贴，先核验原稿')
  await body.focus()
  assertCurrent()
  await body.press('End')
  assertCurrent()
  await body.evaluate((element, value) => {
    if ((element.textContent ?? '').replace(/[\s\u200b]/gu, ''))
      throw new Error('B站粘贴前正文已变化')
    const data = new DataTransfer()
    data.setData('text/plain', value)
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    )
  }, text)
}
