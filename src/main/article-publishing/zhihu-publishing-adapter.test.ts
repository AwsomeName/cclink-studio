import { afterEach, describe, expect, it, vi } from 'vitest'
import { findVerifiedZhihuImage, ZhihuPublishingAdapter } from './zhihu-publishing-adapter'

describe('verified Zhihu image lookup for body writing', () => {
  const verified = 'https://picx.zhimg.com/80/v2-c6d587c64b8a1db97d1d63185171198e_1440w.png'
  const current =
    'https://pic1.zhimg.com/80/v2-c6d587c64b8a1db97d1d63185171198e_1440w.png?auth_key=current'
  it('returns the current signed URL for the same verified image after CDN rotation', () => {
    expect(findVerifiedZhihuImage([current], verified)).toBe(current)
  })
  it.each([
    current.replace('c6d587c64b8a1db97d1d63185171198e', '00000000000000000000000000000000'),
    current.replace('pic1.zhimg.com', 'pic1.zhimg.com.evil.test'),
    current.replace('pic1.zhimg.com', 'untrusted.zhimg.com'),
    current.replace('https:', 'http:'),
    current.replace('https://', 'https://user@'),
  ])('rejects changed identity or untrusted URL %s', (url) => {
    expect(findVerifiedZhihuImage([url], verified)).toBeUndefined()
  })
  it('rejects duplicate occurrences rather than guessing one', () => {
    expect(findVerifiedZhihuImage([current, verified], verified)).toBeUndefined()
    expect(findVerifiedZhihuImage([], verified)).toBeUndefined()
  })
})

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
  return { draft, image, savedImage, page }
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

  it.each([
    ['https://picx.zhimg.com/80/v2-c6d587c64b8a1db97d1d63185171198e_1440w.png', true],
    ['https://picx.zhimg.com/80/v2-00000000000000000000000000000000_1440w.png', false],
    ['https://untrusted.zhimg.com/80/v2-c6d587c64b8a1db97d1d63185171198e_1440w.png', false],
    ['https://picx.zhimg.com.evil.test/80/v2-c6d587c64b8a1db97d1d63185171198e_1440w.png', false],
  ])(
    'checks saved draft CDN identity without accepting a different image: %s',
    async (src, saved) => {
      const { page, image, savedImage } = fixture()
      image.currentSrc = src
      savedImage.getAttribute = () =>
        'https://pic1.zhimg.com/v2-c6d587c64b8a1db97d1d63185171198e_1440w.png'
      expect((await new ZhihuPublishingAdapter().probe(page as never)).saveState).toBe(
        saved ? 'saved' : 'unknown',
      )
    },
  )

  it('reports an unsigned image mismatch without treating an unsaved draft as saved', async () => {
    const { page, image } = fixture()
    image.currentSrc = 'https://pic-private.zhihu.com/v2-other.png?auth_key=secret'
    const result = await new ZhihuPublishingAdapter().probe(page as never)
    expect(result.saveState).toBe('unknown')
    expect(result.saveEvidence).toContain('图片=1/1')
    expect(result.saveEvidence).toContain('页面 https://pic-private.zhihu.com/v2-other.png')
    expect(result.saveEvidence).not.toContain('auth_key')
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

describe('Zhihu published CDN image identity', () => {
  const imageId = 'v2-669d9f0745fa2df1d433d066ea748b44'
  const publicPath = `/80/${imageId}_1440w.webp`
  it.each([
    [`https://pica.zhimg.com${publicPath}`, true, true, '正文'],
    [`https://pic3.zhimg.com${publicPath}`, true, true, '正文'],
    [`https://picx.zhimg.com${publicPath}`, true, true, '正文'],
    [`https://pica.zhimg.com${publicPath}`, false, false, '正文'],
    [`https://pica.zhimg.com${publicPath}`, true, false, '不同位置'],
    [`https://pica.zhimg.com${publicPath.replace('669d', '0000')}`, true, false, '正文'],
    [`https://pica.zhimg.com.evil.test${publicPath}`, true, false, '正文'],
    [`https://untrusted.zhimg.com${publicPath}`, true, false, '正文'],
    [`https://user@pica.zhimg.com${publicPath}`, true, false, '正文'],
    [`https://pica.zhimg.com:444${publicPath}`, true, false, '正文'],
    [`http://pica.zhimg.com${publicPath}`, true, false, '正文'],
  ])('verifies CDN URL %s (loaded=%s, matches=%s)', async (src, loaded, matches, preceding) => {
    const makeBody = (imageSrc: string, complete: boolean, precedingText: string) => {
      const image = {
        getAttribute: () => imageSrc,
        alt: '',
        complete,
        naturalWidth: complete ? 1536 : 0,
      }
      const body = {
        textContent: '正文',
        ownerDocument: {
          createRange: () => ({
            selectNodeContents: () => {},
            setEndBefore: () => {},
            toString: () => precedingText,
          }),
        },
        querySelectorAll: (selector: string) => (selector.startsWith('img') ? [image] : []),
        cloneNode: () => body,
      }
      return body
    }
    const expected = makeBody(
      `https://pic-private.zhihu.com/${imageId}~resize:1440:q75.png`,
      true,
      '正文',
    )
    const actual = makeBody(src, loaded, preceding)
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
    expect(result.textMatches).toBe(true)
    expect(result.images[0].matches).toBe(matches)
    expect(result.matches).toBe(matches)
  })
})
