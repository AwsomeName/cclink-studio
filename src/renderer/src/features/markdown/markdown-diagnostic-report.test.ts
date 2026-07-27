import { describe, expect, it } from 'vitest'
import { createMarkdownDiagnosticReport } from './markdown-diagnostic-report'

describe('createMarkdownDiagnosticReport', () => {
  it('redacts the home directory and includes actionable round-trip evidence', () => {
    const report = createMarkdownDiagnosticReport({
      filePath: '/Users/private-user/Desktop/work/notes.md',
      stage: 'roundtrip',
      trigger: 'reload',
      source: ['```typescript', 'const retained = true', '```'].join('\n'),
      serialized: ['```typescript', '```'].join('\n'),
      diagnostics: [
        {
          code: 'structural-roundtrip-mismatch',
          severity: 'error',
          message: '代码块不一致',
        },
      ],
      versionHash: 'disk-hash',
      modifiedAt: Date.UTC(2026, 6, 26, 9, 30),
      dirty: false,
      reloadGeneration: 2,
      editorJson: {
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language: 'typescript', ignored: 'secret' },
            content: [{ type: 'text', text: 'const retained = true' }],
          },
        ],
      },
    })

    expect(report).toContain('"file": "~/Desktop/work/notes.md"')
    expect(report).not.toContain('private-user')
    expect(report).toContain('"reloadGeneration": 2')
    expect(report).toContain('"startLine": 1')
    expect(report).toContain('"contentHash"')
    expect(report).toContain('"preview": "const retained = true"')
    expect(report).toContain('"language": "typescript"')
    expect(report).not.toContain('"ignored"')
  })

  it('limits mismatch previews instead of copying the whole document', () => {
    const longCode = 'x'.repeat(500)
    const report = createMarkdownDiagnosticReport({
      stage: 'roundtrip',
      trigger: 'open',
      source: ['```', longCode, '```'].join('\n'),
      serialized: ['```', 'short', '```'].join('\n'),
      diagnostics: [],
      dirty: false,
      reloadGeneration: 0,
    })

    expect(report).not.toContain(longCode)
    expect(report).toContain(`${'x'.repeat(240)}…`)
  })

  it('keeps large editor diagnostics bounded and the embedded JSON complete', () => {
    const editorJson = {
      type: 'doc',
      content: Array.from({ length: 2_000 }, (_, index) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `第 ${index + 1} 段诊断正文` }],
      })),
    }
    const report = createMarkdownDiagnosticReport({
      stage: 'roundtrip',
      trigger: 'open',
      source: '# 大型文档',
      serialized: '# 大型文档',
      diagnostics: [],
      dirty: false,
      reloadGeneration: 0,
      editorJson,
    })
    const json = report.match(/```json\n([\s\S]+)\n```/)?.[1]

    expect(json).toBeTruthy()
    expect(() => JSON.parse(json!)).not.toThrow()
    expect(report.length).toBeLessThan(100_000)
    expect(report).toContain('"omittedChildren"')
  })
})
