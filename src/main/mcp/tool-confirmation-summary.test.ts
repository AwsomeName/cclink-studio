import { describe, expect, it } from 'vitest'
import { summarizeToolConfirmation } from './tool-confirmation-summary'

describe('summarizeToolConfirmation', () => {
  it('never includes secret values, bodies, query strings, or command text', () => {
    const canary = 'CONFIRMATION_SECRET_CANARY'
    const rows = summarizeToolConfirmation(
      'Bash',
      {
        command: `curl -H 'Authorization: Bearer ${canary}' https://example.com`,
        token: canary,
        body: canary,
        url: `https://user:${canary}@example.com/publish?token=${canary}#secret`,
      },
      '/workspace/a',
    )
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain(canary)
    expect(serialized).not.toContain('Authorization')
    expect(rows).toContainEqual({ label: '内容', value: '脚本或命令内容已隐藏' })
    expect(rows).toContainEqual({
      label: '网址',
      value: 'https://example.com/publish',
      monospace: true,
    })
  })

  it('shows workspace-relative paths and only basenames for external paths', () => {
    expect(
      summarizeToolConfirmation(
        'Write',
        { filePath: '/workspace/a/docs/note.md', sourcePath: '/Users/alice/private/key.pem' },
        '/workspace/a',
      ),
    ).toEqual([
      { label: '文件', value: './docs/note.md', monospace: true },
      { label: '来源', value: '…/key.pem', monospace: true },
    ])
  })

  it('shows the complete CAD parameter snapshot without applying the generic row limit', () => {
    const rows = summarizeToolConfirmation(
      'cad_modify_step',
      {
        inputPath: '/workspace/a/model.step',
        sourceHash: 'a'.repeat(64),
        operation: 'section-insert',
        axis: 'x',
        direction: 'positive',
        distanceMm: 3,
        splitPlane: 3.75,
        fixedSide: 'min',
        outputPath: '/workspace/a/model-longer.step',
        expectedSizeX: 151.17,
        expectedSizeY: 42.9,
        expectedSizeZ: 50.59,
      },
      '/workspace/a',
    )

    expect(rows).toHaveLength(11)
    expect(rows).toContainEqual({ label: '源文件', value: './model.step', monospace: true })
    expect(rows).toContainEqual({ label: '源 SHA-256', value: 'aaaaaaaaaaaa…', monospace: true })
    expect(rows).toContainEqual({ label: '增加距离', value: '3 mm' })
    expect(rows).toContainEqual({
      label: '输出文件',
      value: './model-longer.step',
      monospace: true,
    })
    expect(rows.at(-1)?.value).toContain('不等于可制造')
  })
})
