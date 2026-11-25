import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Selection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { CellSelection, TableMap, deleteCellSelection } from '@tiptap/pm/tables'

/**
 * Table edits for the Markdown editor. Every operation keeps the table a plain GFM table: the
 * header stays the first row, cells hold one line of text, and only column alignment is
 * stored. Merges, widths and colors are never produced because Markdown cannot keep them.
 */

export type MarkdownTableAlign = 'left' | 'center' | 'right'

export interface MarkdownTableTarget {
  /** The selection touches the header row. */
  headerRow: boolean
  /** caret: text cursor in a cell; row/column: whole rows/columns; cells: any other range. */
  scope: 'caret' | 'row' | 'column' | 'cells' | 'table'
  firstRow: number
  lastRow: number
  firstColumn: number
  lastColumn: number
  rowCount: number
  columnCount: number
  /** Alignment of the first selected column. */
  align: MarkdownTableAlign | null
}

interface TableHit {
  table: ProseMirrorNode
  /** Position before the table node. */
  pos: number
  map: TableMap
}

function findTableAround(state: EditorState, pos: number): TableHit | null {
  const $pos = state.doc.resolve(Math.min(Math.max(pos, 0), state.doc.content.size))
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.spec.tableRole === 'table') {
      const tablePos = depth === 0 ? 0 : $pos.before(depth)
      return { table: node, pos: tablePos, map: TableMap.get(node) }
    }
  }
  return null
}

/** The table at `tablePos` (the position before the table node), or null. */
export function markdownTableAt(state: EditorState, tablePos: number): TableHit | null {
  const node = state.doc.nodeAt(tablePos)
  if (!node || node.type.spec.tableRole !== 'table') return null
  return { table: node, pos: tablePos, map: TableMap.get(node) }
}

/** The table holding the selection, if any. */
export function selectedMarkdownTable(state: EditorState): TableHit | null {
  const { selection } = state
  const anchor = selection instanceof CellSelection ? selection.$anchorCell.pos : selection.from
  const hit = findTableAround(state, anchor + (selection instanceof CellSelection ? 1 : 0))
  if (!hit) return null
  if (!(selection instanceof CellSelection)) {
    const end = findTableAround(state, selection.to)
    if (end?.pos !== hit.pos) return null
  }
  return hit
}

function cellPos(hit: TableHit, row: number, column: number): number {
  return hit.pos + 1 + hit.map.map[row * hit.map.width + column]
}

function cellAlign(node: ProseMirrorNode | null | undefined): MarkdownTableAlign | null {
  const align = node?.attrs.align
  return align === 'left' || align === 'center' || align === 'right' ? align : null
}

function selectedRectangle(
  state: EditorState,
  hit: TableHit,
): { top: number; bottom: number; left: number; right: number } {
  const { selection } = state
  if (selection instanceof CellSelection) {
    const rect = hit.map.rectBetween(
      selection.$anchorCell.pos - hit.pos - 1,
      selection.$headCell.pos - hit.pos - 1,
    )
    return { top: rect.top, bottom: rect.bottom - 1, left: rect.left, right: rect.right - 1 }
  }
  const $from = selection.$from
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') {
      const rect = hit.map.findCell($from.before(depth) - hit.pos - 1)
      return { top: rect.top, bottom: rect.top, left: rect.left, right: rect.left }
    }
  }
  return { top: 0, bottom: 0, left: 0, right: 0 }
}

/** Where the selection sits in a Markdown table, or null outside one. */
export function markdownTableTarget(state: EditorState): MarkdownTableTarget | null {
  const hit = selectedMarkdownTable(state)
  if (!hit) return null
  const rect = selectedRectangle(state, hit)
  const { selection } = state
  let scope: MarkdownTableTarget['scope'] = 'caret'
  if (selection instanceof CellSelection) {
    const rows = selection.isRowSelection()
    const columns = selection.isColSelection()
    scope = rows && columns ? 'table' : rows ? 'row' : columns ? 'column' : 'cells'
  }
  return {
    headerRow: rect.top === 0,
    scope,
    firstRow: rect.top,
    lastRow: rect.bottom,
    firstColumn: rect.left,
    lastColumn: rect.right,
    rowCount: hit.map.height,
    columnCount: hit.map.width,
    align: cellAlign(state.doc.nodeAt(cellPos(hit, 0, rect.left))),
  }
}

