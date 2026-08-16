import { Editor } from '@tiptap/core'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inspectMarkdownRoundTrip, prepareMarkdownEditorInput } from './markdown-codec'
import { parseMarkdownEditorDocument } from './markdown-editor-document'
import { MarkdownListItem } from './markdown-list-item'

let editor: Editor

beforeEach(() => {
  editor = new Editor({
    element: null,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    extensions: [
      StarterKit.configure({ listItem: false }),
      Markdown,
      MarkdownListItem,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
  })
})

afterEach(() => {
  editor.destroy()
})

describe('parseMarkdownEditorDocument', () => {
  it('keeps generated empty ordered and task items editable across a round trip', () => {
    const source = [
      '## 感恩记录',
      '',
      '1.',
      '2.',
      '3.',
      '',
      '## 明日规划',
      '',
      '- [ ]',
      '- [ ]',
      '- [ ]',
    ].join('\n')

    editor.commands.setContent(parseMarkdownEditorDocument(editor, source), { emitUpdate: false })

    expect(editor.getJSON()).toMatchObject({
      content: [
        { type: 'heading' },
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph' }] },
            { type: 'listItem', content: [{ type: 'paragraph' }] },
            { type: 'listItem', content: [{ type: 'paragraph' }] },
          ],
        },
        { type: 'heading' },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: false } },
            { type: 'taskItem', attrs: { checked: false } },
            { type: 'taskItem', attrs: { checked: false } },
          ],
        },
      ],
    })

    const serialized = editor.getMarkdown()
    expect(serialized).toBe(
      [
        '## 感恩记录',
        '',
        '1. ',
        '2. ',
        '3. ',
        '',
        '## 明日规划',
        '',
        '- [ ] ',
        '- [ ] ',
        '- [ ] ',
      ].join('\n'),
    )
    expect(inspectMarkdownRoundTrip(source, serialized)).toMatchObject({
      catastrophic: false,
      equivalent: true,
      differences: [],
    })

    editor.commands.setContent(parseMarkdownEditorDocument(editor, serialized), {
      emitUpdate: false,
    })
    expect(editor.getMarkdown()).toBe(serialized)
  })

  it('does not normalize task-looking text inside fenced or indented code blocks', () => {
    const source = ['```markdown', '- [ ]', '```', '', '- [ ]'].join('\n')

    editor.commands.setContent(parseMarkdownEditorDocument(editor, source), { emitUpdate: false })

    expect(editor.getMarkdown()).toBe(['```markdown', '- [ ]', '```', '', '- [ ] '].join('\n'))
    expect(prepareMarkdownEditorInput('    - [ ]')).toBe('    - [ ]')
  })

  it('preserves the starting number of repaired empty ordered items', () => {
    editor.commands.setContent(parseMarkdownEditorDocument(editor, '10.\n11.'), {
      emitUpdate: false,
    })

    expect(editor.getMarkdown()).toBe('10. \n11. ')
  })

  it('places a cursor in a repaired empty ordered item and accepts text', () => {
    editor.commands.setContent(parseMarkdownEditorDocument(editor, '1.\n2.'), {
      emitUpdate: false,
    })
    let firstParagraphPosition: number | undefined
    editor.state.doc.descendants((node, position) => {
      if (firstParagraphPosition === undefined && node.type.name === 'paragraph') {
        firstParagraphPosition = position
        return false
      }
      return firstParagraphPosition === undefined
    })

    expect(firstParagraphPosition).toBeTypeOf('number')
    editor.commands.setTextSelection((firstParagraphPosition ?? 0) + 1)
    expect(editor.commands.insertContent({ type: 'text', text: '第一件事' })).toBe(true)

    expect(editor.getMarkdown()).toBe(['1. 第一件事', '2. '].join('\n'))
  })
})
