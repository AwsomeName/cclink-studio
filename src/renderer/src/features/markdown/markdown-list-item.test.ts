import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeMarkdown, prepareMarkdownEditorInput } from './markdown-codec'
import { MarkdownListItem } from './markdown-list-item'

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function serialize(source: string): string {
  editor = new Editor({
    element: null,
    extensions: [StarterKit.configure({ listItem: false }), Markdown, MarkdownListItem],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  })
  editor.commands.setContent(prepareMarkdownEditorInput(source), {
    contentType: 'markdown',
    emitUpdate: false,
  })
  return editor.getMarkdown()
}

describe('MarkdownListItem', () => {
  it('preserves nested bullet lists inside a multi-item ordered list', () => {
    const source = [
      '1. 第一项',
      '   - 子项 1',
      '   - 子项 2',
      '   - 子项 3',
      '2. 第二项',
      '   - 子项 4',
      '   - 子项 5',
      '   - 子项 6',
      '3. 第三项',
      '   - 子项 7',
      '   - 子项 8',
      '   - 子项 9',
      '   - 子项 10',
      '4. 第四项',
      '   - 子项 11',
      '   - 子项 12',
    ].join('\n')

    expect(prepareMarkdownEditorInput(source)).toBe(source)
    const serialized = serialize(source)

    expect(serialized).toBe(source)
    expect(analyzeMarkdown(source, serialized).safeToSave).toBe(true)
  })

  it('uses the full ordered marker width to indent nested content', () => {
    const source = [
      '10. 第十项',
      '    - 子项',
      '11. 第十一项',
      '    7. 嵌套编号',
      '       - 更深子项',
    ].join('\n')

    expect(prepareMarkdownEditorInput(source)).toBe(source)
    const serialized = serialize(source)

    expect(serialized).toBe(source)
    expect(analyzeMarkdown(source, serialized).safeToSave).toBe(true)
  })
})
