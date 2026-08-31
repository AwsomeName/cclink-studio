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
})
