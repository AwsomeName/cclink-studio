import { describe, expect, it } from 'vitest'
import {
  findForbiddenCclinkStudioPaths,
  updateCclinkStudioExcludeBlock,
} from './cclink-studio-path-policy'

describe('CCLink Studio tracked path policy', () => {
  it('allows only valid shared scheduled task JSON paths', () => {
    expect(
      findForbiddenCclinkStudioPaths([
        '.cclink-studio/shared/scheduled-tasks/12345678-1234-1234-1234-123456789abc.json',
        '.cclink-studio/scheduled-tasks/12345678-1234-1234-1234-123456789abc.json',
        '.cclink-studio/shared/scheduled-tasks/task.tmp',
        '.cclink-studio/shared/scheduled-tasks/nested/task.json',
      ]),
    ).toEqual([
      '.cclink-studio/scheduled-tasks/12345678-1234-1234-1234-123456789abc.json',
      '.cclink-studio/shared/scheduled-tasks/task.tmp',
      '.cclink-studio/shared/scheduled-tasks/nested/task.json',
    ])
  })

  it('updates its managed ignore block while preserving user rules', () => {
    const first = updateCclinkStudioExcludeBlock(
      'user-rule\n# CCLink Studio manual backup\n.cclink-studio/\n',
    )
    const second = updateCclinkStudioExcludeBlock(first)
    expect(second).toBe(first)
    expect(first).toContain('user-rule')
    expect(first).not.toContain('\n.cclink-studio/\n')
    expect(first).toContain('!/.cclink-studio/shared/scheduled-tasks/*.json')
  })
})
