import { Extension, type Editor } from '@tiptap/core'

interface MarkdownKeyboardShortcutOptions {
  openLinkEditor: (editor: Editor) => boolean
  tabSize: number
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

export function handleMarkdownTabKey(
  editor: Editor,
  direction: 'indent' | 'outdent',
  tabSize = 2,
): boolean {
  // Code blocks already implement Markdown-safe indentation in their own
  // keymap. Returning false lets that keymap receive the untouched event.
  if (editor.isActive('codeBlock')) return false
  if (editor.isActive('table')) return handleMarkdownTableTab(editor, direction)

  const itemType = findMarkdownListItemType(editor)
  if (itemType) {
    // A boundary list item cannot always move, but Tab still belongs to the
    // editor so focus must not escape when the structural command returns false.
    adjustMarkdownListIndent(editor, direction)
    return true
  }

  return adjustMarkdownTextBlockIndent(editor, direction, tabSize)
}

function adjustMarkdownTextBlockIndent(
  editor: Editor,
  direction: 'indent' | 'outdent',
  requestedTabSize: number,
): boolean {
  const tabSize = Math.min(16, Math.max(1, Math.trunc(requestedTabSize) || 2))

  return editor.commands.command(({ state, tr, dispatch }) => {
    const { from, to, empty } = state.selection
    const targets: Array<{ start: number; leadingSpaces: number }> = []
    let containsSelectedTextBlock = false

    state.doc.descendants((node, position) => {
      if (!node.isTextblock) return true

      const start = position + 1
      const end = start + node.content.size
      const selected = empty ? from >= start && from <= end : from <= end && to >= start
      if (selected) {
        containsSelectedTextBlock = true
        // Heading marker spacing is normalized by Markdown parsers, so writing
        // spaces into a heading would appear to work and then disappear on reopen.
        if (node.type.name !== 'paragraph') return false
        const leadingSpaces = node
          .textBetween(0, node.content.size, '\n', '\n')
          .match(/^ */)?.[0].length
        targets.push({ start, leadingSpaces: leadingSpaces ?? 0 })
      }
      return false
    })

    if (targets.length === 0) return containsSelectedTextBlock
    if (!dispatch) return true

    for (const target of targets.sort((left, right) => right.start - left.start)) {
      if (direction === 'indent') {
        tr.insertText(' '.repeat(tabSize), target.start)
        continue
      }

      const spacesToRemove = Math.min(target.leadingSpaces, tabSize)
      if (spacesToRemove > 0) tr.delete(target.start, target.start + spacesToRemove)
    }
    return true
  })
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
      tabSize: 2,
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => handleMarkdownTabKey(this.editor, 'indent', this.options.tabSize),
      'Shift-Tab': () => handleMarkdownTabKey(this.editor, 'outdent', this.options.tabSize),
      'Mod-k': () => this.options.openLinkEditor(this.editor),
      'Mod-Alt-0': () => this.editor.commands.setParagraph(),
      'Mod-Shift-b': () => toggleMarkdownBlockquote(this.editor),
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      'Mod-]': () => adjustMarkdownListIndent(this.editor, 'indent'),
      'Mod-[': () => adjustMarkdownListIndent(this.editor, 'outdent'),
    }
  },
})
