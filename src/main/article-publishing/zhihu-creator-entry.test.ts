import { expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { isZhihuCreatorEntry } from './zhihu-creator-entry'

it.each([
  'entry',
  'zero-width',
  'final',
  'submit',
  'form',
  'editor',
  'dialog',
  'hidden',
  'duplicate',
  'wrong-host',
  'editor-url',
  'press',
  'missing-sidebar',
  'disabled',
])('%s retains the final submission boundary', async (mode) => {
  const visible = { getBoundingClientRect: () => ({ width: 100, height: 30 }) }
  const sidebar = {
    closest: () => (mode === 'missing-sidebar' ? null : {}),
    querySelector: () => (mode === 'missing-sidebar' ? null : {}),
  }
  const element = {
    ...visible,
    getBoundingClientRect: () => ({ width: mode === 'hidden' ? 0 : 100, height: 30 }),
    textContent: mode === 'final' ? '发布文章' : `发布内容${mode === 'zero-width' ? '\u200b' : ''}`,
    matches: (selector: string) => selector === 'div,span,button' || mode === 'disabled',
    getAttribute: () => (mode === 'submit' ? 'submit' : null),
    closest: (selector: string) => (mode === 'form' && selector !== 'a[href]' ? {} : null),
    parentElement: { parentElement: sidebar },
    ownerDocument: {
      querySelectorAll: () => (['editor', 'dialog'].includes(mode) ? [visible] : []),
    },
  }
  const page = {
    url: () =>
      mode === 'wrong-host'
        ? 'https://example.com/creator/manage/creation/draft'
        : mode === 'editor-url'
          ? 'https://zhuanlan.zhihu.com/p/123/edit'
          : 'https://www.zhihu.com/creator/manage/creation/draft?type=article',
    locator: () => ({
      count: async () => (mode === 'duplicate' ? 2 : 1),
      evaluate: async (fn: (e: unknown) => unknown) => fn(element),
    }),
  } as unknown as Page
  expect(
    await isZhihuCreatorEntry(page, mode === 'press' ? 'press' : 'click', 'main :text("发布内容")'),
  ).toBe(['entry', 'zero-width'].includes(mode))
})

it.each([
  'https://zhuanlan.zhihu.com/write',
  'https://zhuanlan.zhihu.com/p/123/edit',
  'https://example.com/write',
])('only accepts the observed new-article link: %s', async (href) => {
  const element = {
    textContent: '发布文章',
    getBoundingClientRect: () => ({ width: 100, height: 30 }),
    matches: () => false,
    getAttribute: () => null,
    closest: (selector: string) =>
      selector === 'a[href]'
        ? {
            closest: () => ({}),
            getAttribute: () => href,
          }
        : null,
    ownerDocument: { baseURI: 'https://www.zhihu.com/', querySelectorAll: () => [] },
  }
  const page = {
    url: () => 'https://www.zhihu.com/creator/manage/creation/draft?type=article',
    locator: () => ({
      count: async () => 1,
      evaluate: async (fn: (e: unknown) => unknown) => fn(element),
    }),
  } as unknown as Page
  expect(await isZhihuCreatorEntry(page, 'click', 'main :text("发布文章")')).toBe(
    href === 'https://zhuanlan.zhihu.com/write',
  )
})
