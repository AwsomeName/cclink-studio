import MarkdownIt from 'markdown-it'
import { parseMarkdownSizedImage } from '@shared/markdown-sized-image'
import { isTableCellBreak } from './markdown-table-breaks'

// Tokenization only. HTML from a document is never rendered by this parser.
const parser = new MarkdownIt({ html: true })

function htmlBlockRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let block: [number, number] | null = null
  let inTable = false
  for (const token of parser.parse(source, {})) {
    if (token.level === 0) {
      block = token.map
      inTable = token.type === 'table_open'
    }
    if (!block) continue
    const html =
      token.type === 'html_block'
        ? [token]
        : (token.children ?? []).filter((child) => child.type === 'html_inline')
    // A sized image is supported syntax; so is `<br>` as the line break inside a table cell.
    const unsupported = (item: { content: string }): boolean =>
      !parseMarkdownSizedImage(item.content) && !(inTable && isTableCellBreak(item.content))
    if (html.some(unsupported)) {
      ranges.push(block)
      block = null
    }
  }
  return ranges
}

/** Share the same temporary fenced placeholders on both sides of a round-trip comparison.
 * Their language is absent from both originals, so user-written fences cannot be decoded. */
export function protectMarkdownHtml(source: string, reference?: string) {
  let language = 'cclink-preserved-html'
  while (source.includes(language) || reference?.includes(language)) language += 'x'
  const blocks: string[] = []
  const ids = new Map<string, number>()
  function mask(markdown: string): string {
    if (!markdown.includes('<')) return markdown
    const lines = markdown.split('\n')
    for (const [start, end] of htmlBlockRanges(markdown).reverse()) {
      let last = end
      while (last > start && !lines[last - 1].trim()) last--
      const raw = lines.slice(start, last).join('\n')
      const id = ids.get(raw) ?? blocks.length
      if (!ids.has(raw)) {
        ids.set(raw, id)
        blocks.push(raw)
      }
      lines.splice(start, last - start, '```' + language, String(id), '```')
    }
    return lines.join('\n')
  }
  return {
    language,
    blocks,
    source: mask(source),
    reference: reference === undefined ? undefined : mask(reference),
    restore(markdown: string): string {
      if (!blocks.length) return markdown
      const fence = new RegExp('^```' + language + '\\n(\\d+)\\n```$', 'gm')
      return markdown.replace(fence, (match, index: string) => blocks[Number(index)] ?? match)
    },
  }
}
