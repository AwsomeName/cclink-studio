/**
 * The one HTML form Studio edits in Markdown: an image with a display width.
 *
 *   <img src="doc.assets/a.png" alt="说明" width="240">
 *
 * Only `src`, `alt` and `width` (whole pixels) are allowed, double-quoted, in any order, with an
 * optional `/>`. Anything else (style, height, other tags) stays "raw HTML" and keeps the
 * out-of-scope protection. Typora, GitHub, VS Code and Obsidian render this form at that width.
 */
export interface MarkdownSizedImage {
  src: string
  alt: string
  width: number
}

export const MIN_MARKDOWN_IMAGE_WIDTH = 48
export const MAX_MARKDOWN_IMAGE_WIDTH = 4096

const ATTRIBUTE = /\s+([a-z]+)="([^"<>]*)"/gy
const TAG_SOURCE = String.raw`<img(?:\s+(?:src|alt|width)="[^"<>]*")+\s*\/?>`
const TAG_AT_START = new RegExp(`^${TAG_SOURCE}`, 'i')
const TAG_ANYWHERE = new RegExp(TAG_SOURCE, 'gi')

function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function encode(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Parses exactly one strict sized-image tag; null for any other HTML. */
export function parseMarkdownSizedImage(tag: string): MarkdownSizedImage | null {
  const trimmed = tag.trim()
  const match = /^<img((?:\s+[a-z]+="[^"<>]*")+)\s*\/?>$/i.exec(trimmed)
  if (!match) return null
  const attributes = new Map<string, string>()
  ATTRIBUTE.lastIndex = 0
  const body = match[1]
  let consumed = 0
  for (let next = ATTRIBUTE.exec(body); next; next = ATTRIBUTE.exec(body)) {
    const name = next[1].toLowerCase()
    if (!['src', 'alt', 'width'].includes(name) || attributes.has(name)) return null
    attributes.set(name, next[2])
    consumed = ATTRIBUTE.lastIndex
  }
  if (consumed !== body.length) return null
  const src = decode(attributes.get('src') ?? '').trim()
  const widthText = attributes.get('width') ?? ''
  if (!src || !/^[1-9]\d{0,3}$/.test(widthText)) return null
  const width = Number(widthText)
  if (width < MIN_MARKDOWN_IMAGE_WIDTH || width > MAX_MARKDOWN_IMAGE_WIDTH) return null
  return { src, alt: decode(attributes.get('alt') ?? ''), width }
}

/** The strict tag at the very start of `source`, if any (for tokenizers). */
export function matchMarkdownSizedImageAtStart(
  source: string,
): (MarkdownSizedImage & { raw: string }) | null {
  const match = TAG_AT_START.exec(source)
  if (!match) return null
  const image = parseMarkdownSizedImage(match[0])
  return image ? { ...image, raw: match[0] } : null
}

export function formatMarkdownSizedImage(image: MarkdownSizedImage): string {
  return `<img src="${encode(image.src)}" alt="${encode(image.alt)}" width="${Math.round(image.width)}">`
}

/**
 * Rewrites every strict sized-image tag to plain Markdown image syntax so structure checks and
 * the raw-HTML guard see an ordinary image; widths are returned in document order.
 */
export function replaceMarkdownSizedImages(source: string): { source: string; widths: number[] } {
  const widths: number[] = []
  const replaced = source.replace(TAG_ANYWHERE, (tag) => {
    const image = parseMarkdownSizedImage(tag)
    if (!image) return tag
    widths.push(image.width)
    const alt = image.alt.replace(/[[\]\\]/g, '\\$&')
    return `![${alt}](<${image.src.replace(/[<>]/g, '')}>)`
  })
  return { source: replaced, widths }
}
