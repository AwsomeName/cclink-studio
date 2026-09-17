import { afterEach, describe, expect, it, vi } from 'vitest'
import { JikePublishingAdapter } from './jike-publishing-adapter'

describe('Jike native composer facts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('recovers the stable CDN receipt behind a loaded blob preview', async () => {
    const rect = () => ({ width: 100, height: 40 })
    const file = new File(['abc'], '01.png', {
      type: 'image/png',
      lastModified: 1_789_288_813_839,
    })
    const image = {
      src: 'blob:https://web.okjike.com/preview',
      currentSrc: 'blob:https://web.okjike.com/preview',
      alt: 'preview',
      complete: true,
      naturalWidth: 1_877,
      getBoundingClientRect: rect,
      closest: () => null,
      __reactFiber$test: {
        memoizedProps: {
          data: {
            file,
            cdn: {
              file: {
                key: 'FvYZi-0ACXVxduE_Ikfj09mcXkSRv3.png',
                fileUrl: 'https://cdnv2.ruguoapp.com/FvYZi-0ACXVxduE_Ikfj09mcXkSRv3.png',
              },
            },
          },
        },
      },
    }
    const input = {
      id: '',
      tagName: 'INPUT',
      accept: 'image/png,image/jpeg',
      getBoundingClientRect: rect,
      getAttribute: (name: string) => (name === 'type' ? 'file' : null),
    }
    const send = {
      disabled: false,
      id: '',
      textContent: '发送',
      getBoundingClientRect: rect,
      getAttribute: (name: string) => (name === 'type' ? 'submit' : null),
      tagName: 'BUTTON',
    }
    const profile = { href: 'https://web.okjike.com/u/d62b6850-51a6-4177-a439-dac3ea92dbbf' }
    const attachment = {
      id: 'attachment',
      tagName: 'DIV',
      getBoundingClientRect: rect,
      getAttribute: () => null,
    }
    const removeAttachment = {
      id: 'remove-attachment',
      tagName: 'DIV',
      getBoundingClientRect: rect,
      getAttribute: (name: string) =>
        name === 'aria-label' || name === 'title' ? '移除附件' : null,
    }
    const root = {
      querySelectorAll: (selector: string) =>
        selector === 'input[type="file"]'
          ? [input]
          : selector === 'a[href]'
            ? [profile]
            : selector === 'img'
              ? [image]
              : selector === '[aria-roledescription="sortable"]'
                ? [attachment]
                : selector === '[aria-label="移除附件"][title="移除附件"]'
                  ? [removeAttachment]
                  : [],
    }
    const form = {
      closest: () => root,
      querySelectorAll: (selector: string) => (selector === 'button[type="submit"]' ? [send] : []),
    }
    const editor = {
      innerText: '',
      tagName: 'DIV',
      id: '',
      getBoundingClientRect: rect,
      getAttribute: (name: string) => (name === 'role' ? 'textbox' : null),
      closest: (selector: string) => (selector === 'form' ? form : null),
    }
    vi.stubGlobal('location', { href: 'https://web.okjike.com/following' })
    vi.stubGlobal('localStorage', {
      getItem: () =>
        JSON.stringify({
          attachment: {
            ids: ['1', '1'],
            map: {
              '1': {
                file: { relativePath: './01.png' },
                status: 'UPLOADED',
                type: 'PICTURE',
                cdn: {
                  file: {
                    fileUrl: 'https://cdnv2.ruguoapp.com/FvYZi-0ACXVxduE_Ikfj09mcXkSRv3.png',
                    key: 'FvYZi-0ACXVxduE_Ikfj09mcXkSRv3.png',
                    success: true,
                  },
                },
              },
            },
          },
          content: '',
        }),
    })
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    vi.stubGlobal('document', {
      documentElement: {},
      querySelectorAll: (selector: string) =>
        selector === '#attachment'
          ? [attachment]
          : selector === '#remove-attachment'
            ? [removeAttachment]
            : selector === '[contenteditable="true"][role="textbox"]' ||
                selector === 'div[role="textbox"]'
              ? [editor]
              : selector === 'input[type="file"]'
                ? [input]
                : selector === 'button[type="submit"]'
                  ? [send]
                  : [],
    })
    const page = {
      url: () => 'https://web.okjike.com/following',
      evaluate: async (fn: () => unknown) => fn(),
    }

    const result = await new JikePublishingAdapter().probe(page as never)

    expect(result.editor.imageEnumerationComplete).toBe(true)
    expect(result.editor.images).toEqual([
      {
        src: 'https://cdnv2.ruguoapp.com/FvYZi-0ACXVxduE_Ikfj09mcXkSRv3.png',
        alt: 'preview',
        loaded: true,
      },
    ])
    expect(result.editor.recoveredUploads).toEqual([
      {
        platformUrl: 'https://cdnv2.ruguoapp.com/FvYZi-0ACXVxduE_Ikfj09mcXkSRv3.png',
        fileName: '01.png',
        size: 3,
        lastModified: 1_789_288_813_839,
      },
    ])
    expect(result.editor.pendingDraftRestore).toEqual({
      content: '',
      attachmentIdsUnique: false,
      uploads: [
        {
          platformUrl: 'https://cdnv2.ruguoapp.com/FvYZi-0ACXVxduE_Ikfj09mcXkSRv3.png',
          fileName: '01.png',
        },
      ],
    })
    expect(result.selectors.attachmentHover).toBe('#attachment')
    expect(result.selectors.removeAttachment).toBe('#remove-attachment')
  })
})
