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

  return liftParagraphOnlyImages(
    repairEmptyMarkdownListItems(editor.markdown.parse(prepareMarkdownEditorInput(source))),
  )
}

/**
 * Images are block nodes, but an image alone in a table cell (or alone on its line) is parsed
 * into a paragraph. That paragraph is invalid content, so any later change to the image, such as
 * a width, throws. A paragraph that holds nothing but images becomes those image blocks; mixed
 * text-and-image paragraphs are left as parsed.
 */
export function liftParagraphOnlyImages(document: JSONContent): JSONContent {
  if (!document.content) return { ...document }
  const content = document.content.flatMap((child): JSONContent[] => {
    const lifted = liftParagraphOnlyImages(child)
    if (lifted.type !== 'paragraph' || !lifted.content?.length) return [lifted]
    const images = lifted.content.filter((item) => item.type === 'image')
    const onlyImages =
      images.length > 0 &&
      lifted.content.every(
        (item) => item.type === 'image' || (item.type === 'text' && !item.text?.trim()),
      )
    return onlyImages ? images : [lifted]
  })
  return { ...document, content }
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
