import { Extension, type Editor } from '@tiptap/core'

interface MarkdownKeyboardShortcutOptions {
  openLinkEditor: (editor: Editor) => boolean
}

interface MarkdownTabKeyboardEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  preventDefault: () => void
}

export function applyMarkdownLink(editor: Editor, href: string): boolean {
  const chain = editor.chain().focus().extendMarkRange('link')
  return href.trim() ? chain.setLink({ href: href.trim() }).run() : chain.unsetLink().run()
}

export function adjustMarkdownListIndent(editor: Editor, direction: 'indent' | 'outdent'): boolean {
  const itemType = findMarkdownListItemType(editor)
  if (!itemType) return false
  return direction === 'indent'
    ? editor.commands.sinkListItem(itemType)
    : editor.commands.liftListItem(itemType)
}

export function handleMarkdownTabKey(editor: Editor, direction: 'indent' | 'outdent'): boolean {
  // Code blocks already implement Markdown-safe indentation in their own
  // keymap. Returning false lets that keymap receive the untouched event.
  if (editor.isActive('codeBlock')) return false
  if (editor.isActive('table')) return handleMarkdownTableTab(editor, direction)

  // Markdown has no portable paragraph-indentation syntax. Keep focus inside
  // the WYSIWYG editor without inserting spaces that could become a hard break
  // or an indented code block after serialization.
  adjustMarkdownListIndent(editor, direction)
  return true
}

function handleMarkdownTableTab(editor: Editor, direction: 'indent' | 'outdent'): boolean {
  if (direction === 'outdent') {
    // Keep focus in the first cell even when there is no previous cell.
    editor.commands.goToPreviousCell()
    return true
  }

  if (editor.commands.goToNextCell()) return true
  if (editor.can().addRowAfter()) {
    editor.chain().addRowAfter().goToNextCell().run()
  }
  // Keep focus in the table when it cannot grow further.
  return true
}

export function handleMarkdownTabKeyDown(editor: Editor, event: MarkdownTabKeyboardEvent): boolean {
  if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return false

  const handled = handleMarkdownTabKey(editor, event.shiftKey ? 'outdent' : 'indent')
  if (handled) event.preventDefault()
  return handled
}

function findMarkdownListItemType(editor: Editor): 'listItem' | 'taskItem' | null {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name
    if (name === 'listItem' || name === 'taskItem') return name
  }
  return null
}

export function toggleMarkdownBlockquote(editor: Editor): boolean {
  const domPosition = getDomBlockquoteSelectionPosition(editor)
  if (!editor.isActive('blockquote') && domPosition === null) {
    return editor.commands.setBlockquote()
  }
  const chain = editor.chain().focus()
  if (!editor.isActive('blockquote') && domPosition !== null) {
    chain.setTextSelection(domPosition)
  }
  return chain.unsetBlockquote().run()
}

function getDomBlockquoteSelectionPosition(editor: Editor): number | null {
  if (typeof window === 'undefined') return null
  const selection = window.getSelection()
  const anchor = selection?.anchorNode
  if (!anchor) return null
  const element = anchor instanceof Element ? anchor : anchor.parentElement
  if (!element?.closest('blockquote')) return null
  try {
    return editor.view.posAtDOM(anchor, selection?.anchorOffset ?? 0)
  } catch {
    return null
  }
}

export const MarkdownKeyboardShortcuts = Extension.create<MarkdownKeyboardShortcutOptions>({
  name: 'markdownKeyboardShortcuts',
  priority: 1_000,

  addOptions() {
    return {
      openLinkEditor: () => false,
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => this.options.openLinkEditor(this.editor),
      'Mod-Alt-0': () => this.editor.commands.setParagraph(),
      'Mod-Shift-b': () => toggleMarkdownBlockquote(this.editor),
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-]': () => adjustMarkdownListIndent(this.editor, 'indent'),
      'Mod-[': () => adjustMarkdownListIndent(this.editor, 'outdent'),
    }
  },
})
