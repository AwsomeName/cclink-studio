import type { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import { handleMarkdownTabKey, handleMarkdownTabKeyDown } from './markdown-editor-shortcuts'

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

describe('handleMarkdownTabKey', () => {
  it.each(['indent', 'outdent'] as const)(
    'keeps an ordinary Markdown block unchanged for %s',
    (direction) => {
      const editor = createEditor()

      expect(handleMarkdownTabKey(editor, direction)).toBe(true)
      expect(editor.commands.insertContent).not.toHaveBeenCalled()
      expect(editor.commands.deleteRange).not.toHaveBeenCalled()
    },
  )

  it('does not turn repeated ordinary Tab presses into Markdown indentation syntax', () => {
    const editor = createEditor()

    expect(handleMarkdownTabKey(editor, 'indent')).toBe(true)
    expect(handleMarkdownTabKey(editor, 'indent')).toBe(true)
    expect(editor.commands.insertContent).not.toHaveBeenCalled()
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
    expect(editor.commands.insertContent).not.toHaveBeenCalled()
    expect(handleMarkdownTabKey(editor, 'outdent')).toBe(true)
    expect(editor.commands.liftListItem).toHaveBeenCalledWith('listItem')
  })
})

describe('handleMarkdownTabKeyDown', () => {
  function createTabEvent(options?: {
    key?: string
    metaKey?: boolean
    ctrlKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
  }) {
    return {
      key: options?.key ?? 'Tab',
      metaKey: options?.metaKey ?? false,
      ctrlKey: options?.ctrlKey ?? false,
      altKey: options?.altKey ?? false,
      shiftKey: options?.shiftKey ?? false,
      preventDefault: vi.fn(),
    }
  }

  it('passes an untouched Tab event to the code-block keymap', () => {
    const editor = createEditor({ active: 'codeBlock' })
    const event = createTabEvent({ shiftKey: true })

    expect(handleMarkdownTabKeyDown(editor, event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('prevents browser focus navigation at a table boundary', () => {
    const editor = createEditor({ active: 'table', previousCellResult: false })
    const event = createTabEvent({ shiftKey: true })

    expect(handleMarkdownTabKeyDown(editor, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('keeps an ordinary Tab inside the editor without changing Markdown content', () => {
    const editor = createEditor()
    const event = createTabEvent()

    expect(handleMarkdownTabKeyDown(editor, event)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(editor.commands.insertContent).not.toHaveBeenCalled()
  })

  it('does not intercept modified Tab shortcuts', () => {
    const editor = createEditor()
    const event = createTabEvent({ ctrlKey: true })

    expect(handleMarkdownTabKeyDown(editor, event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
