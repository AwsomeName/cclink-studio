import type { Page } from 'playwright-core'

export const JUEJIN_SETTINGS_ENTRY = 'button.xitu-btn:text-is("发布")'

/** Recognize only the observed editor header entry, never the panel's final action. */
export async function isJuejinSettingsEntry(page: Page, action: string, selector: unknown) {
  if (action !== 'click' || typeof selector !== 'string' || !selector.trim()) return false
  try {
    if (!/^https:\/\/juejin\.cn\/editor\/drafts\/\d+$/u.test(page.url())) return false
    const entry = page.locator(selector)
    if ((await entry.count()) !== 1) return false
    return await entry.evaluate((element) => {
      const doc = element.ownerDocument
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }
      const editors = doc.querySelectorAll('.CodeMirror')
      const titles = doc.querySelectorAll('input.title-input')
      return (
        element.matches('button.xitu-btn') &&
        element.textContent?.trim() === '发布' &&
        visible(element) &&
        !element.hasAttribute('disabled') &&
        element.getAttribute('type') !== 'submit' &&
        !element.closest('form') &&
        editors.length === 1 &&
        visible(editors[0]) &&
        titles.length === 1 &&
        visible(titles[0]) &&
        !Array.from(doc.querySelectorAll('.category-list')).some(visible) &&
        !Array.from(doc.querySelectorAll('button')).some(
          (button) => button.textContent?.trim() === '确定并发布' && visible(button),
        )
      )
    })
  } catch {
    return false
  }
}
