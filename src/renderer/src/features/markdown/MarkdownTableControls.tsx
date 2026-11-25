import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import {
  insertMarkdownTableColumnAt,
  insertMarkdownTableRowAt,
  markdownTableTarget,
  moveMarkdownTableColumn,
  moveMarkdownTableRow,
  selectMarkdownTableColumn,
  selectMarkdownTableRow,
  selectedMarkdownTable,
} from './markdown-table-ops'

/**
 * Feishu-style handles over the Markdown table under the pointer: column grips on top, a row
 * grip beside the hovered row, "+" insert points on row/column borders, and append bars below
 * and to the right. Grips select a row/column and open the shared table menu, or drag to
 * reorder. All edits go through markdown-table-ops, so the file stays a plain GFM table.
 */

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface TableGeometry {
  element: HTMLTableElement
  tablePos: number
  table: Box
  rows: Box[]
  columns: Box[]
}

interface Pointer {
  x: number
  y: number
}

type DragKind = 'row' | 'column'

interface DragState {
  kind: DragKind
  from: number
  start: Pointer
  moved: boolean
  /** The header row cannot move: pressing its grip only opens the menu. */
  draggable: boolean
  anchor: HTMLElement
}

interface MarkdownTableControlsProps {
  editor: Editor
  container: HTMLDivElement
  /** Open the shared editor context menu for the current (row/column) selection. */
  onOpenMenu: (x: number, y: number, anchor: HTMLElement) => void
}

const GUTTER = { left: 30, top: 24, right: 30, bottom: 30 }
const BORDER_HIT = 7
const DRAG_THRESHOLD = 4

function relativeBox(rect: DOMRect, container: HTMLDivElement): Box {
  const origin = container.getBoundingClientRect()
  return {
    left: rect.left - origin.left + container.scrollLeft,
    top: rect.top - origin.top + container.scrollTop,
    width: rect.width,
    height: rect.height,
  }
}

function tablePosition(editor: Editor, element: HTMLTableElement): number | null {
  let found: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.spec.tableRole !== 'table') return true
    const dom = editor.view.nodeDOM(pos)
    if (dom === element || (dom instanceof HTMLElement && dom.contains(element))) found = pos
    return false
  })
  return found
}

function measure(
  editor: Editor,
  container: HTMLDivElement,
  element: HTMLTableElement,
): TableGeometry | null {
  const tablePos = tablePosition(editor, element)
  if (tablePos === null) return null
  const rows = Array.from(element.rows)
  if (rows.length === 0) return null
  return {
    element,
    tablePos,
    table: relativeBox(element.getBoundingClientRect(), container),
    rows: rows.map((row) => relativeBox(row.getBoundingClientRect(), container)),
    columns: Array.from(rows[0].cells).map((cell) =>
      relativeBox(cell.getBoundingClientRect(), container),
    ),
  }
}

function toLocal(event: { clientX: number; clientY: number }, container: HTMLDivElement): Pointer {
  const origin = container.getBoundingClientRect()
  return {
    x: event.clientX - origin.left + container.scrollLeft,
    y: event.clientY - origin.top + container.scrollTop,
  }
}

function within(point: Pointer, box: Box): boolean {
  return (
    point.x >= box.left - GUTTER.left &&
    point.x <= box.left + box.width + GUTTER.right &&
    point.y >= box.top - GUTTER.top &&
    point.y <= box.top + box.height + GUTTER.bottom
  )
}

/** Border offsets: rows[i].top for i in 0..n plus the bottom edge (same for columns). */
function rowBorders(geometry: TableGeometry): number[] {
  return [...geometry.rows.map((row) => row.top), geometry.table.top + geometry.table.height]
}

function columnBorders(geometry: TableGeometry): number[] {
  return [
    ...geometry.columns.map((column) => column.left),
    geometry.table.left + geometry.table.width,
  ]
}

function nearestBorder(borders: number[], value: number, minIndex: number): number | null {
  let best: number | null = null
  borders.forEach((border, index) => {
    if (index < minIndex) return
    if (Math.abs(border - value) > BORDER_HIT) return
    if (best === null || Math.abs(border - value) < Math.abs(borders[best] - value)) best = index
  })
  return best
}

/** The border index a drag would drop at, for `from` being dragged to `value`. */
function dropBorder(borders: number[], value: number, minIndex: number): number {
  let best = minIndex
  borders.forEach((border, index) => {
    if (index < minIndex) return
    if (Math.abs(border - value) < Math.abs(borders[best] - value)) best = index
  })
  return best
}

function indexAt(boxes: Box[], value: number, axis: 'x' | 'y'): number | null {
  const index = boxes.findIndex((box) =>
    axis === 'y'
      ? value >= box.top && value < box.top + box.height
      : value >= box.left && value < box.left + box.width,
  )
  return index >= 0 ? index : null
}

