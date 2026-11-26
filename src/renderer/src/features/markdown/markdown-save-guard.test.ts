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
import { MarkdownLiteralBlock } from './markdown-literal-block'
import { analyzeEditableMarkdown } from './markdown-codec'
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
      MarkdownLiteralBlock,
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
  it.each([
    '这里有 <span title="属性">文字</span>。',
    '| 事项 | 备注 |\n| --- | --- |\n| 早上 | 上行<br />下行 |',
    '<!-- 备注\n\n\n包含 $5、反引号和缩进    \n-->',
    '<script>window.shouldNeverRun = true</script>',
    '<img src="external.png" style="width:50%">',
  ])('keeps an HTML-bearing block editable as text and saves its exact source (%s)', (raw) => {
    const source = ['# 日记', '', raw, '', '继续写。', ''].join('\n')
    const parsed = parseMarkdownEditorDocument(editor, source)
    editor.commands.setContent(parsed, { emitUpdate: false })
    expect(parsed.content?.map((node) => node.type)).toEqual([
      'heading',
      'markdownLiteralBlock',
      'paragraph',
    ])
    expect(analyzeEditableMarkdown(source).safeToEdit).toBe(true)
    editor.view.dispatch(editor.state.tr.insertText('新增。', editor.state.doc.content.size - 1))
    const inspection = inspectMarkdownEditorBeforeSave(editor, source)
    expect(inspection.safeToSave).toBe(true)
    expect(inspection.markdown).toBe(source.replace('继续写。', '继续写。新增。'))
    expect(inspection.reparsedMarkdown).toBe(inspection.markdown)
    expect(analyzeEditableMarkdown(source, source.replace(raw, '')).safeToSave).toBe(false)
  })

  it('detects whitespace loss or a swapped HTML fragment even if both fragments render alike', () => {
    const first = '<!-- a  -->'
    const second = '<!-- a -->'
    const source = [first, '间隔', second].join('\n\n')
    expect(analyzeEditableMarkdown(source, source.replace(first, second)).safeToSave).toBe(false)
    expect(analyzeEditableMarkdown(source, [second, '间隔', first].join('\n\n')).safeToSave).toBe(
      false,
    )
  })

  it('retains independent syntax errors, genuine code fences and inline code', () => {
    const raw = '<!--保持-->'
    const source = ['```cclink-preserved-html', '0', '```', '', raw, '', '`<br>`'].join('\n')
    editor.commands.setContent(parseMarkdownEditorDocument(editor, source))
    expect(inspectMarkdownEditorBeforeSave(editor, source).markdown).toBe(source)
    expect(analyzeEditableMarkdown(source + '\n\n[^1]: 脚注').safeToEdit).toBe(false)
  })

  it('accepts empty ordered and task placeholders after hydration', () => {
    const source = ['1.', '2.', '3.', '', '- [ ]', '- [ ]', '- [ ]'].join('\n')
    editor.commands.setContent(parseMarkdownEditorDocument(editor, source), { emitUpdate: false })

    const inspection = inspectMarkdownEditorBeforeSave(editor, source)

    expect(inspection.safeToSave).toBe(true)
    expect(inspection.diagnostics).toEqual([])
    // Untouched placeholders keep the document's own spelling instead of the serializer's.
    expect(inspection.markdown).toBe(source)
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
