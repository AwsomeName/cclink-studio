import type { Editor, JSONContent } from '@tiptap/core'
import { prepareMarkdownEditorInput } from './markdown-codec'

/**
 * Tiptap 3.25 parses a valid empty ordered item (`1.`) as a listItem without a
 * text block. ProseMirror can display that node, but it has nowhere to place a
 * cursor and Tiptap's Markdown renderer silently drops it. Repair the parser
 * output at the single hydration boundary so the item stays editable and
 * serializes back to an empty Markdown marker.
 */
export function parseMarkdownEditorDocument(editor: Editor, source: string): JSONContent {
  if (!editor.markdown) {
    throw new Error('Markdown 解析器未初始化')
  }

  return repairEmptyMarkdownListItems(editor.markdown.parse(prepareMarkdownEditorInput(source)))
}

export function repairEmptyMarkdownListItems(document: JSONContent): JSONContent {
  const content = document.content?.map(repairEmptyMarkdownListItems)

  if (document.type === 'listItem' && (!content || content.length === 0)) {
    return {
      ...document,
      content: [{ type: 'paragraph' }],
    }
  }

  return content ? { ...document, content } : { ...document }
}
