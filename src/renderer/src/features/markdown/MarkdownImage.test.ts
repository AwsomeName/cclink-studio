import { describe, expect, it } from 'vitest'
import { MarkdownImage, resolveMarkdownImageSource } from './MarkdownImage'

describe('resolveMarkdownImageSource', () => {
  it('resolves relative images beside the markdown document', () => {
    expect(
      resolveMarkdownImageSource('.assets/guide/screenshot.png', '/Users/test/docs/guide.md'),
    ).toBe('/Users/test/docs/.assets/guide/screenshot.png')
  })

  it('normalizes parent segments without escaping above the filesystem root', () => {
    expect(resolveMarkdownImageSource('../images/a.png', '/workspace/docs/readme.md')).toBe(
      '/workspace/images/a.png',
    )
  })

  it('keeps network and data sources unchanged', () => {
    expect(resolveMarkdownImageSource('https://example.com/a.png', '/workspace/readme.md')).toBe(
      'https://example.com/a.png',
    )
    expect(resolveMarkdownImageSource('data:image/png;base64,AA==')).toBe(
      'data:image/png;base64,AA==',
    )
  })

  it('parses markdown images without relying on an extension this binding', () => {
    const extension = MarkdownImage.configure({ documentPath: '/workspace/docs/readme.md' })
    const parseMarkdown = extension.config.parseMarkdown
    expect(parseMarkdown).toBeTypeOf('function')

    const result = parseMarkdown!(
      {
        type: 'image',
        href: 'images/a.png',
        text: '示意图',
        title: '标题',
      },
      {
        createNode: (type: string, attrs: Record<string, unknown>) => ({ type, attrs }),
      } as never,
    )

    expect(result).toEqual({
      type: 'image',
      attrs: {
        src: 'images/a.png',
        markdownSrc: 'images/a.png',
        alt: '示意图',
        title: '标题',
      },
    })
  })
})
