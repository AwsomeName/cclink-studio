import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it, vi } from 'vitest'
import { handleMarkdownTabKey } from './markdown-editor-shortcuts'

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
})
