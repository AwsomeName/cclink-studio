import { Node } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'

/**
 * A Markdown table cell is one line, so a line break inside it is written `<br>` — the usual
 * GFM convention, and what AI drafts produce. It is the one HTML tag a table may hold and still be
 * edited as a table: inside table rows `<br>` is a cell line break, not raw HTML.
 */
export const TABLE_CELL_BREAK = /<br\s*\/?>/gi
const TABLE_CELL_BREAK_ONLY = /^<br\s*\/?>$/i
/** Private-use stand-in carried through the Markdown parser, then turned into cellBreak nodes. */
const SENTINEL = ''
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

export function isTableCellBreak(html: string): boolean {
  return TABLE_CELL_BREAK_ONLY.test(html.trim())
}

/** Calls `edit` for each table row line (outside fenced code) and keeps the other lines. */
function mapTableRows(source: string, edit: (line: string) => string): string {
  let fence: string | null = null
  return source
    .split('\n')
    .map((line) => {
      const marker = FENCE.exec(line)?.[1]
      if (marker && (fence === null || (marker[0] === fence[0] && marker.length >= fence.length))) {
        fence = fence === null ? marker : null
        return line
      }
      return fence === null && line.trim().startsWith('|') ? edit(line) : line
    })
    .join('\n')
}

/** The source with table-cell `<br>`s blanked, for checks that look for unsupported HTML. */
export function withoutTableCellBreaks(source: string): string {
  if (!source.includes('<')) return source
  return mapTableRows(source, (line) => line.replace(TABLE_CELL_BREAK, ' '))
}

/** Replaces table-cell `<br>`s with a parser-safe stand-in and remembers each spelling. */
export function maskTableCellBreaks(source: string): { source: string; breaks: string[] } {
  const breaks: string[] = []
  if (!source.includes('<')) return { source, breaks }
  const masked = mapTableRows(source, (line) =>
    line.replace(TABLE_CELL_BREAK, (raw) => {
      breaks.push(raw)
      return SENTINEL
    }),
  )
  return { source: masked, breaks }
}

/** Turns the stand-ins back into cellBreak nodes (or the original text without that node). */
export function restoreTableCellBreaks(
  document: JSONContent,
  breaks: string[],
  asNodes: boolean,
): JSONContent {
  if (!breaks.length) return document
  let index = 0
  const walk = (node: JSONContent): JSONContent => {
    if (!node.content) return node
    const content = node.content.flatMap((child): JSONContent[] => {
      if (child.type !== 'text' || !child.text?.includes(SENTINEL)) return [walk(child)]
      const parts = child.text.split(SENTINEL)
      const out: JSONContent[] = []
      parts.forEach((part, partIndex) => {
        if (partIndex > 0) {
          const raw = breaks[index++] ?? '<br>'
          out.push(asNodes ? { type: 'cellBreak', attrs: { raw } } : { ...child, text: raw })
        }
        if (part) out.push({ ...child, text: part })
      })
      return out
    })
    return { ...node, content }
  }
  return walk(document)
}

/** A line break inside a table cell, written back as the `<br>` it was read from. */
export const MarkdownCellBreak = Node.create({
  name: 'cellBreak',
  inline: true,
  group: 'inline',
  selectable: false,
  atom: true,

  addAttributes() {
    return { raw: { default: '<br>', rendered: false } }
  },

  parseHTML() {
    return []
  },

  renderHTML() {
    return ['br', { class: 'markdown-cell-break' }]
  },

  renderMarkdown(node) {
    return String(node.attrs?.raw ?? '<br>')
  },
})
