import { describe, expect, it, vi } from 'vitest'
import {
  BilibiliPublishingAdapter,
  BILIBILI_BODY,
  BILIBILI_TITLE,
  BILIBILI_IMAGE_OPEN,
} from './bilibili-publishing-adapter'
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async () => Buffer.from('frozen-image-bytes')),
}))

describe('B站 visible dynamic facts', () => {
  it.each([
    'current',
    'duplicate-body',
    'wrong-avatar',
    'outside-composer',
    'blob-image',
    'public',
    'private',
    'both-active',
    'ready',
    'scheduled',
    'disabled',
    'duplicate-publish',
    'native-preview',
    'wrong-preview',
    'missing-receipt',
    'duplicate-source',
    'decode-failed',
  ] as const)('%s', async (mode) => {
    const rect = () => ({ width: 100, height: 40 })
    const native = [
      'native-preview',
      'wrong-preview',
      'missing-receipt',
      'duplicate-source',
      'decode-failed',
    ].includes(mode)
    const populated =
      native || ['ready', 'scheduled', 'disabled', 'duplicate-publish'].includes(mode)
    const previewNode = { getBoundingClientRect: rect }
    const publish = {
      textContent: mode === 'scheduled' ? '定时发布' : '发布',
      children: [],
      getBoundingClientRect: rect,
      closest: () => (mode === 'disabled' ? {} : null),
    }
    const title = { value: '', getBoundingClientRect: rect }
    const root = {
      contains: () => mode !== 'outside-composer',
      querySelectorAll: (selector: string) =>
        selector === '.bili-pics-uploader__item' && native
          ? [{ classList: { contains: () => true }, querySelectorAll: () => [previewNode] }]
          : selector === 'button,div,span' && populated
            ? mode === 'duplicate-publish'
              ? [publish, publish]
              : [publish]
            : selector === '.bili-pics-uploader img' &&
                !native &&
                (mode === 'blob-image' || populated)
              ? [
                  {
                    src: populated
                      ? 'https://i0.hdslb.com/bfs/new_dyn/cover.png'
                      : 'blob:temporary',
                    alt: '',
                    complete: true,
                    naturalWidth: 100,
                    getBoundingClientRect: rect,
                  },
                ]
              : selector === '.bili-cascader-options__item-label' &&
                  (['public', 'private', 'both-active'].includes(mode) || populated)
                ? ['所有用户可见', '仅自己可见'].map((textContent, i) => ({
                    textContent,
                    getBoundingClientRect: rect,
                    closest: () => ({
                      classList: {
                        contains: () =>
                          mode === 'both-active' ||
                          (i === 0 ? mode === 'public' || populated : mode === 'private'),
                      },
                    }),
                  }))
                : [],
    }
    const body = {
      innerText: populated ? '正文' : '',
      isContentEditable: true,
      closest: () => root,
      getBoundingClientRect: rect,
    }
    const avatar = {
      href:
        mode === 'wrong-avatar'
          ? 'https://evil.test/3546384070347419'
          : 'https://space.bilibili.com/3546384070347419',
      getBoundingClientRect: rect,
    }
    const pic = { getBoundingClientRect: rect }
    vi.stubGlobal('document', {
      querySelectorAll: (selector: string) =>
        selector === BILIBILI_TITLE
          ? [title]
          : selector === BILIBILI_BODY
            ? mode === 'duplicate-body'
              ? [body, body]
              : [body]
            : selector === 'a.header-entry-mini'
              ? [avatar]
              : selector === BILIBILI_IMAGE_OPEN
                ? [pic]
                : [],
    })
    vi.stubGlobal('location', { href: 'https://t.bilibili.com/' })
    vi.stubGlobal('getComputedStyle', () => ({
      display: 'block',
      visibility: 'visible',
      backgroundImage: `url("data:image/png;base64,${Buffer.from(mode === 'wrong-preview' ? 'other-image' : 'frozen-image-bytes').toString('base64')}")`,
    }))
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 1086
        naturalHeight = 1448
        decode() {
          return mode === 'decode-failed'
            ? Promise.reject(new Error('bad image'))
            : Promise.resolve()
        }
      },
    )
    try {
      const page = {
        url: () => 'https://t.bilibili.com/',
        evaluate: async (fn: (p: unknown) => unknown, p: unknown) => fn(p),
      }
      const source = {
        sourcePath: '/authorized/cover.png',
        platformUrl:
          mode === 'missing-receipt' ? undefined : 'https://i0.hdslb.com/bfs/new_dyn/cover.png',
      }
      const result = await new BilibiliPublishingAdapter().probe(
        page as never,
        native ? (mode === 'duplicate-source' ? [source, source] : [source]) : [],
      )
      expect(result.draftId).toBeUndefined()
      expect(result.saveState).toBe('unknown')
      if (mode === 'ready' || mode === 'native-preview')
        expect(result.selectors.publish).toBe('main > section:nth-child(1) :text-is("发布")')
      else expect(result.selectors.publish).toBeUndefined()
      if (mode === 'current') {
        expect(result.platformAccountId).toBe('3546384070347419')
        expect(result.editor.recognized).toBe(true)
        expect(result.selectors.fileInput).toBe(BILIBILI_IMAGE_OPEN)
      }
      if (mode === 'wrong-avatar') expect(result.platformAccountId).toBeUndefined()
      if (['duplicate-body', 'outside-composer'].includes(mode))
        expect(result.editor.recognized).toBe(false)
      expect(result.bilibiliVisibility).toBe(
        mode === 'public' || populated ? 'public' : mode === 'private' ? 'private' : 'unknown',
      )
      if (mode === 'blob-image') expect(result.editor.imageEnumerationComplete).toBe(false)
      if (native) {
        expect(result.editor.images[0].loaded).toBe(mode === 'native-preview')
        expect(JSON.stringify(result)).not.toContain('data:image')
        if (mode === 'native-preview') expect(result.editor.images[0].src).toBe(source.platformUrl)
        if (['wrong-preview', 'missing-receipt', 'duplicate-source'].includes(mode))
          expect(result.editor.imageEnumerationComplete).toBe(false)
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
