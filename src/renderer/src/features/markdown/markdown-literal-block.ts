import { Node } from '@tiptap/core'

/** A locally editable source fragment. Its content is always a DOM text node. */
export const MarkdownLiteralBlock = Node.create({
  name: 'markdownLiteralBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,
  renderHTML() {
    return [
      'pre',
      { class: 'markdown-literal-block', title: '此处按原文编辑 HTML 片段' },
      ['code', 0],
    ]
  },
  renderMarkdown(node) {
    return (node.content ?? []).map((child) => child.text ?? '').join('')
  },
})
