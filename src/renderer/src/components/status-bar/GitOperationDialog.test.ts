import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('GitOperationDialog product boundary', () => {
  it('uses a compact actionable commit menu with direct close and partial-success feedback', () => {
    const source = readFileSync(new URL('./GitOperationDialog.tsx', import.meta.url), 'utf8')

    expect(source).toContain('aria-modal="true"')
    expect(source).toContain("tab === 'commit' ? 'compact' : ''")
    expect(source).toContain('createDefaultCommitMessage(snapshot, selectedPaths)')
    expect(source).not.toContain('放弃未提交的编辑？')
    expect(source).not.toContain('confirmDiscard')
    expect(source).toContain('提交成功，Push 失败')
    expect(source).toContain('本地提交已保留')
    expect(source).not.toContain('onMouseDown={closeDialog}')
  })
})