function caretInCell(tr: Transaction, hit: TableHit, row: number, column: number): void {
  const pos = cellPos(hit, row, column)
  const cell = tr.doc.nodeAt(pos)
  const end = pos + (cell?.nodeSize ?? 2) - 1
  tr.setSelection(Selection.near(tr.doc.resolve(end), -1))
}

function freshHit(tr: Transaction, tablePos: number): TableHit | null {
  const node = tr.doc.nodeAt(tablePos)
  if (!node || node.type.spec.tableRole !== 'table') return null
  return { table: node, pos: tablePos, map: TableMap.get(node) }
}

function emptyRowLike(row: ProseMirrorNode): ProseMirrorNode {
  const cells: ProseMirrorNode[] = []
  row.forEach((cell) => {
    cells.push(cell.type.createAndFill({ ...cell.attrs }) ?? cell.type.create())
  })
  return row.type.create(row.attrs, cells)
}

function bodyCellLike(hit: TableHit, sample: ProseMirrorNode): ProseMirrorNode {
  // A new body cell is a plain cell even when the only row is the header.
  const schema = hit.table.type.schema
  const type = schema.nodes.tableCell ?? sample.type
  return type.createAndFill({ ...sample.attrs, align: cellAlign(sample) }) ?? type.create()
}

function dispatchEdit(editor: Editor, build: (tr: Transaction) => boolean): boolean {
  if (!editor.isEditable) return false
  const tr = editor.state.tr
  if (!build(tr)) return false
  editor.view.dispatch(tr.scrollIntoView())
  editor.commands.focus(null, { scrollIntoView: false })
  return true
}

/** Select whole row `row` of the table at `tablePos`. */
export function selectMarkdownTableRow(editor: Editor, tablePos: number, row: number): boolean {
  const hit = markdownTableAt(editor.state, tablePos)
  if (!hit || row < 0 || row >= hit.map.height) return false
  const tr = editor.state.tr.setSelection(
    CellSelection.rowSelection(
      editor.state.doc.resolve(cellPos(hit, row, 0)),
      editor.state.doc.resolve(cellPos(hit, row, hit.map.width - 1)),
    ),
  )
  editor.view.dispatch(tr)
  editor.commands.focus(null, { scrollIntoView: false })
  return true
}

/** Select whole column `column` of the table at `tablePos`. */
export function selectMarkdownTableColumn(
  editor: Editor,
  tablePos: number,
  column: number,
): boolean {
  const hit = markdownTableAt(editor.state, tablePos)
  if (!hit || column < 0 || column >= hit.map.width) return false
  const tr = editor.state.tr.setSelection(
    CellSelection.colSelection(
      editor.state.doc.resolve(cellPos(hit, 0, column)),
      editor.state.doc.resolve(cellPos(hit, hit.map.height - 1, column)),
    ),
  )
  editor.view.dispatch(tr)
  editor.commands.focus(null, { scrollIntoView: false })
  return true
}

/**
 * Insert an empty body row so that it becomes row `index` (1 = right below the header; the
 * row count appends). The caret lands in its first cell.
 */
export function insertMarkdownTableRowAt(editor: Editor, tablePos: number, index: number): boolean {
  return dispatchEdit(editor, (tr) => {
    const hit = freshHit(tr, tablePos)
    if (!hit || index < 1 || index > hit.map.height) return false
    const sampleRow = hit.table.child(Math.max(1, Math.min(index, hit.map.height - 1)))
    const row =
      index === 1 && hit.map.height === 1
        ? hit.table.type.schema.nodes.tableRow.create(
            null,
            Array.from({ length: hit.map.width }, (_, column) =>
              bodyCellLike(hit, hit.table.child(0).child(column)),
            ),
          )
        : emptyRowLike(sampleRow)
    let insertAt = tablePos + 1
    for (let r = 0; r < index; r += 1) insertAt += hit.table.child(r).nodeSize
    tr.insert(insertAt, row)
    const next = freshHit(tr, tablePos)
    if (next) caretInCell(tr, next, index, 0)
    return true
  })
}

