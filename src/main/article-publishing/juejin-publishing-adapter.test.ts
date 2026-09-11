import { afterEach, expect, it, vi } from 'vitest'
import type { Page } from 'playwright-core'
import { JuejinPublishingAdapter } from './juejin-publishing-adapter'
function fixture() {
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
