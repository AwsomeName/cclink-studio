import { expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { isJuejinSettingsEntry, JUEJIN_SETTINGS_ENTRY } from './juejin-settings-entry'

it.each([
  'entry',
  'final',
  'submit',
  'form',
  'panel',
  'hidden',
  'duplicate',
  'wrong-host',
  'press',
  'missing-editor',
])('%s preserves the final-action boundary', async (mode) => {
  const visible = { getBoundingClientRect: () => ({ width: 300, height: 100 }) }
  const element = {
    ...visible,
    getBoundingClientRect: () => ({ width: mode === 'hidden' ? 0 : 100, height: 30 }),
    matches: () => true,
    textContent: mode === 'final' ? '确定并发布' : '发布',
    hasAttribute: () => false,
    getAttribute: () => (mode === 'submit' ? 'submit' : null),
    closest: () => (mode === 'form' ? {} : null),
    ownerDocument: {
      querySelectorAll: (selector: string) =>
        selector === '.CodeMirror'
          ? mode === 'missing-editor'
            ? []
            : [visible]
          : selector === 'input.title-input'
            ? [visible]
            : selector === '.category-list' && mode === 'panel'
              ? [visible]
              : [],
    },
  }
  const page = {
    url: () =>
      `https://${mode === 'wrong-host' ? 'example.com' : 'juejin.cn'}/editor/drafts/123456`,
    locator: (selector: string) => ({
      count: async () => (mode === 'duplicate' ? 2 : 1),
      evaluate: async (fn: (el: unknown) => unknown) =>
        fn(
          selector === 'button:text-is("确定并发布")'
            ? { ...element, textContent: '确定并发布' }
            : element,
        ),
    }),
  } as unknown as Page
  expect(
    await isJuejinSettingsEntry(page, mode === 'press' ? 'press' : 'click', JUEJIN_SETTINGS_ENTRY),
  ).toBe(mode === 'entry')
  expect(await isJuejinSettingsEntry(page, 'click', 'button:text-is("确定并发布")')).toBe(false)
  expect(await isJuejinSettingsEntry(page, 'click', 'header > div > button')).toBe(
    mode === 'entry' || mode === 'press',
  )
})