/** Insert an empty column so that it becomes column `index` (the column count appends). */
export function insertMarkdownTableColumnAt(
  editor: Editor,
  tablePos: number,
  index: number,
): boolean {
  return dispatchEdit(editor, (tr) => {
    const hit = freshHit(tr, tablePos)
    if (!hit || index < 0 || index > hit.map.width) return false
    // Insert bottom-up so earlier positions stay valid.
    for (let row = hit.map.height - 1; row >= 0; row -= 1) {
      const rowNode = hit.table.child(row)
      const sample = rowNode.child(Math.min(index, hit.map.width - 1))
      const cell =
        sample.type.createAndFill({ ...sample.attrs, align: null }) ?? sample.type.create()
      const at =
        index === hit.map.width
          ? cellPos(hit, row, hit.map.width - 1) + rowNode.child(hit.map.width - 1).nodeSize
          : cellPos(hit, row, index)
      tr.insert(at, cell)
    }
    const next = freshHit(tr, tablePos)
    if (next) caretInCell(tr, next, Math.min(1, next.map.height - 1), index)
    return true
  })
}

function rebuildTable(
  tr: Transaction,
  hit: TableHit,
  rows: ProseMirrorNode[],
): ProseMirrorNode | null {
  const table = hit.table.type.create(hit.table.attrs, rows)
  tr.replaceWith(hit.pos, hit.pos + hit.table.nodeSize, table)
  return table
}

/**
 * Move body row `from` to index `to`. The header row never moves and nothing goes above it.
 * `select` re-selects the moved row; otherwise the caret follows it.
 */
export function moveMarkdownTableRow(
  editor: Editor,
  tablePos: number,
  from: number,
  to: number,
  select = true,
  caretColumn = 0,
): boolean {
  return dispatchEdit(editor, (tr) => {
    const hit = freshHit(tr, tablePos)
    if (!hit || from < 1 || to < 1 || from >= hit.map.height || to >= hit.map.height) return false
    if (from === to) return false
    const rows: ProseMirrorNode[] = []
    hit.table.forEach((row) => rows.push(row))
    const [moved] = rows.splice(from, 1)
    rows.splice(to, 0, moved)
    rebuildTable(tr, hit, rows)
    const next = freshHit(tr, tablePos)
    if (!next) return true
    if (select) {
      tr.setSelection(
        CellSelection.rowSelection(
          tr.doc.resolve(cellPos(next, to, 0)),
          tr.doc.resolve(cellPos(next, to, next.map.width - 1)),
        ),
      )
    } else {
      caretInCell(tr, next, to, Math.min(caretColumn, next.map.width - 1))
    }
    return true
  })
}

/** Move column `from` to index `to`, keeping each column's alignment with it. */
export function moveMarkdownTableColumn(
  editor: Editor,
  tablePos: number,
  from: number,
  to: number,
  select = true,
): boolean {
  return dispatchEdit(editor, (tr) => {
    const hit = freshHit(tr, tablePos)
    if (!hit || from < 0 || to < 0 || from >= hit.map.width || to >= hit.map.width) return false
    if (from === to) return false
    const rows: ProseMirrorNode[] = []
    hit.table.forEach((row) => {
      const cells: ProseMirrorNode[] = []
      row.forEach((cell) => cells.push(cell))
      const [moved] = cells.splice(from, 1)
      cells.splice(to, 0, moved)
      rows.push(row.type.create(row.attrs, cells))
    })
    rebuildTable(tr, hit, rows)
    const next = freshHit(tr, tablePos)
    if (next && select) {
      tr.setSelection(
        CellSelection.colSelection(
          tr.doc.resolve(cellPos(next, 0, to)),
          tr.doc.resolve(cellPos(next, next.map.height - 1, to)),
        ),
      )
    }
    return true
  })
}

/** Move the selected body row (or the caret's row) one step up or down. */
export function moveSelectedMarkdownTableRow(editor: Editor, direction: -1 | 1): boolean {
  const hit = selectedMarkdownTable(editor.state)
  const target = markdownTableTarget(editor.state)
  if (!hit || !target || target.firstRow !== target.lastRow) return false
  if (target.scope !== 'caret' && target.scope !== 'row') return false
  return moveMarkdownTableRow(
    editor,
    hit.pos,
    target.firstRow,
    target.firstRow + direction,
    target.scope === 'row',
    target.firstColumn,
  )
}

/** Move the selected column one step left or right. */
export function moveSelectedMarkdownTableColumn(editor: Editor, direction: -1 | 1): boolean {
  const hit = selectedMarkdownTable(editor.state)
  const target = markdownTableTarget(editor.state)
  if (!hit || !target || target.firstColumn !== target.lastColumn) return false
  return moveMarkdownTableColumn(
    editor,
    hit.pos,
    target.firstColumn,
    target.firstColumn + direction,
    target.scope === 'column',
  )
}

