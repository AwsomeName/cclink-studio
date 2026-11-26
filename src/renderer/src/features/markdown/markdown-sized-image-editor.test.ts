import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { analyzeMarkdown, inspectMarkdownRoundTrip } from './markdown-codec'
import { MarkdownLiteralBlock } from './markdown-literal-block'
import { parseMarkdownEditorDocument } from './markdown-editor-document'
import { MarkdownImage } from './MarkdownImage'
import { inspectMarkdownEditorBeforeSave } from './markdown-save-guard'

let editor: Editor

function images(): Array<{ src: string; width: unknown }> {
  const found: Array<{ src: string; width: unknown }> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image') found.push({ src: node.attrs.src, width: node.attrs.width })
    return true
  })
  return found
}

function load(source: string): void {
  editor.commands.setContent(parseMarkdownEditorDocument(editor, source), { emitUpdate: false })
}

beforeEach(() => {
  vi.stubGlobal('window', { HTMLUnknownElement: class {} })
  editor = new Editor({
    element: null,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    extensions: [
      StarterKit.configure({ link: false }),
      Markdown,
      MarkdownLiteralBlock,
      MarkdownImage.configure({ inline: false }),
      Table,
      TableRow,
      TableCell,
      TableHeader,
    ],
  })
})

afterEach(() => {
  editor.destroy()
  vi.unstubAllGlobals()
})

describe('sized images in the Markdown editor', () => {
  it('is supported content, not raw HTML', () => {
    const source = '# 选型\n\n<img src="a.assets/x.png" alt="喇叭" width="160">\n'
    expect(analyzeMarkdown(source).diagnostics).toEqual([])
    expect(analyzeMarkdown('<img src="x.png" style="zoom:50%">\n').diagnostics[0]?.code).toBe(
      'unsupported-html',
    )
  })

  it('parses a standalone and a table-cell sized image with their widths', () => {
    load(
      [
        '<img src="a.png" alt="甲" width="160">',
        '',
        '| 事项 | 照片 |',
        '| --- | --- |',
        '| 喇叭 | <img src="b.png" alt="乙" width="240"> |',
        '',
        '![丙](c.png)',
        '',
      ].join('\n'),
    )
    expect(images()).toEqual([
      { src: 'a.png', width: 160 },
      { src: 'b.png', width: 240 },
      { src: 'c.png', width: null },
    ])
  })

  it('writes the strict tag only for images with a width', () => {
    const source = '<img src="a.png" alt="甲" width="160">\n\n![丙](c.png)\n'
    load(source)
    const output = editor.getMarkdown()
    expect(output).toContain('<img src="a.png" alt="甲" width="160">')
    expect(output).toContain('![丙](c.png)')
    expect(inspectMarkdownRoundTrip(source, output).equivalent).toBe(true)
  })

  it('keeps a width set on an image inside a table cell', () => {
    load('| 事项 | 照片 |\n| --- | --- |\n| 喇叭 | ![甲](a.png) |\n')
    let position = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') position = pos
      return true
    })
    editor.view.dispatch(editor.state.tr.setNodeAttribute(position, 'width', 200))
    expect(editor.getMarkdown()).toContain('<img src="a.png" alt="甲" width="200">')
    const inspection = inspectMarkdownEditorBeforeSave(
      editor,
      '| 事项 | 照片 |\n| --- | --- |\n| 喇叭 | ![甲](a.png) |\n',
    )
    expect(inspection.diagnostics).toEqual([])
    expect(inspection.safeToSave).toBe(true)
  })

  it('keeps documents with images in cells and on their own line unchanged on load', () => {
    const source = [
      '| 事项 | 照片 |',
      '| --- | --- |',
      '| 喇叭 | ![甲](a.png) |',
      '',
      '上午测了，见图：',
      '',
      '![乙](b.png)',
      '',
      '文字中间 ![丙](c.png) 还有文字',
      '',
    ].join('\n')
    load(source)
    const output = editor.getMarkdown()
    expect(output).toMatch(/\| 喇叭 +\| !\[甲\]\(a\.png\) +\|/)
    expect(inspectMarkdownRoundTrip(source, output).equivalent).toBe(true)
  })

  it('goes back to plain image syntax when the width is cleared', () => {
    load('<img src="a.png" alt="甲" width="160">\n')
    let position = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') position = pos
      return true
    })
    editor.view.dispatch(editor.state.tr.setNodeAttribute(position, 'width', null))
    expect(editor.getMarkdown().trim()).toBe('![甲](a.png)')
  })

  it('reports a changed width as a round-trip difference', () => {
    const before = '<img src="a.png" alt="甲" width="160">\n'
    const after = '<img src="a.png" alt="甲" width="200">\n'
    const inspection = inspectMarkdownRoundTrip(before, after)
    expect(inspection.equivalent).toBe(false)
    expect(inspection.differences.map((item) => item.key)).toEqual(['imageWidths'])
  })
})
