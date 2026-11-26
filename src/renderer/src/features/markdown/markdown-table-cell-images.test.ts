import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { MarkdownImage, MarkdownInlineImage } from './MarkdownImage'
import Link from '@tiptap/extension-link'
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
      MarkdownInlineImage,
      Link,
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

describe('images on a line of text', () => {
  it.each([
    ['a paragraph', '段落 ![图](./a.jpg) 后文\n'],
    ['a sized image mid-line', '段落 <img src="./a.jpg" alt="图" width="120"> 后文\n'],
    ['a list item', '- 项目 ![图](./a.jpg) 说明\n'],
  ])('keeps %s valid and writes it back unchanged', (_name, source) => {
    load(source)
    expect(() => editor.state.doc.check()).not.toThrow()
    expect(output(source)).toBe(source)
  })

  it('deletes an image that shares a paragraph with text', () => {
    const source = '前文 ![图](./a.jpg) 后文\n'
    load(source)
    let imagePos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'inlineImage') imagePos = pos
    })
    expect(imagePos).toBeGreaterThan(0)
    expect(() => editor.view.dispatch(editor.state.tr.delete(imagePos, imagePos + 1))).not.toThrow()
    expect(() => editor.state.doc.check()).not.toThrow()
    const saved = output(source)
    expect(saved).not.toContain('![图]')
    expect(saved).toContain('前文')
    expect(saved).toContain('后文')
  })

  it('keeps an image alone on its line a block image', () => {
    load('前文\n\n![图](./a.jpg)\n\n后文\n')
    const types: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name.toLowerCase().includes('image')) types.push(node.type.name)
    })
    expect(types).toEqual(['image'])
  })
})
