import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZhihuPublishingAdapter } from './zhihu-publishing-adapter'

const id = '2080754524944339658'
function fixture() {
  const path = 'https://pic-private.zhihu.com/v2-platform-image.png'
  const image = {
    currentSrc: `${path}?expiration=2&auth_key=live`,
    src: `${path}?expiration=2&auth_key=live`,
    alt: '',
    complete: true,
    naturalWidth: 1536,
  }
  const savedImage = { getAttribute: () => `${path}?expiration=1&auth_key=saved` }
  const body = {
    textContent: '正文',
    cloneNode: () => ({ textContent: '正文', querySelectorAll: () => [] }),
    querySelectorAll: () => [image],
  }
  const title = { value: '标题' }
  const draft = { id, author: { url_token: 'owner' }, title: '标题', content: 'server body' }
  vi.stubGlobal('location', {
    hostname: 'zhuanlan.zhihu.com',
    pathname: `/p/${id}/edit`,
    href: `https://zhuanlan.zhihu.com/p/${id}/edit`,
  })
  vi.stubGlobal('document', {
    querySelector: (selector: string) =>
      selector.includes('public-DraftEditor')
        ? body
        : selector.startsWith('textarea')
          ? title
          : null,
    querySelectorAll: () => [],
  })
  vi.stubGlobal(
    'DOMParser',
    class {
      parseFromString() {
        return { body: { textContent: '正文', querySelectorAll: () => [savedImage] } }
      }
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/me') ? { url_token: 'owner' } : draft),
    })),
  )
  const page = { evaluate: async (fn: () => unknown) => fn() }
  return { draft, image, page }
}
afterEach(() => vi.unstubAllGlobals())
describe('Zhihu server-backed page evidence', () => {
  it('reads public article content instead of the Draft.js comment box', async () => {
    const { page, image } = fixture()
    vi.stubGlobal('location', {
      hostname: 'zhuanlan.zhihu.com',
      pathname: `/p/${id}`,
      href: `https://zhuanlan.zhihu.com/p/${id}`,
    })
    const article = {
      textContent: '公开文章',
      cloneNode: () => ({ textContent: '公开文章', querySelectorAll: () => [] }),
      querySelectorAll: () => [image],
    }
    vi.stubGlobal('document', {
      querySelector: (selector: string) =>
        selector.includes('public-DraftEditor')
          ? { textContent: '评论', querySelectorAll: () => [] }
          : selector.includes('RichText')
            ? article
            : selector.includes('Post-Header')
              ? { href: 'https://www.zhihu.com/people/owner' }
              : selector === 'h1.Post-Title'
                ? { textContent: '标题' }
                : null,
      querySelectorAll: () => [],
    })
    const result = await new ZhihuPublishingAdapter().probe(page as never)
    expect(result.pageKind).toBe('published-article')
    expect(result.editor.bodyTextLength).toBe(4)
    expect(result.editor.images).toHaveLength(1)
    expect(result.selectors.publish).toBeUndefined()
    expect(result.editor.fileInputSelector).toBeUndefined()
  })

  it('verifies the actual saved body despite image signature rotation and never returns the signed query', async () => {
    const { page } = fixture()
    const result = await new ZhihuPublishingAdapter().probe(page as never)
    expect(result.saveState).toBe('saved')
    expect(result.draftId).toBe(id)
    expect(result.platformAccountId).toBe('owner')
    expect(JSON.stringify(result)).not.toMatch(/auth_key|expiration/)
  })
  it('does not accept the loaded local blob preview as a completed platform upload', async () => {
    const { page, image } = fixture()
    image.currentSrc = 'blob:https://zhuanlan.zhihu.com/temporary-preview'
    const result = await new ZhihuPublishingAdapter().probe(page as never)
    expect(result.editor.images[0].loaded).toBe(false)
    expect(result.saveState).toBe('unknown')
  })
  it('rejects a draft owned by a different signed-in account', async () => {
    const { page, draft } = fixture()
    draft.author.url_token = 'someone-else'
    const result = await new ZhihuPublishingAdapter().probe(page as never)
    expect(result.platformAccountId).toBeUndefined()
    expect(result.saveState).toBe('unknown')
  })
  it('does not call an edited title saved before the server returns it', async () => {
    const { page, draft } = fixture()
    draft.title = 'older title'
    expect((await new ZhihuPublishingAdapter().probe(page as never)).saveState).toBe('unknown')
  })
})

describe('Zhihu public image fallback text', () => {
  it.each(['正文', '被改过的正文'])(
    'ignores inert noscript without hiding visible differences: %s',
    async (visibleText) => {
      const expected = { textContent: '正文', querySelectorAll: () => [] }
      const actual = {
        querySelectorAll: () => [],
        cloneNode: () => {
          let fallbackPresent = true
          return {
            get textContent() {
              return visibleText + (fallbackPresent ? '<img src="fallback.png">' : '')
            },
            querySelectorAll: (selector: string) =>
              selector === 'noscript'
                ? [
                    {
                      remove: () => {
                        fallbackPresent = false
                      },
                    },
                  ]
                : [],
          }
        },
      }
      vi.stubGlobal('document', {
        querySelectorAll: (selector: string) =>
          selector.includes('Post-RichTextContainer') ? [actual] : [],
      })
      vi.stubGlobal(
        'DOMParser',
        class {
          parseFromString() {
            return { body: expected }
          }
        },
      )
      const page = {
        url: () => `https://zhuanlan.zhihu.com/p/${id}`,
        locator: () => ({ count: async () => 0 }),
        evaluate: async (fn: (html: string) => unknown, html: string) => fn(html),
      }
      const result = await new ZhihuPublishingAdapter().verifyBody(page as never, '<p>正文</p>')
      expect(result.textMatches).toBe(visibleText === '正文')
      expect(result.matches).toBe(visibleText === '正文')
      expect(result.textEvidence).not.toContain('fallback.png')
    },
  )
})
