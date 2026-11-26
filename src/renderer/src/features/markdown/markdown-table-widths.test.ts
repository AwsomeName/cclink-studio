import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { parseMarkdownEditorDocument } from './markdown-editor-document'
import { normalizeMarkdownEditorOutput } from './markdown-codec'
import {
  applyMarkdownTableColumnWidths,
  isMarkdownTableWidthOnlyChange,
  readMarkdownTableColumnWidths,
} from './markdown-table-widths'

const SOURCE = [
  '| 苹果账号 | claude账号 |',
  '| --- | --- |',
  '| a@example.com | b |',
  '',
  '正文',
  '',
  '| 事项 | 进展 | 计划 |',
  '| --- | --- | --- |',
  '| x | y | z |',
  '',
].join('\n')

let editor: Editor

beforeEach(() => {
  vi.stubGlobal('window', { HTMLUnknownElement: class {} })
  editor = new Editor({
    element: null,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    extensions: [StarterKit, Markdown, Table, TableRow, TableCell, TableHeader],
  })
  editor.commands.setContent(parseMarkdownEditorDocument(editor, SOURCE), { emitUpdate: false })
})

afterEach(() => {
  editor.destroy()
  vi.unstubAllGlobals()
})

/** What prosemirror-tables does when a column border is dragged: rewrite that column's cells. */
function dragColumn(table: number, column: number, width: number) {
  const tr = editor.state.tr
  let seen = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true
    seen += 1
    if (seen !== table) return false
    node.forEach((row, rowOffset) => {
      row.forEach((cell, cellOffset, index) => {
        if (index === column)
          tr.setNodeMarkup(pos + 1 + rowOffset + 1 + cellOffset, undefined, {
            ...cell.attrs,
            colwidth: [width],
          })
      })
    })
    return false
  })
  return tr
}

describe('remembered Markdown table column widths', () => {
  it('treats a column drag as view state and leaves the Markdown unchanged', () => {
    const tr = dragColumn(0, 0, 420)
    expect(isMarkdownTableWidthOnlyChange(tr)).toBe(true)
    editor.view.dispatch(tr)
    expect(readMarkdownTableColumnWidths(editor.state.doc)).toEqual([
      { index: 0, header: '苹果账号|claude账号', widths: [420, null] },
    ])
    expect(normalizeMarkdownEditorOutput(editor.getMarkdown(), SOURCE)).toBe(SOURCE)
  })

  it('does not treat typing as a width change', () => {
    const tr = editor.state.tr.insertText('改', 3)
    expect(isMarkdownTableWidthOnlyChange(tr)).toBe(false)
  })

  it('restores widths onto the matching table after reopening', () => {
    const remembered = [{ index: 1, header: '事项|进展|计划', widths: [null, 300, 120] }]
    const tr = editor.state.tr
    expect(applyMarkdownTableColumnWidths(tr, remembered)).toBe(true)
    editor.view.dispatch(tr)
    expect(readMarkdownTableColumnWidths(editor.state.doc)).toEqual(remembered)
  })

  it('falls back to position when the header text changed, and skips a changed column count', () => {
    const byPosition = [{ index: 0, header: '旧表头|旧表头', widths: [200, 100] }]
    const tr = editor.state.tr
    expect(applyMarkdownTableColumnWidths(tr, byPosition)).toBe(true)
    editor.view.dispatch(tr)
    expect(readMarkdownTableColumnWidths(editor.state.doc)[0].widths).toEqual([200, 100])

    const wrongColumns = [{ index: 1, header: '别的表', widths: [200, 100] }]
    expect(applyMarkdownTableColumnWidths(editor.state.tr, wrongColumns)).toBe(false)
  })
})