export function MarkdownTableControls({
  editor,
  container,
  onOpenMenu,
}: MarkdownTableControlsProps): React.ReactElement | null {
  const [geometry, setGeometry] = useState<TableGeometry | null>(null)
  const [pointer, setPointer] = useState<Pointer | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [, setSelectionVersion] = useState(0)
  const geometryRef = useRef<TableGeometry | null>(null)
  const dragRef = useRef<DragState | null>(null)
  geometryRef.current = geometry
  dragRef.current = drag

  const refresh = useCallback(
    (element: HTMLTableElement | null) => {
      const next = element?.isConnected ? measure(editor, container, element) : null
      setGeometry(next)
      return next
    },
    [container, editor],
  )

  // Track which table the pointer is over (including its handle gutter).
  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      if (dragRef.current || !editor.isEditable) return
      const point = toLocal(event, container)
      const current = geometryRef.current
      if (current?.element.isConnected && within(point, current.table)) {
        setPointer(point)
        return
      }
      const tables = Array.from(editor.view.dom.querySelectorAll('table'))
      const hit = tables.find((table) =>
        within(point, relativeBox(table.getBoundingClientRect(), container)),
      )
      setPointer(hit ? point : null)
      refresh(hit ?? null)
    }
    const onLeave = (): void => {
      if (dragRef.current) return
      setPointer(null)
      setGeometry(null)
    }
    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
    }
  }, [container, editor, refresh])

  // Re-measure after edits (insert, move, typing that wraps) and keep grip highlights current.
  useEffect(() => {
    const onChange = (): void => {
      setSelectionVersion((version) => version + 1)
      const current = geometryRef.current
      if (!current) return
      if (current.element.isConnected) {
        refresh(current.element)
        return
      }
      // The table node was replaced (row/column move): find the table at the same position.
      const dom = editor.view.nodeDOM(current.tablePos)
      refresh(dom instanceof HTMLTableElement ? dom : null)
    }
    editor.on('update', onChange)
    editor.on('selectionUpdate', onChange)
    return () => {
      editor.off('update', onChange)
      editor.off('selectionUpdate', onChange)
    }
  }, [editor, refresh])

  const finishDrag = useCallback(
    (event: PointerEvent) => {
      const state = dragRef.current
      const current = geometryRef.current
      setDrag(null)
      dragRef.current = null
      if (!state || !current) return
      if (!state.moved) {
        const rect = state.anchor.getBoundingClientRect()
        onOpenMenu(rect.left, rect.bottom + 4, state.anchor)
        return
      }
      const point = toLocal(event, container)
      if (state.kind === 'row') {
        const border = dropBorder(rowBorders(current), point.y, 1)
        const to = border > state.from ? border - 1 : border
        moveMarkdownTableRow(editor, current.tablePos, state.from, to)
      } else {
        const border = dropBorder(columnBorders(current), point.x, 0)
        const to = border > state.from ? border - 1 : border
        moveMarkdownTableColumn(editor, current.tablePos, state.from, to)
      }
    },
    [container, editor, onOpenMenu],
  )

  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent): void => {
      const point = toLocal(event, container)
      setPointer(point)
      const state = dragRef.current
      if (!state || state.moved || !state.draggable) return
      if (
        Math.abs(point.x - state.start.x) > DRAG_THRESHOLD ||
        Math.abs(point.y - state.start.y) > DRAG_THRESHOLD
      ) {
        const next = { ...state, moved: true }
        dragRef.current = next
        setDrag(next)
      }
    }
    const onUp = (event: PointerEvent): void => finishDrag(event)
    const onCancel = (): void => {
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [container, drag, finishDrag])

  if (!geometry || !pointer || !editor.isEditable) return null

  const target = markdownTableTarget(editor.state)
  const selectedTable = selectedMarkdownTable(editor.state)
  const sameTable = selectedTable?.pos === geometry.tablePos
  const selectedRow = (row: number): boolean =>
    Boolean(
      sameTable &&
      (target?.scope === 'row' || target?.scope === 'table') &&
      row >= target.firstRow &&
      row <= target.lastRow,
    )
  const selectedColumn = (column: number): boolean =>
    Boolean(
      sameTable &&
      (target?.scope === 'column' || target?.scope === 'table') &&
      column >= target.firstColumn &&
      column <= target.lastColumn,
    )

  const { table } = geometry
  const hoveredRow = indexAt(geometry.rows, pointer.y, 'y')
  const visibleRowGrips = new Set<number>()
  if (hoveredRow !== null) visibleRowGrips.add(hoveredRow)
  geometry.rows.forEach((_, row) => {
    if (selectedRow(row)) visibleRowGrips.add(row)
  })

  const rowsB = rowBorders(geometry)
  const columnsB = columnBorders(geometry)
  const inLeftGutter = pointer.x < table.left + 8
  const inTopStrip = pointer.y < table.top + 6
  const rowInsert = !drag && inLeftGutter ? nearestBorder(rowsB, pointer.y, 1) : null
  const columnInsert = !drag && inTopStrip ? nearestBorder(columnsB, pointer.x, 0) : null

  let dropLine: React.CSSProperties | null = null
  if (drag?.moved) {
    if (drag.kind === 'row') {
      const border = dropBorder(rowsB, pointer.y, 1)
      dropLine = { left: table.left, top: rowsB[border] - 1, width: table.width, height: 2 }
    } else {
      const border = dropBorder(columnsB, pointer.x, 0)
      dropLine = { left: columnsB[border] - 1, top: table.top, width: 2, height: table.height }
    }
  }

  const startGrip = (kind: DragKind, index: number) => (event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (kind === 'row') selectMarkdownTableRow(editor, geometry.tablePos, index)
    else selectMarkdownTableColumn(editor, geometry.tablePos, index)
    const state: DragState = {
      kind,
      from: index,
      start: toLocal(event, container),
      moved: false,
      draggable: kind === 'column' || index > 0,
      anchor: event.currentTarget as HTMLElement,
    }
    dragRef.current = state
    setDrag(state)
  }

  const keepFocus = (event: React.MouseEvent): void => event.preventDefault()

  return (
    <div className="markdown-table-controls">
      {geometry.columns.map((column, index) => (
        <button
          key={`col-${index}`}
          type="button"
          className={`markdown-table-grip column${selectedColumn(index) ? ' active' : ''}`}
          style={{ left: column.left + column.width / 2 - 12, top: table.top - 13 }}
          aria-label={`选择第 ${index + 1} 列`}
          title="点击选择整列并打开菜单，拖动调整列顺序"
          onPointerDown={startGrip('column', index)}
          onMouseDown={keepFocus}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      ))}
      {[...visibleRowGrips].map((index) => {
        const row = geometry.rows[index]
        return (
          <button
            key={`row-${index}`}
            type="button"
            className={`markdown-table-grip row${selectedRow(index) ? ' active' : ''}`}
            style={{ left: table.left - 20, top: row.top + row.height / 2 - 12 }}
            aria-label={index === 0 ? '选择表头行' : `选择第 ${index} 行`}
            title={index === 0 ? '表头行：点击打开菜单' : '点击选择整行并打开菜单，拖动调整行顺序'}
            onPointerDown={startGrip('row', index)}
            onMouseDown={keepFocus}
          >
            <span aria-hidden="true">⋮⋮</span>
          </button>
        )
      })}
      {rowInsert !== null && (
        <>
          <div
            className="markdown-table-guide"
            style={{ left: table.left, top: rowsB[rowInsert] - 1, width: table.width, height: 2 }}
          />
          <button
            type="button"
            className="markdown-table-insert"
            style={{ left: table.left - 24, top: rowsB[rowInsert] - 8 }}
            aria-label="在此处插入一行"
            onMouseDown={keepFocus}
            onClick={() => insertMarkdownTableRowAt(editor, geometry.tablePos, rowInsert)}
          >
            +
          </button>
        </>
      )}
      {columnInsert !== null && (
        <>
          <div
            className="markdown-table-guide"
            style={{
              left: columnsB[columnInsert] - 1,
              top: table.top,
              width: 2,
              height: table.height,
            }}
          />
          <button
            type="button"
            className="markdown-table-insert"
            style={{ left: columnsB[columnInsert] - 8, top: table.top - 22 }}
            aria-label="在此处插入一列"
            onMouseDown={keepFocus}
            onClick={() => insertMarkdownTableColumnAt(editor, geometry.tablePos, columnInsert)}
          >
            +
          </button>
        </>
      )}
      {!drag && (
        <>
          <button
            type="button"
            className="markdown-table-append row"
            style={{ left: table.left, top: table.top + table.height + 3, width: table.width }}
            aria-label="新增一行"
            onMouseDown={keepFocus}
            onClick={() =>
              insertMarkdownTableRowAt(editor, geometry.tablePos, geometry.rows.length)
            }
          >
            + 新增一行
          </button>
          <button
            type="button"
            className="markdown-table-append column"
            style={{ left: table.left + table.width + 4, top: table.top, height: table.height }}
            aria-label="新增一列"
            onMouseDown={keepFocus}
            onClick={() =>
              insertMarkdownTableColumnAt(editor, geometry.tablePos, geometry.columns.length)
            }
          >
            +
          </button>
        </>
      )}
      {dropLine && <div className="markdown-table-drop-line" style={dropLine} />}
    </div>
  )
}
