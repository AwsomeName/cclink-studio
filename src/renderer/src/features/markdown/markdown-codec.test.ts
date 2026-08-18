import { describe, expect, it } from 'vitest'
import {
  analyzeMarkdown,
  hashMarkdownSnapshot,
  hashMarkdownSnapshotSha256,
  inspectMarkdownRoundTrip,
  mapTopLevelSelectionToSource,
  normalizeMarkdownEditorOutput,
  prepareMarkdownEditorInput,
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

  it('rejects destructive extended syntax while tolerating preserved math as text', () => {
    const mdx = analyzeMarkdown("import Card from './Card'\n\n<Card />")
    expect(mdx.safeToEdit).toBe(false)
    expect(mdx.diagnostics.map((item) => item.code)).toContain('unsupported-mdx')

    const extended = analyzeMarkdown('$$\nx = 1\n$$\n\n[^a]: note')
    expect(extended.safeToEdit).toBe(false)
    expect(extended.diagnostics.map((item) => item.code)).toEqual([
      'unsupported-math',
      'unsupported-footnote',
    ])
    expect(extended.diagnostics[0]).toMatchObject({
      code: 'unsupported-math',
      severity: 'warning',
    })
  })

  it('allows math to open as text and only blocks saving when a formula is lost', () => {
    const source = [
      '# Hebbian 学习',
      '',
      '权重更新为 $\\Delta w = \\eta xy$。',
      '',
      '$$',
      'w_{t+1} = w_t + \\eta x_t y_t',
      '$$',
    ].join('\n')

    expect(analyzeMarkdown(source)).toMatchObject({
      safeToEdit: true,
      safeToSave: true,
      diagnostics: [expect.objectContaining({ code: 'unsupported-math', severity: 'warning' })],
    })
    expect(analyzeMarkdown(source, source).safeToSave).toBe(true)

    const lostFormula = '# Hebbian 学习\n\n权重更新公式。\n'
    const unsafe = analyzeMarkdown(source, lostFormula)
    expect(unsafe.safeToSave).toBe(false)
    expect(unsafe.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'structural-roundtrip-mismatch',
        severity: 'error',
        message: expect.stringContaining('数学公式'),
      }),
    )
  })

  it('does not mistake currency ranges or escaped dollar signs for math', () => {
    const source = '价格从 $5 增长到 $10，转义金额为 \\$20。'

    expect(analyzeMarkdown(source)).toMatchObject({
      safeToEdit: true,
      diagnostics: [],
    })
  })

  it('restores Tiptap text escapes inside math before validation and saving', () => {
    const serialized = [
      '# Hebbian 学习',
      '',
      '权重更新为 $\\\\Delta w = \\\\eta xy$。',
      '',
      '$$',
      'w\\_{t+1} = w\\_t + \\\\eta x\\_t y\\_t',
      '$$',
      '',
      '价格从 $5 增长到 $10，转义金额为 \\$20。',
      '',
      '```text',
      '$\\\\Delta code$',
      '```',
    ].join('\n')

    expect(normalizeMarkdownEditorOutput(serialized)).toBe(
      [
        '# Hebbian 学习',
        '',
        '权重更新为 $\\Delta w = \\eta xy$。',
        '',
        '$$',
        'w_{t+1} = w_t + \\eta x_t y_t',
        '$$',
        '',
        '价格从 \\$5 增长到 \\$10，转义金额为 \\$20。',
        '',
        '```text',
        '$\\\\Delta code$',
        '```',
      ].join('\n'),
    )
  })

  it('keeps currency ranges literal while leaving code dollars untouched', () => {
    expect(normalizeMarkdownEditorOutput('区间 $5–$10，代码 `$value`。')).toBe(
      '区间 \\$5–\\$10，代码 `$value`。',
    )
  })

  it('keeps the exact source of an unchanged formula when a reference is available', () => {
    const reference = '字面下划线 $x\\_label + \\Delta$。'
    const serialized = '字面下划线 $x\\_label + \\\\Delta$。'

    expect(normalizeMarkdownEditorOutput(serialized, reference)).toBe(reference)
  })

  it('protects LaTeX punctuation from Markdown and HTML parsing artifacts', () => {
    const source = [
      '$$',
      '\\Delta w = \\eta \\cdot \\underbrace{x}_{\\text{输入}} \\cdot \\underbrace{y}_{\\text{输出}}',
      '$$',
      '',
      '$$',
      '\\Delta w = \\begin{cases} A^+ & \\Delta t > 0 \\\\ -A^- & \\Delta t < 0 \\end{cases}',
      '$$',
    ].join('\n')
    const prepared = prepareMarkdownEditorInput(source)

    expect(prepared).toContain('\\underbrace\\{x\\}\\_\\{\\text\\{输入\\}\\}')
    expect(prepared).toContain('A\\^\\+ \\& \\Delta t \\> 0')
    expect(normalizeMarkdownEditorOutput(prepared, source)).toBe(source)
  })

  it('repairs known Tiptap math artifacts without hiding a real formula edit', () => {
    const reference = [
      '$$',
      '\\Delta w = \\underbrace{x}_{\\text{输入}}',
      '$$',
      '',
      '$$',
      'A^+ & \\Delta t > 0',
      '$$',
    ].join('\n')
    const serialized = [
      '$$',
      '\\\\Delta w = \\\\underbrace{x}*{\\\\text{输入}}',
      '$$',
      '',
      '$$',
      'A^+ &amp; \\\\Delta t &gt; 0',
      '$$',
    ].join('\n')

    expect(normalizeMarkdownEditorOutput(serialized, reference)).toBe(reference)
    expect(normalizeMarkdownEditorOutput('$x + z$', '$x + y$')).toBe('$x + z$')
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

  it('accepts the controlled CCLink resource declaration without exposing an HTML block', () => {
    const source =
      '<!-- cclink-document: {"version":1,"resources":"notes.assets/manifest.json"} -->\n\n# Notes'
    const analysis = analyzeMarkdown(source, '# Notes')

    expect(analysis.safeToEdit).toBe(true)
    expect(analysis.safeToSave).toBe(true)
    expect(analysis.blocks.map((block) => block.kind)).toEqual(['heading'])
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

  it('blocks subtle content and formatting losses before save', () => {
    const cases = [
      ['正文不能丢字', '正文不能'],
      ['7. 保留起始序号', '1. 保留起始序号'],
      ['| 左 | 右 |\n| :--- | ---: |\n| a | b |', '| 左 | 右 |\n| --- | --- |\n| a | b |'],
      ['[链接](https://example.com "标题")', '[链接](https://example.com)'],
      ['![替代文本](image.png "标题")', '![另一个文本](image.png "标题")'],
      ['第一行  \n第二行', '第一行 第二行'],
    ]

    for (const [source, damaged] of cases) {
      expect(analyzeMarkdown(source, damaged).safeToSave).toBe(false)
    }
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

  it('treats equivalent task marker spelling as the same visible content', () => {
    const source = '* [X] 已完成\n+ [ ] 未完成'
    const serialized = '- [x] 已完成\n- [ ] 未完成'

    expect(analyzeMarkdown(source, serialized)).toMatchObject({
      safeToSave: true,
      diagnostics: [],
    })
  })

  it('does not treat an escaped checkbox-like list prefix as task metadata', () => {
    expect(analyzeMarkdown('- \\[X] 字面正文', '- 字面正文').safeToSave).toBe(false)
  })

  it('accepts equivalent setext headings, reference links and autolinks', () => {
    const source = [
      '计划',
      '====',
      '',
      '访问 <https://example.com>。',
      '',
      '查看 [内部文档][guide]。',
      '',
      '[guide]: ./资料/说明.md',
    ].join('\n')
    const serialized = [
      '# 计划',
      '',
      '访问 [https://example.com](https://example.com)。',
      '',
      '查看 [内部文档](./%E8%B5%84%E6%96%99/%E8%AF%B4%E6%98%8E.md)。',
    ].join('\n')

    expect(analyzeMarkdown(source, serialized)).toMatchObject({
      safeToSave: true,
      diagnostics: [],
    })
  })

  it('uses the editor parser semantics for email autolinks beside CJK punctuation', () => {
    const source = ['联系邮箱：shenxinzhizao@163.com', '', '开发者社区：http://Dev.to'].join('\n')
    const serialized = [
      '联系邮箱：[shenxinzhizao@163.com](mailto:shenxinzhizao@163.com)',
      '',
      '开发者社区：[http://Dev.to](http://Dev.to)',
    ].join('\n')

    expect(inspectMarkdownRoundTrip(source, serialized)).toMatchObject({
      catastrophic: false,
      equivalent: true,
      differences: [],
    })
    expect(analyzeMarkdown(source, serialized)).toMatchObject({
      safeToSave: true,
      diagnostics: [],
    })
  })

  it('still blocks a real link destination change', () => {
    const source = '[联系邮箱](mailto:old@example.com)'
    const serialized = '[联系邮箱](mailto:new@example.com)'

    expect(analyzeMarkdown(source, serialized)).toMatchObject({
      safeToSave: false,
      diagnostics: [
        expect.objectContaining({
          code: 'structural-roundtrip-mismatch',
          message: expect.stringContaining('链接'),
        }),
      ],
    })
  })

  it('accepts equivalent indented, fenced and plain-language code blocks', () => {
    const source = [
      '缩进代码：',
      '',
      '    const indented = true',
      '',
      '围栏代码：',
      '',
      '```',
      'plain text',
      '```',
    ].join('\n')
    const serialized = [
      '缩进代码：',
      '',
      '```',
      'const indented = true',
      '```',
      '',
      '围栏代码：',
      '',
      '```plaintext',
      'plain text',
      '```',
    ].join('\n')

    expect(analyzeMarkdown(source, serialized)).toMatchObject({
      safeToSave: true,
      diagnostics: [],
    })
  })

  it('accepts multiple indented code blocks normalized into fences', () => {
    const source = [
      '上午计划',
      '',
      '    first task',
      '',
      '    second task',
      '',
      '下午计划',
      '',
      '    third task',
    ].join('\n')
    const serialized = [
      '上午计划',
      '',
      '```',
      'first task',
      '',
      'second task',
      '```',
      '',
      '下午计划',
      '',
      '```plaintext',
      'third task',
      '```',
    ].join('\n')

    expect(analyzeMarkdown(source, serialized)).toMatchObject({
      safeToSave: true,
      diagnostics: [],
    })
  })

  it('blocks code block content loss even when the language stays unchanged', () => {
    const analysis = analyzeMarkdown(
      ['```typescript', 'const retained = true', '```'].join('\n'),
      ['```typescript', '```'].join('\n'),
    )

    expect(analysis.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'structural-roundtrip-mismatch',
        message: expect.stringContaining('代码块'),
      }),
    )
  })

  it('reports the exact code block position and fingerprints for a round-trip mismatch', () => {
    const source = [
      '# Notes',
      '',
      '```typescript',
      'const retained = true',
      '```',
      '',
      '```json',
      '{"ok":true}',
      '```',
    ].join('\n')
    const serialized = [
      '# Notes',
      '',
      '```typescript',
      '```',
      '',
      '```json',
      '{"ok":true}',
      '```',
    ].join('\n')

    const inspection = inspectMarkdownRoundTrip(source, serialized)

    expect(inspection.equivalent).toBe(false)
    expect(inspection.differences).toHaveLength(1)
    expect(inspection.differences[0]).toMatchObject({
      key: 'codeBlocks',
      label: '代码块',
      before: [
        {
          index: 1,
          startLine: 3,
          endLine: 5,
          language: 'typescript',
          contentLines: 1,
          contentLength: 21,
          preview: 'const retained = true',
        },
        {
          index: 2,
          startLine: 7,
          endLine: 9,
          language: 'json',
          preview: '{"ok":true}',
        },
      ],
      after: [
        {
          index: 1,
          startLine: 3,
          endLine: 4,
          language: 'typescript',
          contentLines: 0,
          contentLength: 0,
          preview: '',
        },
        {
          index: 2,
          startLine: 6,
          endLine: 8,
          language: 'json',
          preview: '{"ok":true}',
        },
      ],
    })
  })

  it('reports which critical structures differ', () => {
    const analysis = analyzeMarkdown('# 标题\n\n[链接](https://example.com)', '正文')

    expect(analysis.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'structural-roundtrip-mismatch',
        message: expect.stringContaining('标题、链接'),
      }),
    )
  })

  it('accepts intentional structural edits when the dirty draft is validated as the new source', () => {
    const saved = ['原始段落', '', '- 旧列表项'].join('\n')
    const dirtyDraft = ['新段落', '', '---', '', '1. 新列表项'].join('\n')

    // 两个版本本来就不等价；这不能用来判断草稿是否可恢复。
    expect(analyzeMarkdown(saved, dirtyDraft).safeToSave).toBe(false)
    expect(analyzeMarkdown(dirtyDraft).safeToEdit).toBe(true)
    expect(analyzeMarkdown(dirtyDraft, dirtyDraft).safeToSave).toBe(true)
  })

  it('creates stable compact snapshot hashes', () => {
    expect(hashMarkdownSnapshot('same')).toBe(hashMarkdownSnapshot('same'))
    expect(hashMarkdownSnapshot('same')).not.toBe(hashMarkdownSnapshot('other'))
  })

  it('creates SHA-256 snapshot hashes for IPC resources', async () => {
    await expect(hashMarkdownSnapshotSha256('same')).resolves.toBe(
      '0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5',
    )
  })
})
