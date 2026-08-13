import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it, vi } from 'vitest'
import { analyzeMarkdown, prepareMarkdownEditorInput } from './markdown-codec'
import { applyMarkdownTaskInputShortcut, handleMarkdownTabKey } from './markdown-editor-shortcuts'
import { MarkdownListItem } from './markdown-list-item'

function createEditor(options?: {
  active?: string
  selectionPath?: string[]
  sinkResult?: boolean
  liftResult?: boolean
  nextCellResult?: boolean
  previousCellResult?: boolean
  canAddRow?: boolean
}): Editor {
  const selectionPath = options?.selectionPath ?? ['doc', 'paragraph']
  const tableChain = {
    addRowAfter: vi.fn(),
    goToNextCell: vi.fn(),
    run: vi.fn(() => true),
  }
  tableChain.addRowAfter.mockReturnValue(tableChain)
  tableChain.goToNextCell.mockReturnValue(tableChain)
  return {
    isActive: (name: string) => name === options?.active,
    state: {
      selection: {
        $from: {
          depth: selectionPath.length - 1,
          node: (depth: number) => ({ type: { name: selectionPath[depth] } }),
        },
      },
    },
    commands: {
      sinkListItem: vi.fn(() => options?.sinkResult ?? false),
      liftListItem: vi.fn(() => options?.liftResult ?? false),
      insertContent: vi.fn(() => true),
      deleteRange: vi.fn(() => true),
      goToNextCell: vi.fn(() => options?.nextCellResult ?? false),
      goToPreviousCell: vi.fn(() => options?.previousCellResult ?? false),
    },
    can: () => ({ addRowAfter: () => options?.canAddRow ?? true }),
    chain: vi.fn(() => tableChain),
  } as unknown as Editor
}

function createHeadlessMarkdownEditor(markdown: string): Editor {
  const editor = new Editor({
    element: null,
    extensions: [StarterKit, Markdown],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  })
  editor.commands.setContent(markdown, { contentType: 'markdown' })
  return editor
}

