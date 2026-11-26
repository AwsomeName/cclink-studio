import { describe, expect, it } from 'vitest'
import {
  formatMarkdownSizedImage,
  matchMarkdownSizedImageAtStart,
  parseMarkdownSizedImage,
  replaceMarkdownSizedImages,
} from './markdown-sized-image'

describe('strict sized image tag', () => {
  it('accepts only src, alt and width in any order', () => {
    expect(parseMarkdownSizedImage('<img src="a.assets/x.png" alt="图" width="160">')).toEqual({
      src: 'a.assets/x.png',
      alt: '图',
      width: 160,
    })
    expect(parseMarkdownSizedImage('<img width="240" src="x.png" />')).toEqual({
      src: 'x.png',
      alt: '',
      width: 240,
    })
  })

  it('rejects anything wider than the strict form', () => {
    for (const tag of [
      '<img src="x.png" style="zoom:50%">',
      '<img src="x.png" width="160" height="90">',
      '<img src="x.png">',
      '<img src="x.png" width="50%">',
      '<img src="x.png" width="12">',
      "<img src='x.png' width='160'>",
      '<img src="x.png" width="160" width="200">',
      '<div>x</div>',
    ]) {
      expect(parseMarkdownSizedImage(tag), tag).toBeNull()
    }
  })

  it('round-trips text that needs escaping', () => {
    const image = { src: 'a b&c.png', alt: '说"明"<1>', width: 320 }
    expect(parseMarkdownSizedImage(formatMarkdownSizedImage(image))).toEqual(image)
  })

  it('matches only at the start for tokenizers', () => {
    expect(matchMarkdownSizedImageAtStart('<img src="x.png" width="160"> 后文')?.raw).toBe(
      '<img src="x.png" width="160">',
    )
    expect(matchMarkdownSizedImageAtStart('前文 <img src="x.png" width="160">')).toBeNull()
  })

  it('rewrites strict tags to plain images and reports widths in order', () => {
    const result = replaceMarkdownSizedImages(
      '| a | <img src="x.png" alt="甲" width="160"> |\n<img src="y.png" width="300">\n<img src="z.png" style="a">',
    )
    expect(result.widths).toEqual([160, 300])
    expect(result.source).toBe('| a | ![甲](<x.png>) |\n![](<y.png>)\n<img src="z.png" style="a">')
  })
})
