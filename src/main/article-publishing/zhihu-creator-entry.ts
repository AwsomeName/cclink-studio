import type { Page } from 'playwright-core'

/** The creator sidebar opens a composition menu; editor submit controls stay guarded. */
export async function isZhihuCreatorEntry(page: Page, action: string, selector: unknown) {
  if (action !== 'click' || typeof selector !== 'string' || !selector.trim()) return false
  try {
    const url = new URL(page.url())
    if (
      url.origin !== 'https://www.zhihu.com' ||
      url.username ||
      url.password ||
      !/^\/creator\/manage\/creation\/(?:all|draft)$/u.test(url.pathname)
    )
      return false
    const locator = page.locator(selector)
    if ((await locator.count()) !== 1) return false
    return await locator.evaluate((element) => {
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }
      const label = element.textContent?.replace(/[\u200b-\u200d\ufeff]/gu, '').trim()
      const sidebar = element.parentElement?.parentElement
      const doc = element.ownerDocument
      if (
        !visible(element) ||
        element.matches(':disabled,[aria-disabled="true"]') ||
        element.getAttribute('type') === 'submit' ||
        element.closest('form,[role="dialog"]') ||
        Array.from(doc.querySelectorAll('textarea,[contenteditable="true"],[role="dialog"]')).some(
          visible,
        )
      )
        return false
      const link = element.closest('a[href]')
      if (
        label === '发布文章' &&
        link?.closest('main') &&
        new URL(link.getAttribute('href')!, doc.baseURI).href === 'https://zhuanlan.zhihu.com/write'
      )
        return true
      return Boolean(
        label === '发布内容' &&
        element.matches('div,span,button') &&
        sidebar?.closest('main') &&
        sidebar.querySelector('a[href="/creator/account/rights"]') &&
        sidebar.querySelector('a[href="/creator/account/growth-level"]') &&
        sidebar.querySelector('a[href="/creator"]'),
      )
    })
  } catch {
    return false
  }
}