describe('handleMarkdownTabKey', () => {
  it('indents and outdents an ordinary Markdown block with serializable spaces', () => {
    const editor = createHeadlessMarkdownEditor('alpha')
    editor.commands.setTextSelection(3)

    expect(handleMarkdownTabKey(editor, 'indent', 2)).toBe(true)
    expect(editor.getMarkdown()).toBe('  alpha')
    expect(handleMarkdownTabKey(editor, 'outdent', 2)).toBe(true)
    expect(editor.getMarkdown()).toBe('alpha')
    editor.destroy()
  })

  it('indents all selected Markdown blocks together', () => {
    const editor = createHeadlessMarkdownEditor('alpha\n\nbeta')
    editor.commands.selectAll()

    expect(handleMarkdownTabKey(editor, 'indent', 2)).toBe(true)
    expect(editor.getMarkdown()).toBe('  alpha\n\n  beta')
    expect(handleMarkdownTabKey(editor, 'outdent', 2)).toBe(true)
    expect(editor.getMarkdown()).toBe('alpha\n\nbeta')
    editor.destroy()
  })

  it('preserves ordinary indentation after a Markdown serialize-and-parse round trip', () => {
    const editor = createHeadlessMarkdownEditor('alpha')
    editor.commands.setTextSelection(1)
    handleMarkdownTabKey(editor, 'indent', 2)

    const serialized = editor.getMarkdown()
    const reopened = createHeadlessMarkdownEditor(serialized)
    expect(serialized).toBe('  alpha')
    expect(reopened.getJSON()).toMatchObject({
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '  alpha' }] }],
    })
    reopened.destroy()
    editor.destroy()
  })

  it('preserves indentation inside a blockquote after a Markdown round trip', () => {
    const editor = createHeadlessMarkdownEditor('> alpha')
    editor.commands.setTextSelection(2)

    expect(handleMarkdownTabKey(editor, 'indent', 2)).toBe(true)
    const serialized = editor.getMarkdown()
    const reopened = createHeadlessMarkdownEditor(serialized)
    expect(serialized).toBe('>   alpha')
    expect(reopened.getJSON()).toMatchObject({
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '  alpha' }] }],
        },
      ],
    })
    reopened.destroy()
    editor.destroy()
  })

  it('does not write indentation that Markdown would discard into a heading', () => {
    const editor = createHeadlessMarkdownEditor('# alpha')
    editor.commands.setTextSelection(2)

    expect(handleMarkdownTabKey(editor, 'indent', 2)).toBe(true)
    expect(editor.getMarkdown()).toBe('# alpha')
    editor.destroy()
  })

  it('defers Tab handling inside a code block', () => {
    const editor = createEditor({ active: 'codeBlock' })

    expect(handleMarkdownTabKey(editor, 'indent')).toBe(false)
  })

  it('keeps table navigation inside the table at a boundary', () => {
    const editor = createEditor({ active: 'table', previousCellResult: false })

    expect(handleMarkdownTabKey(editor, 'outdent')).toBe(true)
    expect(editor.commands.goToPreviousCell).toHaveBeenCalledOnce()
  })

  it('adds a table row when Tab moves forward from the last cell', () => {
    const editor = createEditor({ active: 'table', nextCellResult: false, canAddRow: true })

    expect(handleMarkdownTabKey(editor, 'indent')).toBe(true)
    expect(editor.commands.goToNextCell).toHaveBeenCalledOnce()
    expect(editor.chain).toHaveBeenCalledOnce()
  })

  it('keeps list indentation behavior for Tab and Shift+Tab', () => {
    const editor = createEditor({
      selectionPath: ['doc', 'bulletList', 'listItem', 'paragraph'],
      sinkResult: true,
      liftResult: true,
    })

    expect(handleMarkdownTabKey(editor, 'indent')).toBe(true)
    expect(editor.commands.sinkListItem).toHaveBeenCalledWith('listItem')
    expect(handleMarkdownTabKey(editor, 'outdent')).toBe(true)
    expect(editor.commands.liftListItem).toHaveBeenCalledWith('listItem')
  })

  it.each([
    ['[]', false],
    ['[ ]', false],
    ['[x]', true],
    ['【】', false],
    ['【x】', true],
  ])('turns %s followed by Space into a task item', (marker, checked) => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })],
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: marker }] }],
      },
    })
    editor.commands.setTextSelection(marker.length + 1)

    expect(applyMarkdownTaskInputShortcut(editor)).toBe(true)
    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          type: 'taskList',
          content: [{ type: 'taskItem', attrs: { checked } }],
        },
      ],
    })
    editor.destroy()
  })

  it('does not turn brackets in ordinary text into a task item', () => {
    const editor = createHeadlessMarkdownEditor('keep []')
    editor.commands.setTextSelection(8)

    expect(applyMarkdownTaskInputShortcut(editor)).toBe(false)
    expect(editor.getMarkdown()).toBe('keep \\[\\]')
    editor.destroy()
  })

  it('allows an ordered list to contain a heading as its first block', () => {
    const editor = new Editor({
      element: null,
      extensions: [StarterKit.configure({ listItem: false }), Markdown, MarkdownListItem],
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: '编号标题' }],
          },
        ],
      },
    })
    editor.commands.setTextSelection(2)

    expect(editor.commands.toggleOrderedList()).toBe(true)
    expect(editor.getMarkdown()).toBe('1. ### 编号标题')
    editor.destroy()
  })

  it('opens and preserves a same-line CommonMark list heading', () => {
    const source = '1. ### 编号标题'
    const editor = new Editor({
      element: null,
      extensions: [StarterKit.configure({ listItem: false }), Markdown, MarkdownListItem],
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    })

    editor.commands.setContent(prepareMarkdownEditorInput(source), {
      contentType: 'markdown',
      emitUpdate: false,
    })
    const serialized = editor.getMarkdown()

    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'heading', attrs: { level: 3 } }],
            },
          ],
        },
      ],
    })
    expect(serialized).toBe(source)
    expect(analyzeMarkdown(source, serialized).safeToSave).toBe(true)
    editor.destroy()
  })
})
