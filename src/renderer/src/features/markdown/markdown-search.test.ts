import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  findMarkdownTextMatches,
  MarkdownSearchHighlights,
  setMarkdownSearchHighlights,
} from './markdown-search'

let editor: Editor

beforeEach(() => {
  vi.stubGlobal('window', { HTMLUnknownElement: class {} })
  editor = new Editor({
    element: null,
    extensions: [StarterKit, Markdown, MarkdownSearchHighlights],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  })
})

afterEach(() => {
  editor.destroy()
  vi.unstubAllGlobals()
})

describe('findMarkdownTextMatches', () => {
  it('finds literal text case-insensitively and returns selectable positions', () => {
    editor.commands.setContent('Target target TARGET', { contentType: 'markdown' })

    const matches = findMarkdownTextMatches(editor.state.doc, 'target')

    expect(matches).toHaveLength(3)
    expect(matches.map(({ from, to }) => editor.state.doc.textBetween(from, to, '\n'))).toEqual([
      'Target',
      'target',
      'TARGET',
    ])
  })

  it('finds text split by inline formatting marks', () => {
    editor.commands.setContent('查找**目标**就在这里', { contentType: 'markdown' })

    const [match] = findMarkdownTextMatches(editor.state.doc, '查找目标')

    expect(match).toBeDefined()
    expect(editor.state.doc.textBetween(match.from, match.to, '\n')).toBe('查找目标')
  })

  it('treats punctuation in the query as literal text', () => {
    editor.commands.setContent('金额是 $5.00，表达式是 a+b。', { contentType: 'markdown' })

    expect(findMarkdownTextMatches(editor.state.doc, '$5.00')).toHaveLength(1)
    expect(findMarkdownTextMatches(editor.state.doc, 'a+b')).toHaveLength(1)
  })

  it('does not create a match across separate Markdown blocks', () => {
    editor.commands.setContent('第一段末尾\n\n第二段开头', { contentType: 'markdown' })

    expect(findMarkdownTextMatches(editor.state.doc, '末尾第二段')).toEqual([])
  })

  it('returns no matches for an empty or absent query', () => {
    editor.commands.setContent('现有正文', { contentType: 'markdown' })

    expect(findMarkdownTextMatches(editor.state.doc, '')).toEqual([])
    expect(findMarkdownTextMatches(editor.state.doc, '不存在')).toEqual([])
  })

  it('updates highlights without changing the Markdown document', () => {
    editor.commands.setContent('定位目标，继续定位目标。', { contentType: 'markdown' })
    const matches = findMarkdownTextMatches(editor.state.doc, '定位目标')
    const before = editor.getMarkdown()
    const beforeDocument = editor.state.doc

    setMarkdownSearchHighlights(editor, matches, 1)

    expect(editor.getMarkdown()).toBe(before)
    expect(editor.state.doc.eq(beforeDocument)).toBe(true)
  })
})
