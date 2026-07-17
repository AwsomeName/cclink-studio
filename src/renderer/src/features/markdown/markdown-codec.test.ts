import { describe, expect, it } from 'vitest'
import {
  analyzeMarkdown,
  hashMarkdownSnapshot,
  mapTopLevelSelectionToSource,
  scanMarkdownBlocks,
  sourceRangeFromOffsets,
} from './markdown-codec'

describe('markdown-codec', () => {
  it('scans frontmatter, normal blocks, mermaid, tables and raw html in source order', () => {
    const source = [
      '---',
      'title: Demo',
      '---',
      '',
      '# 标题',
      '',
      '- A',
      '- B',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '<details>',
      '<summary>更多</summary>',
      '</details>',
    ].join('\n')

    expect(scanMarkdownBlocks(source).map((block) => block.kind)).toEqual([
      'frontmatter',
      'heading',
      'list',
      'table',
      'mermaid',
      'html',
    ])
  })

  it('maps ordered editor nodes to markdown lines without searching duplicate text', () => {
    const source = ['重复', '', '重复', '', '> 重复', '', '```ts', '重复', '```'].join('\n')
    const result = mapTopLevelSelectionToSource(source, 1, 2, '重复')

    expect(result.range).toMatchObject({
      startLine: 3,
      endLine: 5,
      selectedText: '重复',
      sourceSnapshot: ['重复', '', '> 重复'].join('\n'),
    })
  })

  it('computes exact source ranges from CodeMirror offsets', () => {
    const source = '第一行\n第二行内容\n第三行'
    const start = source.indexOf('二')
    const end = source.indexOf('容') + 1

    expect(sourceRangeFromOffsets(source, start, end)).toEqual({
      startLine: 2,
      endLine: 2,
      startColumn: 2,
      endColumn: 6,
      selectedText: '二行内容',
      sourceSnapshot: '第二行内容',
    })
  })

  it('rejects unsupported extended syntax instead of creating special blocks', () => {
    const mdx = analyzeMarkdown("import Card from './Card'\n\n<Card />")
    expect(mdx.safeToEdit).toBe(false)
    expect(mdx.diagnostics.map((item) => item.code)).toContain('unsupported-mdx')

    const extended = analyzeMarkdown('$$\nx = 1\n$$\n\n[^a]: note')
    expect(extended.safeToEdit).toBe(false)
    expect(extended.diagnostics.map((item) => item.code)).toEqual([
      'unsupported-math',
      'unsupported-footnote',
    ])
  })

  it('does not reject unsupported-looking text inside ordinary code fences', () => {
    const source = [
      '# 示例',
      '',
      '```tsx',
      "import Card from './Card'",
      '<Card />',
      '$$',
      '[^note]: footnote',
      ':::tip',
      '```',
    ].join('\n')

    expect(analyzeMarkdown(source)).toMatchObject({
      safeToEdit: true,
      diagnostics: [],
    })
  })

  it('rejects frontmatter and raw html before entering edit mode', () => {
    const analysis = analyzeMarkdown(
      ['---', 'title: Demo', '---', '', '<section>raw</section>', '', '# Heading'].join('\n'),
    )
    expect(analysis.safeToEdit).toBe(false)
    expect(analysis.diagnostics.map((item) => item.code)).toEqual([
      'unsupported-frontmatter',
      'unsupported-html',
    ])
  })

  it('accepts markdown autolinks and code spans while rejecting inline raw html', () => {
    const supported = analyzeMarkdown(
      [
        '访问 <https://example.com>。',
        '',
        '将 `<span>text</span>` 当作代码。',
        '',
        '转义标签：\\<span>不是 HTML\\</span>。',
      ].join('\n'),
    )
    expect(supported).toMatchObject({ safeToEdit: true, diagnostics: [] })

    const unsupported = analyzeMarkdown('普通正文里包含 <span>原始 HTML</span>。')
    expect(unsupported.safeToEdit).toBe(false)
    expect(unsupported.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported-html' }),
    )
  })

  it('blocks catastrophic round trips that collapse a normal document', () => {
    const source = Array.from(
      { length: 20 },
      (_, index) => `## 第 ${index + 1} 节\n\n这是第 ${index + 1} 节的完整正文内容。`,
    ).join('\n\n')
    const analysis = analyzeMarkdown(source, '---\n\n---')

    expect(analysis.safeToSave).toBe(false)
    expect(analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'catastrophic-roundtrip', severity: 'error' }),
    )
  })

  it('blocks round trips that lose supported critical structures', () => {
    const source = [
      '# 标题',
      '',
      '- [x] 已完成',
      '',
      '```typescript',
      'const answer = 42',
      '```',
      '',
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| 图片 | 完成 |',
      '',
      '![图片](fixture.png)',
      '',
      '[链接](https://example.com)',
    ].join('\n')
    const serialized = ['# 标题', '', '已完成', '', 'const answer = 42'].join('\n')
    const analysis = analyzeMarkdown(source, serialized)

    expect(analysis.safeToSave).toBe(false)
    expect(analysis.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'structural-roundtrip-mismatch', severity: 'error' }),
    )
  })

  it('allows formatting normalization when critical structures stay equivalent', () => {
    const source = [
      '# 标题',
      '',
      '| 名称 | 状态 |',
      '| --- | --- |',
      '| 图片 | 完成 |',
      '',
      '![图片](fixture.png "标题")',
    ].join('\n')
    const serialized = [
      '# 标题',
      '',
      '| 名称  | 状态  |',
      '| --- | --- |',
      '| 图片  | 完成  |',
      '',
      '![图片](fixture.png "标题")',
    ].join('\n')

    expect(analyzeMarkdown(source, serialized).safeToSave).toBe(true)
  })

  it('creates stable compact snapshot hashes', () => {
    expect(hashMarkdownSnapshot('same')).toBe(hashMarkdownSnapshot('same'))
    expect(hashMarkdownSnapshot('same')).not.toBe(hashMarkdownSnapshot('other'))
  })
})
