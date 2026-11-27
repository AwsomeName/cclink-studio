import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TextSelection } from '@tiptap/pm/state'
import { MarkdownCode } from './markdown-code-mark'
import { MarkdownCellBreak } from './markdown-table-breaks'
import { MarkdownLiteralBlock } from './markdown-literal-block'
import { parseMarkdownEditorDocument } from './markdown-editor-document'
import { insertMarkdownTableCellBreak } from './markdown-editor-shortcuts'
import { analyzeEditableMarkdown, normalizeMarkdownEditorOutput } from './markdown-codec'

let editor: Editor

beforeEach(() => {
  vi.stubGlobal('window', { HTMLUnknownElement: class {} })
  editor = new Editor({
    element: null,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    extensions: [
      StarterKit.configure({ link: false, code: false }),
      MarkdownCode,
      Markdown,
      Link,
      Table,
      TableRow,
      TableCell,
      TableHeader,
      MarkdownLiteralBlock,
      MarkdownCellBreak,
    ],
  })
  const manager = (
    editor as unknown as { commandManager: { rawCommands: Record<string, unknown> } }
  ).commandManager
  manager.rawCommands.focus = () => () => true
})

afterEach(() => {
  editor.destroy()
  vi.unstubAllGlobals()
})

function load(source: string): void {
  editor.commands.setContent(parseMarkdownEditorDocument(editor, source), { emitUpdate: false })
}

function textPos(text: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text)
  })
  return found
}

describe('inline code combined with other formatting', () => {
  it.each([
    '**`代码`** 加粗代码',
    '[`代码`](https://example.com) 链接代码',
    '~~`代码`~~ 删除代码',
    '*`斜体代码`* 与 **粗 `码` 体**',
  ])('stays valid, edits without throwing and serializes code innermost: %s', (line) => {
    const source = `${line}\n`
    load(source)
    expect(() => editor.state.doc.check()).not.toThrow()
    // The serializer itself (no untouched-block restore) writes code innermost.
    expect(editor.getMarkdown()).toBe(line)
    const pos = textPos('代码') >= 0 ? textPos('代码') : textPos('码')
    expect(() => editor.view.dispatch(editor.state.tr.insertText('改', pos + 1))).not.toThrow()
    expect(() => editor.state.doc.check()).not.toThrow()
  })
})

describe('line breaks inside table cells', () => {
  const table = '| 事项 | 记录 |\n| --- | --- |\n| 外壳 | 喇叭集成<br>光机外侧修角<br/>螺丝内沉 |\n'

  it('opens a table with <br> as an editable table, not an HTML source block', () => {
    load(table)
    expect(editor.getJSON().content?.[0].type).toBe('table')
    expect(analyzeEditableMarkdown(table).safeToEdit).toBe(true)
    let breaks = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'cellBreak') breaks += 1
    })
    expect(breaks).toBe(2)
  })

  it('writes every break back with its own spelling after an edit elsewhere in the cell', () => {
    load(table)
    editor.view.dispatch(editor.state.tr.insertText('，已补', textPos('螺丝内沉') + 4))
    const saved = normalizeMarkdownEditorOutput(editor.getMarkdown(), table)
    expect(saved).toContain('喇叭集成<br>光机外侧修角<br/>螺丝内沉，已补')
    expect(saved).not.toContain('\u001f')
  })

  it('Option+Enter adds a line break inside the cell that saves as <br>', () => {
    const source = '| 事项 | 记录 |\n| --- | --- |\n| 外壳 | 第一行 |\n'
    load(source)
    const end = textPos('第一行') + 3
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)))
    expect(insertMarkdownTableCellBreak(editor)).toBe(true)
    editor.view.dispatch(editor.state.tr.insertText('第二行'))
    expect(normalizeMarkdownEditorOutput(editor.getMarkdown(), source)).toContain(
      '第一行<br>第二行',
    )
  })

  it('leaves <br> outside tables to the HTML source block', () => {
    const source = '上行<br>下行\n'
    load(source)
    expect(editor.getJSON().content?.[0].type).toBe('markdownLiteralBlock')
  })
})
