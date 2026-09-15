import type { Page } from 'playwright-core'

/** Split mode already exposes both panes; old narrow layouts require a tab switch. */
export async function ensureJuejinEditorMode(
  page: Page,
  mode: 'edit' | 'preview',
  assertCurrent?: () => void,
): Promise<void> {
  assertCurrent?.()
  const pane = page.locator(mode === 'edit' ? '.CodeMirror' : '.bytemd-preview')
  if ((await pane.count()) === 1 && (await pane.isVisible())) {
    assertCurrent?.()
    return
  }
  const tab = page.locator(`.bytemd-toolbar-tab:text-is("${mode === 'edit' ? '编辑' : '预览'}")`)
  if ((await tab.count()) !== 1 || !(await tab.isVisible()))
    throw new Error(`掘金${mode === 'edit' ? '编辑' : '预览'}区域不可见，且没有唯一可见切换入口`)
  assertCurrent?.()
  await tab.click()
  await pane.waitFor({ state: 'visible', timeout: 5000 })
  assertCurrent?.()
}
