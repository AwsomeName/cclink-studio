import type { Editor, JSONContent } from '@tiptap/core'
import { protectMarkdownHtml } from './markdown-html-blocks'
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

  const literal = editor.schema.nodes.markdownLiteralBlock ? protectMarkdownHtml(source) : null
  const parsed = editor.markdown.parse(prepareMarkdownEditorInput(literal?.source ?? source))
  if (literal?.blocks.length && parsed.content) {
    parsed.content = parsed.content.map((node) => {
      if (node.type !== 'codeBlock' || node.attrs?.language !== literal.language) return node
      const raw = literal.blocks[Number(node.content?.[0]?.text)]
      if (raw === undefined) throw new Error('HTML 原文块未能还原')
      return { type: 'markdownLiteralBlock', content: [{ type: 'text', text: raw }] }
    })
  }
  const repaired = splitTableCellImages(
    liftParagraphOnlyImages(repairEmptyMarkdownListItems(parsed)),
  )
  // Editors built without the inline image node (some tests, other surfaces) keep block images.
  return editor.schema.nodes.inlineImage ? inlineParagraphImages(repaired) : repaired
}

/**
 * After image-only paragraphs became image blocks and table cells were split, an image still
 * inside a paragraph shares its line with text. A block image there is invalid content and
 * breaks every edit of that paragraph, so it becomes the inline image node, which writes the same
 * Markdown back.
 */
export function inlineParagraphImages(document: JSONContent): JSONContent {
  if (!document.content) return { ...document }
  const content = document.content.map((child) => inlineParagraphImages(child))
  if (document.type !== 'paragraph') return { ...document, content }
  return {
    ...document,
    content: content.map((item) =>
      item.type === 'image' ? { ...item, type: 'inlineImage' } : item,
    ),
  }
}

const TABLE_CELL_TYPES = new Set(['tableCell', 'tableHeader'])

function isBlankText(item: JSONContent): boolean {
  return item.type === 'text' && !item.text?.trim()
}

/**
 * A table cell holds one line of Markdown, so text and an image share one paragraph after
 * parsing — invalid, because images are blocks, and any edit there (deleting the image included)
 * throws. Inside table cells the paragraph becomes its text runs and image blocks; the table
 * serializer writes them back onto one line.
 */
export function splitTableCellImages(document: JSONContent, inCell = false): JSONContent {
  const cell = TABLE_CELL_TYPES.has(document.type ?? '')
  if (!document.content) return { ...document }
  const content = document.content.flatMap((child): JSONContent[] => {
    const next = splitTableCellImages(child, cell || inCell)
    if (!(cell && next.type === 'paragraph' && next.content?.some((i) => i.type === 'image')))
      return [next]
    const blocks: JSONContent[] = []
    let run: JSONContent[] = []
    const flush = (): void => {
      while (run.length && isBlankText(run[0])) run.shift()
      while (run.length && isBlankText(run[run.length - 1])) run.pop()
      // The serializer puts one space between the blocks of a cell; edge spaces would double it.
      if (run[0]?.type === 'text') run[0] = { ...run[0], text: run[0].text?.trimStart() }
      const last = run.length - 1
      if (run[last]?.type === 'text') run[last] = { ...run[last], text: run[last].text?.trimEnd() }
      if (run.length) blocks.push({ ...next, content: run })
      run = []
    }
    for (const item of next.content ?? []) {
      if (item.type === 'image') {
        flush()
        blocks.push(item)
      } else run.push(item)
    }
    flush()
    return blocks.length ? blocks : [{ type: 'paragraph' }]
  })
  return { ...document, content }
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
