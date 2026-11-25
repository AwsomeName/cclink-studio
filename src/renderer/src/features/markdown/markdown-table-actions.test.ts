import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { parseMarkdownEditorDocument } from './markdown-editor-document'
import {
  insertMarkdownTableColumnAt,
  insertMarkdownTableRowAt,
  markdownTableSelectionToTsv,
  moveMarkdownTableColumn,
  moveMarkdownTableRow,
  moveMarkdownTableCaretVertically,
  selectMarkdownTableColumn,
  selectMarkdownTableRow,
} from './markdown-table-ops'
import {
  deleteSelectedMarkdownTableRows,
  markdownTableContext,
  runMarkdownEditorAction,
} from './markdown-editor-shortcuts'

const SOURCE = [
  '前言',
  '',
  '| 事项 | 进展 |',
  '| --- | --- |',
  '| 统一账号 | 已推进 |',
  '|  |  |',
  '| 外壳 | 已核对 |',
].join('\n')

let editor: Editor

/** Positions of each cell's paragraph content, row by row. */
function cellPositions(): number[][] {
  const rows: number[][] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableRow') rows.push([])
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      rows[rows.length - 1].push(pos)
    }
    return true
  })
  return rows
}

function caretIn(row: number, col = 0): void {
  const cell = cellPositions()[row][col]
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(cell + 1))),
  )
}

function selectRow(row: number): void {
  const cells = cellPositions()[row]
  editor.view.dispatch(
    editor.state.tr.setSelection(
      CellSelection.create(editor.state.doc, cells[0], cells[cells.length - 1]),
    ),
  )
}

function bodyRows(): string[] {
  return editor
    .getMarkdown()
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.replace(/\s+/g, ' ').trim())
}

beforeEach(() => {
  vi.stubGlobal('window', { HTMLUnknownElement: class {} })
  editor = new Editor({
    element: null,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown,
      Table,
      TableRow,
      TableCell,
      TableHeader,
    ],
  })
  editor.commands.setContent(parseMarkdownEditorDocument(editor, SOURCE), { emitUpdate: false })
  // Headless (no DOM): focus() cannot succeed, so let that chain step pass as it does in the app.
  const manager = (
    editor as unknown as { commandManager: { rawCommands: Record<string, unknown> } }
  ).commandManager
  manager.rawCommands.focus = () => () => true
})

afterEach(() => {
  editor.destroy()
  vi.unstubAllGlobals()
})

describe('Markdown table row actions', () => {
  it('reports where the caret is in a table', () => {
    editor.commands.setTextSelection(1)
    expect(markdownTableContext(editor)).toBeNull()
    caretIn(0)
    expect(markdownTableContext(editor)).toMatchObject({ headerRow: true, scope: 'caret' })
    caretIn(2, 1)
    expect(markdownTableContext(editor)).toMatchObject({
      headerRow: false,
      scope: 'caret',
      firstRow: 2,
      firstColumn: 1,
      rowCount: 4,
      columnCount: 2,
    })
    selectRow(2)
    expect(markdownTableContext(editor)).toMatchObject({ scope: 'row', firstRow: 2 })
  })

  it('deletes the body row holding the caret', () => {
    expect(cellPositions()).toHaveLength(4)
    caretIn(2)
    expect(runMarkdownEditorAction(editor, 'table-delete-row', () => false)).toBe(true)
    expect(cellPositions()).toHaveLength(3)
    expect(bodyRows().some((line) => /^\| \|/.test(line))).toBe(false)
    expect(editor.getMarkdown()).toContain('外壳')
  })

  it('keeps the header row and only drops it with the whole table', () => {
    caretIn(0)
    expect(runMarkdownEditorAction(editor, 'table-delete-row', () => false)).toBe(false)
    expect(cellPositions()).toHaveLength(4)
    expect(runMarkdownEditorAction(editor, 'table-delete', () => false)).toBe(true)
    expect(cellPositions()).toHaveLength(0)
    expect(editor.getMarkdown()).toContain('前言')
  })

  it('inserts rows above and below and deletes a column', () => {
    caretIn(1)
    expect(runMarkdownEditorAction(editor, 'table-add-row-before', () => false)).toBe(true)
    expect(runMarkdownEditorAction(editor, 'table-add-row-after', () => false)).toBe(true)
    expect(cellPositions()).toHaveLength(6)
    expect(runMarkdownEditorAction(editor, 'table-delete-column', () => false)).toBe(true)
    expect(cellPositions()[0]).toHaveLength(1)
  })

  it('deletes whole selected body rows on Backspace/Delete instead of only clearing them', () => {
    selectRow(2)
    expect(deleteSelectedMarkdownTableRows(editor)).toBe(true)
    expect(cellPositions()).toHaveLength(3)
  })

  it('leaves partial or header selections to the default key handling', () => {
    selectRow(0)
    expect(deleteSelectedMarkdownTableRows(editor)).toBe(false)
    caretIn(1)
    expect(deleteSelectedMarkdownTableRows(editor)).toBe(false)
    expect(cellPositions()).toHaveLength(4)
  })
})

function tablePos(): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table' && found < 0) found = pos
    return found < 0
  })
  return found
}

