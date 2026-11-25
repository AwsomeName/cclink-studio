import type { MarkdownTableTarget } from '../../markdown/markdown-table-ops'
import type { MarkdownEditorAction } from '../editor-context-surface'

/**
 * The Markdown table commands behind the cell right-click menu and the row/column grip menus.
 * The grips select a row or column first, so the same commands serve both entries; `scopes`
 * decides which selection shows which command.
 */
export interface MarkdownTableCommandSpec {
  id: string
  label: string
  action: MarkdownEditorAction
  group: string
  scopes: ReadonlyArray<MarkdownTableTarget['scope']>
  shortcut?: string
  destructive?: boolean
  /** Reason the command cannot run on this selection, or null when it can. */
  blocked?: (table: MarkdownTableTarget) => string | null
  checked?: (table: MarkdownTableTarget) => boolean
}

const HEADER_REASON = 'Markdown 表格必须有表头，可删除整个表格'
const ROW_GROUP = '30-table-row'
const COLUMN_GROUP = '31-table-column'
const TABLE_GROUP = '32-table'

const headerBlocked = (table: MarkdownTableTarget): string | null =>
  table.headerRow ? HEADER_REASON : null

export const MARKDOWN_TABLE_COMMANDS: MarkdownTableCommandSpec[] = [
  {
    id: 'markdown.table.addRowBefore',
    label: '在上方插入行',
    action: 'table-add-row-before',
    group: ROW_GROUP,
    scopes: ['caret', 'row'],
    blocked: (table) => (table.headerRow ? '表头必须是第一行' : null),
  },
  {
    id: 'markdown.table.addRowAfter',
    label: '在下方插入行',
    action: 'table-add-row-after',
    group: ROW_GROUP,
    scopes: ['caret', 'row'],
  },
  {
    id: 'markdown.table.duplicateRow',
    label: '复制此行到下方',
    action: 'table-duplicate-row',
    group: ROW_GROUP,
    scopes: ['row'],
    blocked: headerBlocked,
  },
  {
    id: 'markdown.table.moveRowUp',
    label: '上移',
    action: 'table-move-row-up',
    group: ROW_GROUP,
    scopes: ['row'],
    shortcut: 'Alt+ArrowUp',
    blocked: (table) =>
      table.headerRow ? HEADER_REASON : table.firstRow <= 1 ? '已在表头下第一行' : null,
  },
  {
    id: 'markdown.table.moveRowDown',
    label: '下移',
    action: 'table-move-row-down',
    group: ROW_GROUP,
    scopes: ['row'],
    shortcut: 'Alt+ArrowDown',
    blocked: (table) =>
      table.headerRow ? HEADER_REASON : table.lastRow >= table.rowCount - 1 ? '已是最后一行' : null,
  },
  {
    id: 'markdown.table.clearRow',
    label: '清空此行内容',
    action: 'table-clear-cells',
    group: ROW_GROUP,
    scopes: ['row'],
  },
  {
    id: 'markdown.table.deleteRow',
    label: '删除行',
    action: 'table-delete-row',
    group: ROW_GROUP,
    scopes: ['caret', 'row'],
    shortcut: 'Backspace',
    destructive: true,
    blocked: headerBlocked,
  },
  {
    id: 'markdown.table.addColumnBefore',
    label: '在左侧插入列',
    action: 'table-add-column-before',
    group: COLUMN_GROUP,
    scopes: ['caret', 'column'],
  },
  {
    id: 'markdown.table.addColumnAfter',
    label: '在右侧插入列',
    action: 'table-add-column-after',
    group: COLUMN_GROUP,
    scopes: ['caret', 'column'],
  },
  {
    id: 'markdown.table.alignLeft',
    label: '左对齐',
    action: 'table-align-left',
    group: COLUMN_GROUP,
    scopes: ['column'],
    checked: (table) => table.align === 'left',
  },
  {
    id: 'markdown.table.alignCenter',
    label: '居中',
    action: 'table-align-center',
    group: COLUMN_GROUP,
    scopes: ['column'],
    checked: (table) => table.align === 'center',
  },
  {
    id: 'markdown.table.alignRight',
    label: '右对齐',
    action: 'table-align-right',
    group: COLUMN_GROUP,
    scopes: ['column'],
    checked: (table) => table.align === 'right',
  },
  {
    id: 'markdown.table.moveColumnLeft',
    label: '左移',
    action: 'table-move-column-left',
    group: COLUMN_GROUP,
    scopes: ['column'],
    blocked: (table) =>
      table.firstColumn !== table.lastColumn
        ? '一次只能移动一列'
        : table.firstColumn === 0
          ? '已是第一列'
          : null,
  },
  {
    id: 'markdown.table.moveColumnRight',
    label: '右移',
    action: 'table-move-column-right',
    group: COLUMN_GROUP,
    scopes: ['column'],
    blocked: (table) =>
      table.firstColumn !== table.lastColumn
        ? '一次只能移动一列'
        : table.lastColumn >= table.columnCount - 1
          ? '已是最后一列'
          : null,
  },
  {
    id: 'markdown.table.clearColumn',
    label: '清空此列内容',
    action: 'table-clear-cells',
    group: COLUMN_GROUP,
    scopes: ['column'],
  },
  {
    id: 'markdown.table.deleteColumn',
    label: '删除列',
    action: 'table-delete-column',
    group: COLUMN_GROUP,
    scopes: ['caret', 'column'],
    shortcut: 'Backspace',
    destructive: true,
    blocked: (table) => (table.columnCount <= 1 ? '表格至少保留一列，可删除整个表格' : null),
  },
  {
    id: 'markdown.table.clearCells',
    label: '清空内容',
    action: 'table-clear-cells',
    group: TABLE_GROUP,
    scopes: ['cells', 'table'],
    shortcut: 'Backspace',
  },
  {
    id: 'markdown.table.delete',
    label: '删除表格',
    action: 'table-delete',
    group: TABLE_GROUP,
    scopes: ['caret', 'row', 'column', 'cells', 'table'],
    destructive: true,
  },
]
