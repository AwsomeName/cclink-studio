import { Mark, markInputRule, markPasteRule, mergeAttributes } from '@tiptap/core'

interface InlineMatch {
  index: number
  text: string
  replaceWith: string
}

function inputMatch(text: string): InlineMatch | null {
  const match = /`([^`]+)`(?!`)$/.exec(text)
  if (!match || (match.index > 0 && text[match.index - 1] === '`')) return null
  return { index: match.index, text: match[0], replaceWith: match[1] }
}

function pasteMatches(text: string): InlineMatch[] {
  const matches: InlineMatch[] = []
  const regex = /`([^`]+)`(?!`)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > 0 && text[match.index - 1] === '`') continue
    matches.push({ index: match.index, text: match[0], replaceWith: match[1] })
  }
  return matches
}

/**
 * Inline code that can carry bold, italic, strikethrough or a link, as Markdown allows
 * (`**`x`**`, `[`x`](url)`). Tiptap's own code mark excludes every other mark, so a document using
 * those combinations held invalid text and threw on every edit of that paragraph. The lowest
 * priority makes code the innermost mark, so it serializes as `**`x`**`, never as `` `**x**` ``.
 */
export const MarkdownCode = Mark.create({
  name: 'code',
  priority: 1,
  excludes: '',
  code: true,
  exitable: true,

  addOptions() {
    return { HTMLAttributes: {} as Record<string, unknown> }
  },

  parseHTML() {
    return [{ tag: 'code' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['code', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  markdownTokenName: 'codespan',

  parseMarkdown: (token, helpers) =>
    helpers.applyMark('code', [{ type: 'text', text: token.text || '' }]),

  renderMarkdown: (node, h) => (node.content ? `\`${h.renderChildren(node.content)}\`` : ''),

  addCommands() {
    return {
      setCode:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleCode:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetCode:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },

  addInputRules() {
    return [markInputRule({ find: inputMatch, type: this.type })]
  },

  addPasteRules() {
    return [markPasteRule({ find: pasteMatches, type: this.type })]
  },
})