function firstColumnTexts(): string[] {
  return bodyRows()
    .filter((line) => !/^\| :?-/.test(line))
    .map((line) => line.split('|')[1].trim())
}

describe('Markdown table grip operations', () => {
  it('inserts rows and columns at border positions, never above the header', () => {
    expect(insertMarkdownTableRowAt(editor, tablePos(), 0)).toBe(false)
    expect(insertMarkdownTableRowAt(editor, tablePos(), 1)).toBe(true)
    expect(firstColumnTexts()).toEqual(['事项', '', '统一账号', '', '外壳'])
    expect(insertMarkdownTableRowAt(editor, tablePos(), 5)).toBe(true)
    expect(cellPositions()).toHaveLength(6)
    expect(insertMarkdownTableColumnAt(editor, tablePos(), 0)).toBe(true)
    expect(cellPositions()[0]).toHaveLength(3)
    expect(editor.state.doc.nodeAt(cellPositions()[0][0])?.type.name).toBe('tableHeader')
    expect(editor.state.doc.nodeAt(cellPositions()[1][0])?.type.name).toBe('tableCell')
  })

  it('moves body rows but never the header or above it', () => {
    expect(moveMarkdownTableRow(editor, tablePos(), 3, 1)).toBe(true)
    expect(firstColumnTexts()).toEqual(['事项', '外壳', '统一账号', ''])
    expect(moveMarkdownTableRow(editor, tablePos(), 1, 0)).toBe(false)
    expect(moveMarkdownTableRow(editor, tablePos(), 0, 2)).toBe(false)
  })

  it('moves the caret row with Alt+Up/Down and keeps the caret in it', () => {
    caretIn(3)
    expect(runMarkdownEditorAction(editor, 'table-move-row-up', () => false)).toBe(true)
    expect(firstColumnTexts()).toEqual(['事项', '统一账号', '外壳', ''])
    expect(markdownTableContext(editor)).toMatchObject({ scope: 'caret', firstRow: 2 })
  })

  it('moves a column with its alignment and writes alignment to the delimiter row', () => {
    selectMarkdownTableColumn(editor, tablePos(), 1)
    expect(runMarkdownEditorAction(editor, 'table-align-center', () => false)).toBe(true)
    expect(editor.getMarkdown()).toMatch(/\| -{3,} \| :-{3,}: \|/)
    expect(markdownTableContext(editor)).toMatchObject({ scope: 'column', align: 'center' })
    expect(moveMarkdownTableColumn(editor, tablePos(), 1, 0)).toBe(true)
    expect(editor.getMarkdown()).toMatch(/\| :-{3,}: \| -{3,} \|/)
    expect(editor.getMarkdown()).toMatch(/\| 进展\s*\| 事项\s*\|/)
  })

  it('duplicates a body row below itself and clears a row without removing it', () => {
    selectMarkdownTableRow(editor, tablePos(), 1)
    expect(runMarkdownEditorAction(editor, 'table-duplicate-row', () => false)).toBe(true)
    expect(firstColumnTexts()).toEqual(['事项', '统一账号', '统一账号', '', '外壳'])
    selectMarkdownTableRow(editor, tablePos(), 0)
    expect(runMarkdownEditorAction(editor, 'table-duplicate-row', () => false)).toBe(false)
    selectMarkdownTableRow(editor, tablePos(), 4)
    expect(runMarkdownEditorAction(editor, 'table-clear-cells', () => false)).toBe(true)
    expect(firstColumnTexts()).toEqual(['事项', '统一账号', '统一账号', '', ''])
  })

  it('deletes a selected column on Backspace but only clears a partial range', () => {
    selectMarkdownTableColumn(editor, tablePos(), 1)
    expect(deleteSelectedMarkdownTableRows(editor)).toBe(true)
    expect(cellPositions()[0]).toHaveLength(1)
  })

  it('Enter moves down a cell and grows the table from the last row; Shift+Enter moves up', () => {
    caretIn(2, 1)
    expect(moveMarkdownTableCaretVertically(editor, 1)).toBe(true)
    expect(markdownTableContext(editor)).toMatchObject({ firstRow: 3, firstColumn: 1 })
    expect(moveMarkdownTableCaretVertically(editor, 1)).toBe(true)
    expect(cellPositions()).toHaveLength(5)
    expect(markdownTableContext(editor)).toMatchObject({ firstRow: 4, firstColumn: 1 })
    expect(moveMarkdownTableCaretVertically(editor, -1)).toBe(true)
    expect(markdownTableContext(editor)).toMatchObject({ firstRow: 3 })
    editor.commands.setTextSelection(1)
    expect(moveMarkdownTableCaretVertically(editor, 1)).toBe(false)
  })

  it('copies a cell range as tab-separated rows', () => {
    const cells = cellPositions()
    editor.view.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, cells[0][0], cells[1][1]),
      ),
    )
    expect(markdownTableSelectionToTsv(editor.state)).toBe('事项\t进展\n统一账号\t已推进')
    caretIn(1)
    expect(markdownTableSelectionToTsv(editor.state)).toBeNull()
  })
})
