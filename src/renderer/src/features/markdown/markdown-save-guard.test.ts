import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { MarkdownListItem } from './markdown-list-item'
import { parseMarkdownEditorDocument } from './markdown-editor-document'
import { inspectMarkdownEditorBeforeSave } from './markdown-save-guard'

let editor: Editor

beforeEach(() => {
  vi.stubGlobal('window', { HTMLUnknownElement: class {} })
  editor = new Editor({
    element: null,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    extensions: [
      StarterKit.configure({ listItem: false, link: false }),
      Markdown,
      MarkdownListItem,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table,
      TableRow,
      TableCell,
      TableHeader,
      Link,
    ],
  })
})

afterEach(() => {
  editor.destroy()
  vi.unstubAllGlobals()
})

describe('inspectMarkdownEditorBeforeSave', () => {
  it('accepts empty ordered and task placeholders after hydration', () => {
    const source = ['1.', '2.', '3.', '', '- [ ]', '- [ ]', '- [ ]'].join('\n')
    editor.commands.setContent(parseMarkdownEditorDocument(editor, source), { emitUpdate: false })

    const inspection = inspectMarkdownEditorBeforeSave(editor, source)

    expect(inspection.safeToSave).toBe(true)
    expect(inspection.diagnostics).toEqual([])
    expect(inspection.markdown).toBe(
      ['1. ', '2. ', '3. ', '', '- [ ] ', '- [ ] ', '- [ ] '].join('\n'),
    )
  })

  it('accepts a representative document after a second parse and serialization', () => {
    const source = [
      '# 文档',
      '',
      '7. 第七项',
      '8. 第八项',
      '',
      '| 左 | 中 | 右 |',
      '| :--- | :---: | ---: |',
      '| a | b | c |',
      '',
      '[链接][target]  ',
      '换行后正文',
      '',
      '[target]: https://example.com "标题"',
    ].join('\n')
    editor.commands.setContent(editor.markdown!.parse(source), { emitUpdate: false })

    const inspection = inspectMarkdownEditorBeforeSave(editor, source)

    expect(inspection.safeToSave).toBe(true)
    expect(inspection.diagnostics).toEqual([])
    expect(inspection.reparsedMarkdown).toBeTruthy()
  })

  it('blocks saving when a second serialization loses ordinary text', () => {
    editor.commands.setContent(editor.markdown!.parse('# 文档\n\n不能丢失的正文'), {
      emitUpdate: false,
    })
    const serialize = editor.markdown!.serialize.bind(editor.markdown)
    let calls = 0
    vi.spyOn(editor.markdown!, 'serialize').mockImplementation((document) => {
      calls += 1
      return calls === 1 ? serialize(document) : '# 文档'
    })

    const inspection = inspectMarkdownEditorBeforeSave(editor)

    expect(inspection.safeToSave).toBe(false)
    expect(inspection.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'structural-roundtrip-mismatch',
        message: expect.stringContaining('正文内容'),
      }),
    )
  })
})
