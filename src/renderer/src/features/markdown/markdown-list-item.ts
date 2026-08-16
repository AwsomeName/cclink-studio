import { renderNestedMarkdownContent } from '@tiptap/core'
import ListItem from '@tiptap/extension-list-item'

/**
 * CommonMark allows a heading to be the first block in a list item (`1. ### Heading`).
 * Tiptap's default list item requires a paragraph first, which silently demotes that heading.
 */
export const MarkdownListItem = ListItem.extend({
  content: 'block+',
  renderMarkdown(node, helpers, context) {
    if (context.parentType !== 'orderedList') {
      return renderNestedMarkdownContent(node, helpers, '- ', context)
    }

    const start = Number(context.meta?.parentAttrs?.start) || 1
    const prefix = `${start + context.index}. `

    return renderNestedMarkdownContent(
      node,
      {
        ...helpers,
        indent: (content) => `${' '.repeat(prefix.length)}${content}`,
      },
      prefix,
      context,
    )
  },
})
