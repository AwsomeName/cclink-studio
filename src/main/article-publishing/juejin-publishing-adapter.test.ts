import { afterEach, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import { JuejinPublishingAdapter } from './juejin-publishing-adapter'
function fixture(panel?: { summary: string; category: string; pendingTag?: string }) {
  const draft = {
    id: '7683025447916847150',
    user_id: 'owner',
    title: '标题',
    mark_content: '原文',
    brief_content: '',
  }
  const title = { value: '标题' }
  const editor = { markdown: '原文' }
  vi.stubGlobal('location', {
    pathname: `/editor/drafts/${draft.id}`,
    href: `https://juejin.cn/editor/drafts/${draft.id}`,
  })
  vi.stubGlobal('document', {
    querySelector: (selector: string) =>
      selector === '.CodeMirror'
        ? { CodeMirror: { getValue: () => editor.markdown } }
        : selector === 'input.title-input'
          ? title
          : selector === '.category-list' && panel
            ? { getBoundingClientRect: () => ({ width: 400 }) }
            : selector === '.category-list .item.active' && panel?.category
              ? { textContent: panel.category }
              : selector === 'textarea[maxlength="100"]' && panel
                ? { value: panel.summary }
                : selector === '.tag-input[data-v-486f85f2] input' && panel
                  ? { value: panel.pendingTag ?? '' }
                  : null,
    querySelectorAll: () => [],
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        err_no: 0,
        data: url.includes('user/get')
          ? { user_id: 'owner' }
          : { article_draft: draft, category: { category_name: '' }, tags: [] },
      }),
    })),
  )
  const page = {
    locator: () => ({ count: async () => 0 }),
    evaluate: async (fn: (args: unknown) => unknown, args: unknown) => fn(args),
  } as unknown as Page
  return { draft, title, page, editor }
}
afterEach(() => vi.unstubAllGlobals())
it('re-resolves a replaced preview image once without inventing loaded image evidence', async () => {
  const { page } = fixture()
  const scroll = vi
    .fn()
    .mockRejectedValueOnce(new Error('Element is not attached to the DOM'))
    .mockResolvedValueOnce(undefined)
  page.locator = vi.fn((selector: string) =>
    selector.includes(' img')
      ? { count: async (): Promise<number> => 1, nth: () => ({ scrollIntoViewIfNeeded: scroll }) }
      : { count: async (): Promise<number> => 0 },
  ) as unknown as Page['locator']
  const probe = await new JuejinPublishingAdapter().probe(page)
  expect(scroll).toHaveBeenCalledTimes(2)
  expect(probe.editor.images).toEqual([])
})
it.each(['Element is not attached to the DOM', 'Target page has been closed'])(
  'keeps persistent or unrelated preview failures visible: %s',
  async (message) => {
    const { page } = fixture()
    const scroll = vi.fn().mockRejectedValue(new Error(message))
    page.locator = vi.fn((selector: string) =>
      selector.includes(' img')
        ? { count: async (): Promise<number> => 1, nth: () => ({ scrollIntoViewIfNeeded: scroll }) }
        : { count: async (): Promise<number> => 0 },
    ) as unknown as Page['locator']
    await expect(new JuejinPublishingAdapter().probe(page)).rejects.toThrow(message)
    expect(scroll).toHaveBeenCalledTimes(message.includes('not attached') ? 2 : 1)
  },
)
it('reports the actual tag search value even when no option is available', async () => {
  const { page } = fixture({ summary: '', category: '', pendingTag: '智能眼镜' })
  const probe = await new JuejinPublishingAdapter().probe(page)
  expect(probe.tagEditor?.pendingValue).toBe('智能眼镜')
  expect(probe.selectors.tags).toBeUndefined()
})
it('recognizes an unselected category only when server fields also match', async () => {
  const panel = { summary: '', category: '' }
  const { draft, page } = fixture(panel)
  const adapter = new JuejinPublishingAdapter()
  expect((await adapter.probe(page)).saveState).toBe('saved')
  panel.summary = '新摘要'
  expect((await adapter.probe(page)).saveState).toBe('unknown')
  draft.brief_content = panel.summary
  expect((await adapter.probe(page)).saveState).toBe('saved')
  panel.category = '人工智能'
  expect((await adapter.probe(page)).saveState).toBe('unknown')
})
it('requires exact owner, draft, title and saved Markdown', async () => {
  const { draft, title, page } = fixture()
  const adapter = new JuejinPublishingAdapter()
  expect((await adapter.probe(page)).saveState).toBe('saved')
  draft.mark_content = '不同正文'
  expect((await adapter.probe(page)).saveState).toBe('unknown')
  draft.mark_content = '原文'
  title.value = '另一个标题'
  expect((await adapter.probe(page)).saveState).toBe('unknown')
  title.value = '标题'
  draft.user_id = 'other'
  const wrong = await adapter.probe(page)
  expect(wrong.saveState).toBe('unknown')
  expect(wrong.platformAccountId).toBeUndefined()
})
it('does not attest opening settings as a publication dispatch', async () => {
  const { page } = fixture()
  const probe = await new JuejinPublishingAdapter().probe(page)
  expect(probe.selectors.openPublishSettings).toBe('button.xitu-btn:text-is("发布")')
  expect(probe.selectors.publish).toBeUndefined()
})

it('allows only rotating private image signatures, never changed links or image paths', async () => {
  const { draft, editor, page } = fixture()
  const adapter = new JuejinPublishingAdapter()
  draft.mark_content =
    '![图](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/image.awebp?rk3s=old&x-orig-sign=old&x-orig-expires=1)'
  editor.markdown = draft.mark_content.replace('old', 'new').replace('expires=1', 'expires=2')
  expect((await adapter.probe(page)).saveState).toBe('saved')
  editor.markdown = editor.markdown.replace('image.awebp', 'different.awebp')
  expect((await adapter.probe(page)).saveState).toBe('unknown')
  draft.mark_content = '[链接](https://example.com/?x-orig-sign=old)'
  editor.markdown = draft.mark_content.replace('old', 'new')
  expect((await adapter.probe(page)).saveState).toBe('unknown')
})

it('binds a public post to its original draft only through the account-owned server mapping', async () => {
  const { draft, page } = fixture()
  const published = draft as typeof draft & { article_id: string }
  published.article_id = '7683086663757004850'
  vi.stubGlobal('location', {
    pathname: `/post/${published.article_id}`,
    href: `https://juejin.cn/post/${published.article_id}`,
  })
  vi.stubGlobal('document', {
    querySelector: (selector: string) =>
      selector === '.article-viewer.markdown-body'
        ? { textContent: '原文', querySelectorAll: () => [] }
        : null,
    querySelectorAll: () => [],
  })
  const adapter = new JuejinPublishingAdapter()
  expect((await adapter.probe(page, undefined, draft.id)).draftId).toBe(draft.id)
  published.article_id = '999'
  expect((await adapter.probe(page, undefined, draft.id)).draftId).toBeUndefined()
  published.article_id = '7683086663757004850'
  draft.user_id = 'another-account'
  expect((await adapter.probe(page, undefined, draft.id)).draftId).toBeUndefined()
})
