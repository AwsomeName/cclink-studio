import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('StatusBar product boundary', () => {
  it('uses Git as the left status fact and removes redundant Agent/Tab labels', () => {
    const source = readFileSync(new URL('./StatusBar.tsx', import.meta.url), 'utf8')

    expect(source).toContain('<GitStatusBarItem')
    expect(source).not.toContain('AGENT_STATUS_MAP')
    expect(source).not.toContain('TAB_TYPE_LABEL')
    expect(source).not.toContain('Agent 就绪')
    expect(source).not.toContain("statusContextProps('active-tab')")
    expect(source).not.toContain('git-backup-status')
  })
})
