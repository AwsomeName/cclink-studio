import type { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import { handleMarkdownTabKey } from './markdown-editor-shortcuts'

function createEditor(options?: {
  active?: string
  selectionPath?: string[]
  sinkResult?: boolean
  liftResult?: boolean
}): Editor {
  const selectionPath = options?.selectionPath ?? ['doc', 'paragraph']
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
    },
  } as unknown as Editor
}

describe('handleMarkdownTabKey', () => {
  it('consumes Tab in an ordinary Markdown block so focus stays in the editor', () => {
    const editor = createEditor()

    expect(handleMarkdownTabKey(editor, 'indent')).toBe(true)
  })

  it.each(['codeBlock', 'table'])('defers Tab handling inside %s', (active) => {
    const editor = createEditor({ active })

    expect(handleMarkdownTabKey(editor, 'indent')).toBe(false)
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
