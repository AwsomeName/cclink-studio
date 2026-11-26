import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { AttrStep, ReplaceAroundStep } from '@tiptap/pm/transform'

/**
 * Markdown tables have no column widths, so a width the user drags is remembered by Studio on
 * this machine (beside the scroll position) and never written to the file. A table is matched by
 * its header text and column count; if those changed, by its position and column count; with
 * neither, it falls back to automatic widths.
 */
export interface MarkdownTableColumnWidths {
  /** Position of the table among the document's tables. */
  index: number
  /** Header cell texts, joined; the primary identity of the table. */
  header: string
  /** One entry per column; null keeps that column automatic. */
  widths: Array<number | null>
}

const MAX_REMEMBERED_TABLES = 50

function isTable(node: ProseMirrorNode): boolean {
  return node.type.name === 'table'
}

function columnWidths(table: ProseMirrorNode): Array<number | null> {
  const widths: Array<number | null> = []
  table.firstChild?.forEach((cell) => {
    const colspan = Number(cell.attrs.colspan ?? 1) || 1
    const colwidth = Array.isArray(cell.attrs.colwidth) ? cell.attrs.colwidth : null
    for (let index = 0; index < colspan; index += 1) {
      const width = colwidth?.[index]
      widths.push(typeof width === 'number' && width > 0 ? Math.round(width) : null)
    }
  })
  return widths
}

function headerText(table: ProseMirrorNode): string {
  const texts: string[] = []
  table.firstChild?.forEach((cell) => texts.push(cell.textContent.trim()))
  return texts.join('|')
}

/** The dragged widths of every table that has any, in document order. */
export function readMarkdownTableColumnWidths(doc: ProseMirrorNode): MarkdownTableColumnWidths[] {
  const tables: MarkdownTableColumnWidths[] = []
  let index = 0
  doc.descendants((node) => {
    if (!isTable(node)) return true
    const widths = columnWidths(node)
    if (widths.some((width) => width !== null)) {
      tables.push({ index, header: headerText(node), widths })
    }
    index += 1
    return false
  })
  return tables.slice(0, MAX_REMEMBERED_TABLES)
}

/** Put remembered widths back on the matching tables. Returns whether anything changed. */
export function applyMarkdownTableColumnWidths(
  tr: Transaction,
  remembered: readonly MarkdownTableColumnWidths[],
): boolean {
  if (remembered.length === 0) return false
  const used = new Set<MarkdownTableColumnWidths>()
  const targets: Array<{ pos: number; node: ProseMirrorNode; widths: Array<number | null> }> = []
  let index = 0
  tr.doc.descendants((node, pos) => {
    if (!isTable(node)) return true
    const columns = columnWidths(node).length
    const header = headerText(node)
    const match =
      remembered.find(
        (entry) => !used.has(entry) && entry.header === header && entry.widths.length === columns,
      ) ??
      remembered.find(
        (entry) => !used.has(entry) && entry.index === index && entry.widths.length === columns,
      )
    if (match) {
      used.add(match)
      targets.push({ pos, node, widths: match.widths })
    }
    index += 1
    return false
  })
  let changed = false
  for (const { pos, node, widths } of targets) {
    node.forEach((row, rowOffset) => {
      let column = 0
      row.forEach((cell, cellOffset) => {
        const colspan = Number(cell.attrs.colspan ?? 1) || 1
        const slice = widths.slice(column, column + colspan)
        column += colspan
        const colwidth = slice.every((width) => width === null)
          ? null
          : slice.map((width) => width ?? 0)
        if (JSON.stringify(cell.attrs.colwidth ?? null) === JSON.stringify(colwidth)) return
        const cellPos = tr.mapping.map(pos + 1 + rowOffset + 1 + cellOffset)
        tr.setNodeMarkup(cellPos, undefined, { ...cell.attrs, colwidth })
        changed = true
      })
    })
  }
  return changed
}

function withoutColumnWidths(doc: ProseMirrorNode): unknown {
  const json = doc.toJSON() as { attrs?: Record<string, unknown>; content?: unknown[] }
  const strip = (node: { attrs?: Record<string, unknown>; content?: unknown[] }): unknown => ({
    ...node,
    ...(node.attrs ? { attrs: { ...node.attrs, colwidth: null } } : {}),
    ...(node.content ? { content: node.content.map((child) => strip(child as typeof node)) } : {}),
  })
  return strip(json)
}

/**
 * A column drag only rewrites cell attributes (ReplaceAroundStep via setNodeMarkup). Such a
 * transaction is view state: it must not mark the document modified or reach the file.
 */
export function isMarkdownTableWidthOnlyChange(tr: Transaction): boolean {
  if (!tr.docChanged || tr.steps.length === 0) return false
  if (!tr.steps.every((step) => step instanceof ReplaceAroundStep || step instanceof AttrStep))
    return false
  return (
    JSON.stringify(withoutColumnWidths(tr.before)) === JSON.stringify(withoutColumnWidths(tr.doc))
  )
}
