import { describe, expect, it, vi } from 'vitest'
import { readToutiaoPage } from './toutiao-publishing-adapter'
import { PublishingAdapter } from './publishing-adapter'

describe('Toutiao current-page evidence', () => {
  it.each(['ready', 'music', 'exclusive', 'unsaved', 'unreadable'] as const)(
    'only exposes the publish control with current saved/native-option evidence: %s',
    async (mode) => {
      const url = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=123'
      const options = [
        '头条首发',
        '开启配乐',
        '取材网络',
        '引用站内',
        '个人观点，仅供参考',
        '引用AI',
        '虚构演绎，故事经历',
        '投资观点，仅供参考',
        '健康医疗分享，仅供参考',
      ].map((label, i) => ({
        label,
        checked:
          mode === 'unreadable' && i === 3
            ? null
            : (mode === 'music' && i === 1) || (mode === 'exclusive' && i === 0),
      }))
      const page = {
        url: () => url,
        evaluate: vi
          .fn()
          .mockResolvedValue({
            url,
            options,
            editorRecognized: true,
            hasPublishControl: true,
            saved: mode !== 'unsaved',
            text: 'Article',
            title: 'Article',
            images: [],
            observedAt: new Date().toISOString(),
          }),
      }
      const probe = await new PublishingAdapter().probe(page as never)
      expect(Boolean(probe.selectors.publish)).toBe(mode === 'ready')
      expect(Boolean(probe.selectors.disableMusic)).toBe(mode === 'music')
      expect(probe.publishedLinks).toEqual([])
    },
  )
  it('does not turn a populated editor and draft URL into saved, uploaded or published evidence', async () => {
    const url = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=1876018407641100'
    const page = {
      url: () => url,
      evaluate: vi.fn().mockResolvedValue({
        url,
        observedAt: new Date().toISOString(),
        uid: '3777529577766638',
        editorRecognized: true,
        text: '原标题\n正文',
        title: '原标题',
        options: [{ label: '头条首发', checked: null, reason: '未读到复选框' }],
        hasSaveControl: true,
        hasPublishControl: true,
      }),
    }
    const probe = await new PublishingAdapter().probe(page as never)
    expect(probe).toMatchObject({
      adapterId: 'toutiao',
      draftId: '1876018407641100',
      saveState: 'unknown',
      editor: { imageEnumerationComplete: false },
      publishedLinks: [],
      selectors: {},
    })
    expect(probe.submissionUnavailableReason).toContain('未读到复选框')
  })
  it('rejects another origin before inspecting DOM', async () => {
    const page = { url: () => 'https://mp.toutiao.com.evil.test/', evaluate: vi.fn() }
    await expect(readToutiaoPage(page as never)).rejects.toThrow('不是头条')
    expect(page.evaluate).not.toHaveBeenCalled()
  })
})

// Execute the actual DOM-reader callback: the returned save state is not mocked.
describe('Toutiao draft comparison', () => {
  const first = 'tos-cn-i-ezhpy3drpa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const second = 'tos-cn-i-ezhpy3drpa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  async function run(
    change: 'none' | 'id' | 'body' | 'order' | 'load' | 'navigation' | 'foreign-read',
  ) {
    const url = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish?draft_id=123'
    const style = { visibility: 'visible', display: 'block', backgroundImage: 'none' }
    const element = (text = '') => ({
      innerText: text,
      textContent: text,
      isConnected: true,
      getBoundingClientRect: () => ({ width: 100, height: 100 }),
      style,
      getAttribute: () => null,
    })
    const spans = [first, second].map((id, i) => ({
      ...element(),
      style: {
        ...style,
        backgroundImage: `url("https://p${i ? 11 : 3}-sign.toutiaoimg.com/${id}~tplv-shrink:750:750.image?signature=never-log")`,
      },
    }))
    const gallery = { ...element('共 2 张，还能上传 16 张'), querySelectorAll: () => spans }
    const editor = { ...element('原标题\n正文'), parentElement: gallery }
    const save = {
      ...element('存草稿'),
      matches: (s: string) => s === 'button.save-draft',
      disabled: false,
    }
    const publish = {
      ...element('发布'),
      matches: (s: string) => s === 'button.publish-content',
      disabled: false,
    }
    const link = {
      ...element(),
      href: 'https://www.toutiao.com/c/user/12345/',
      compareDocumentPosition: () => 4,
    }
    const location = {
      href: url,
      origin: 'https://mp.toutiao.com',
      pathname: '/profile_v4/weitoutiao/publish',
    }
    const readIds = change === 'order' ? [second, first] : [first, second]
    const response = {
      code: 0,
      draft: {
        gid: change === 'id' ? '456' : '123',
        origin_draft: JSON.stringify({
          content: change === 'body' ? '其他文章' : '原标题\n正文',
          images: readIds.map((uri) => ({
            uri,
            url: `https://p11-sign.toutiaoimg.com/${uri}~tplv-shrink:750:750.image?signature=never-log`,
          })),
        }),
      },
    }
    const fetcher = vi.fn(async () => {
      if (change === 'navigation') location.href = url + '&changed=1'
      return { ok: true, text: async () => JSON.stringify(response) }
    })
    vi.stubGlobal('location', location)
    vi.stubGlobal('performance', {
      timeOrigin: 1,
      getEntriesByType: () => [
        {
          name: `${change === 'foreign-read' ? 'https://evil.test' : location.origin}/mp/agw/draft/get_ugc_draft?draft_id=123`,
          initiatorType: 'fetch',
        },
      ],
    })
    vi.stubGlobal('document', {
      body: {},
      querySelectorAll: (s: string) =>
        s.startsWith('div.ProseMirror')
          ? [editor]
          : s === 'a[href]'
            ? [link]
            : s === 'button'
              ? [save, publish]
              : [],
    })
    vi.stubGlobal(
      'Node',
      class {
        static DOCUMENT_POSITION_FOLLOWING = 4
      },
    )
    vi.stubGlobal('HTMLInputElement', class {})
    vi.stubGlobal('getComputedStyle', (e: { style: unknown }) => e.style)
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString(text: string) {
          return { body: { textContent: text } }
        }
      },
    )
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 750
        naturalHeight = 750
        onload?: () => void
        onerror?: () => void
        set src(value: string) {
          queueMicrotask(() =>
            change === 'load' && value.includes(second) ? this.onerror?.() : this.onload?.(),
          )
        }
      },
    )
    try {
      const page = { url: () => url, evaluate: async (fn: () => unknown) => fn() }
      const live = await readToutiaoPage(page as never)
      expect(JSON.stringify(live)).not.toContain('never-log')
      if (change === 'foreign-read') expect(fetcher).not.toHaveBeenCalled()
      return live
    } finally {
      vi.unstubAllGlobals()
    }
  }
  it('matches the full saved body and each loaded gallery URI across the two observed CDN hosts', async () => {
    const live = await run('none')
    expect(live.saved).toBe(true)
    expect(live.imageEnumerationComplete).toBe(true)
    expect(live.images).toHaveLength(2)
  })
  it.each(['id', 'body', 'order', 'load', 'navigation', 'foreign-read'] as const)(
    'does not accept saved evidence after %s mismatch',
    async (change) => {
      expect((await run(change)).saved).toBe(false)
    },
  )
})
