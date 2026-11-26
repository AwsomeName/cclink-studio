import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { MarkdownImage } from './MarkdownImage'
import { parseMarkdownEditorDocument } from './markdown-editor-document'
import { inspectMarkdownRoundTrip, normalizeMarkdownEditorOutput } from './markdown-codec'

const HEAD = '| 事项 | 进展 |\n| --- | --- |\n'
let editor: Editor

beforeEach(() => {
  vi.stubGlobal('window', { HTMLUnknownElement: class {} })
  editor = new Editor({
    element: null,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown,
      Table,
      TableRow,
      TableCell,
      TableHeader,
      MarkdownImage.configure({ inline: false }),
    ],
  })
})

afterEach(() => {
  editor.destroy()
  vi.unstubAllGlobals()
})

function load(source: string): void {
  editor.commands.setContent(parseMarkdownEditorDocument(editor, source), { emitUpdate: false })
}

function output(reference: string): string {
  return normalizeMarkdownEditorOutput(editor.getMarkdown(), reference)
}

describe('images inside Markdown table cells', () => {
  it('parses text and images in one cell into valid blocks', () => {
    load(`${HEAD}| 外壳 | 喇叭集成 ![图](./a.jpg) 光机修角 |\n`)
    expect(() => editor.state.doc.check()).not.toThrow()
  })

  it('deletes an image from a cell without breaking the document', () => {
    const source = `${HEAD}| 外壳 | 喇叭集成 ![图](./a.jpg) 光机修角 |\n`
    load(source)
    let imagePos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') imagePos = pos
    })
    expect(imagePos).toBeGreaterThan(0)
    expect(() =>
      editor.view.dispatch(
        editor.state.tr.delete(imagePos, imagePos + editor.state.doc.nodeAt(imagePos)!.nodeSize),
      ),
    ).not.toThrow()
    const saved = output(source)
    expect(saved).not.toContain('![图]')
    expect(saved).toContain('喇叭集成 光机修角')
  })

  it('writes the blocks of a cell on one line with spaces, never U+001F', () => {
    const source = `${HEAD}| 外壳 | 集成 ![图](./a.jpg) 修角 <img src="./b.jpg" alt="图2" width="300"> 内沉 |\n`
    load(source)
    const saved = output(source)
    expect(saved).not.toContain('\u001f')
    expect(saved).toContain(
      '集成 ![图](./a.jpg) 修角 <img src="./b.jpg" alt="图2" width="300"> 内沉',
    )
  })

  it('repairs a file an earlier version saved with U+001F separators', () => {
    const damaged = `${HEAD}| 外壳 | 集成\u001f![图](./a.jpg)\u001f修角 |\n`
    load(damaged)
    expect(() => editor.state.doc.check()).not.toThrow()
    const saved = output(damaged)
    expect(saved).not.toContain('\u001f')
    expect(saved).toContain('| 外壳  | 集成 ![图](./a.jpg) 修角 |')
    // The damaged and repaired text are the same document, so the file still opens editable.
    expect(inspectMarkdownRoundTrip(damaged, saved).equivalent).toBe(true)
  })
})
