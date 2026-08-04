import { Extension, type Editor } from '@tiptap/core'

interface MarkdownKeyboardShortcutOptions {
  openLinkEditor: (editor: Editor) => boolean
}

export function applyMarkdownLink(editor: Editor, href: string): boolean {
  const chain = editor.chain().focus().extendMarkRange('link')
  return href.trim() ? chain.setLink({ href: href.trim() }).run() : chain.unsetLink().run()
}

export function adjustMarkdownListIndent(editor: Editor, direction: 'indent' | 'outdent'): boolean {
  const { $from } = editor.state.selection
  let itemType: 'listItem' | 'taskItem' | null = null
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name
    if (name === 'listItem' || name === 'taskItem') {
      itemType = name
      break
    }
  }
  if (!itemType) return false
  return direction === 'indent'
    ? editor.commands.sinkListItem(itemType)
    : editor.commands.liftListItem(itemType)
}

export function handleMarkdownTabKey(editor: Editor, direction: 'indent' | 'outdent'): boolean {
  // Let the dedicated extensions handle Tab inside code blocks and tables.
  if (editor.isActive('codeBlock') || editor.isActive('table')) return false

  // Lists support structural indentation. In ordinary Markdown blocks there is
  // no safe structural indent operation, but Tab must still remain inside the
  // editor instead of falling through to the browser's focus navigation.
  adjustMarkdownListIndent(editor, direction)
  return true
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
