import ListItem from '@tiptap/extension-list-item'

/**
 * CommonMark allows a heading to be the first block in a list item (`1. ### Heading`).
 * Tiptap's default list item requires a paragraph first, which silently demotes that heading.
 */
export const MarkdownListItem = ListItem.extend({
  content: 'block+',
})
