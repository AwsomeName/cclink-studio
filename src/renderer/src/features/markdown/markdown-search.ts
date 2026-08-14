import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface MarkdownSearchMatch {
  from: number
  to: number
}

interface MarkdownSearchHighlightState {
  matches: MarkdownSearchMatch[]
  activeIndex: number
}

const markdownSearchHighlightKey = new PluginKey<DecorationSet>('markdownSearchHighlight')

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Finds literal text inside each Markdown text block and returns ProseMirror positions.
 * A block boundary is intentionally a search boundary so locating text never creates a
 * selection that spans unrelated paragraphs, list items, headings, or table cells.
 */
export function findMarkdownTextMatches(
  document: ProseMirrorNode,
  query: string,
): MarkdownSearchMatch[] {
  if (!query) return []

  const matcher = new RegExp(escapeRegExp(query), 'giu')
  const matches: MarkdownSearchMatch[] = []

  document.descendants((node, nodePosition) => {
    if (!node.isTextblock) return true

    let text = ''
    const positions: number[] = []
    node.descendants((child, childPosition) => {
      if (child.isText && child.text) {
        for (let index = 0; index < child.text.length; index += 1) {
          text += child.text[index]
          positions.push(nodePosition + 1 + childPosition + index)
        }
      } else if (child.type.name === 'hardBreak') {
        text += '\n'
        positions.push(nodePosition + 1 + childPosition)
      } else if (child.isInline && child.isAtom) {
        text += '\uFFFC'
        positions.push(nodePosition + 1 + childPosition)
      }
      return false
    })

    matcher.lastIndex = 0
    for (const match of text.matchAll(matcher)) {
      const start = match.index
      const end = start + match[0].length - 1
      if (positions[start] === undefined || positions[end] === undefined) continue
      matches.push({ from: positions[start], to: positions[end] + 1 })
    }
    return false
  })

  return matches
}

export const MarkdownSearchHighlights = Extension.create({
  name: 'markdownSearchHighlights',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: markdownSearchHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (transaction, decorations) => {
            const highlightState = transaction.getMeta(markdownSearchHighlightKey) as
              | MarkdownSearchHighlightState
              | undefined
            if (!highlightState) return decorations.map(transaction.mapping, transaction.doc)
            return DecorationSet.create(
              transaction.doc,
              highlightState.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class:
                    index === highlightState.activeIndex
                      ? 'markdown-search-match markdown-search-match-active'
                      : 'markdown-search-match',
                }),
              ),
            )
          },
        },
        props: {
          decorations: (state) => markdownSearchHighlightKey.getState(state),
        },
      }),
    ]
  },
})

export function setMarkdownSearchHighlights(
  editor: Editor,
  matches: MarkdownSearchMatch[],
  activeIndex: number,
): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(markdownSearchHighlightKey, { matches, activeIndex }),
  )
}