/** Copy the selected body row (or the caret's row) right below itself. */
export function duplicateSelectedMarkdownTableRow(editor: Editor): boolean {
  const hit = selectedMarkdownTable(editor.state)
  const target = markdownTableTarget(editor.state)
  if (!hit || !target || target.firstRow < 1) return false
  return dispatchEdit(editor, (tr) => {
    const row = hit.table.child(target.lastRow)
    let insertAt = hit.pos + 1
    for (let r = 0; r <= target.lastRow; r += 1) insertAt += hit.table.child(r).nodeSize
    tr.insert(insertAt, row.copy(row.content))
    const next = freshHit(tr, hit.pos)
    if (next) {
      tr.setSelection(
        CellSelection.rowSelection(
          tr.doc.resolve(cellPos(next, target.lastRow + 1, 0)),
          tr.doc.resolve(cellPos(next, target.lastRow + 1, next.map.width - 1)),
        ),
      )
    }
    return true
  })
}

/** Set the Markdown alignment of every selected column (written as `:---`, `:---:`, `---:`). */
export function setMarkdownTableColumnAlign(editor: Editor, align: MarkdownTableAlign): boolean {
  const hit = selectedMarkdownTable(editor.state)
  const target = markdownTableTarget(editor.state)
  if (!hit || !target) return false
  return dispatchEdit(editor, (tr) => {
    for (let row = 0; row < hit.map.height; row += 1) {
      for (let column = target.firstColumn; column <= target.lastColumn; column += 1) {
        const pos = cellPos(hit, row, column)
        const cell = tr.doc.nodeAt(pos)
        if (cell) tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align })
      }
    }
    return true
  })
}

/** Empty the selected cells, keeping rows and columns. */
export function clearSelectedMarkdownTableCells(editor: Editor): boolean {
  if (!editor.isEditable || !(editor.state.selection instanceof CellSelection)) return false
  const done = deleteCellSelection(editor.state, (tr) => editor.view.dispatch(tr))
  if (done) editor.commands.focus(null, { scrollIntoView: false })
  // Already-empty cells are a successful no-op.
  return true
}

/**
 * Enter moves to the cell below (and grows the table from the last row); Shift+Enter moves
 * up. A GFM cell cannot hold a line break, so Enter never splits a cell.
 */
export function moveMarkdownTableCaretVertically(editor: Editor, direction: -1 | 1): boolean {
  const { selection } = editor.state
  if (selection instanceof CellSelection) return false
  const hit = selectedMarkdownTable(editor.state)
  const target = markdownTableTarget(editor.state)
  if (!hit || !target) return false
  const row = target.firstRow + direction
  if (row < 0) return true
  if (row >= hit.map.height) {
    if (!editor.isEditable) return true
    return insertMarkdownTableRowAt(editor, hit.pos, hit.map.height)
      ? moveCaretToColumn(editor, hit.pos, row, target.firstColumn)
      : true
  }
  return moveCaretToColumn(editor, hit.pos, row, target.firstColumn)
}

function moveCaretToColumn(editor: Editor, tablePos: number, row: number, column: number): boolean {
  const tr = editor.state.tr
  const hit = freshHit(tr, tablePos)
  if (!hit) return true
  caretInCell(tr, hit, row, Math.min(column, hit.map.width - 1))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

/** The selected cells as tab-separated text, so a paste into Feishu or Excel keeps the grid. */
export function markdownTableSelectionToTsv(state: EditorState): string | null {
  const { selection } = state
  if (!(selection instanceof CellSelection)) return null
  const hit = selectedMarkdownTable(state)
  if (!hit) return null
  const rect = selectedRectangle(state, hit)
  const lines: string[] = []
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    const cells: string[] = []
    for (let column = rect.left; column <= rect.right; column += 1) {
      const cell = state.doc.nodeAt(cellPos(hit, row, column))
      cells.push((cell?.textBetween(0, cell.content.size, ' ', ' ') ?? '').replace(/\s+/g, ' '))
    }
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

/** Put the caret into the first cell of `row` (used after appending from the overlay). */
export function placeCaretInMarkdownTableCell(
  editor: Editor,
  tablePos: number,
  row: number,
  column: number,
): void {
  const tr = editor.state.tr
  const hit = freshHit(tr, tablePos)
  if (!hit) return
  caretInCell(tr, hit, Math.min(row, hit.map.height - 1), Math.min(column, hit.map.width - 1))
  editor.view.dispatch(tr)
  editor.commands.focus(null, { scrollIntoView: false })
}
