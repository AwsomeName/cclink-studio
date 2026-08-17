import { describe, expect, it } from 'vitest'
import { parseGitNumstat, parseGitStatusPorcelainV2 } from './git-status-parser'

describe('git-status-parser', () => {
  it('parses branch metadata and de-duplicates staged and unstaged paths', () => {
    const output = [
      '# branch.oid abcdef1234567890',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 MM N... 100644 100644 100644 aaaaaaa bbbbbbb src/file with spaces.ts',
      '1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb README.md',
      '2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/new-name.ts',
      'src/old-name.ts',
      '? notes/new file.md',
      'u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc conflict.txt',
      '',
    ].join('\0')

    expect(parseGitStatusPorcelainV2(output)).toEqual({
      headOid: 'abcdef1234567890',
      branch: 'main',
      detached: false,
      unborn: false,
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      changeCount: 5,
      stagedCount: 2,
      unstagedCount: 2,
      untrackedCount: 1,
      conflictedCount: 1,
      changes: [
        {
          path: 'conflict.txt',
          originalPath: null,
          stagedStatus: 'U',
          unstagedStatus: 'U',
          untracked: false,
          conflicted: true,
        },
        {
          path: 'notes/new file.md',
          originalPath: null,
          stagedStatus: null,
          unstagedStatus: null,
          untracked: true,
          conflicted: false,
        },
        {
          path: 'README.md',
          originalPath: null,
          stagedStatus: null,
          unstagedStatus: 'M',
          untracked: false,
          conflicted: false,
        },
        {
          path: 'src/file with spaces.ts',
          originalPath: null,
          stagedStatus: 'M',
          unstagedStatus: 'M',
          untracked: false,
          conflicted: false,
        },
        {
          path: 'src/new-name.ts',
          originalPath: 'src/old-name.ts',
          stagedStatus: 'R',
          unstagedStatus: null,
          untracked: false,
          conflicted: false,
        },
      ],
    })
  })

  it('preserves detached and unborn states without inventing an upstream', () => {
    expect(
      parseGitStatusPorcelainV2(
        ['# branch.oid (initial)', '# branch.head main', '? README.md', ''].join('\0'),
      ),
    ).toMatchObject({
      headOid: null,
      branch: 'main',
      detached: false,
      unborn: true,
      upstream: null,
      ahead: null,
      behind: null,
    })

    expect(
      parseGitStatusPorcelainV2(
        ['# branch.oid abcdef0', '# branch.head (detached)', ''].join('\0'),
      ),
    ).toMatchObject({ branch: null, detached: true, unborn: false })
  })

  it('sums known numstat rows and marks binary rows incomplete', () => {
    expect(
      parseGitNumstat(
        ['12\t3\tsrc/file.ts', '-\t-\tassets/image.png', '4\t0\t', 'old', 'new', ''].join('\0'),
      ),
    ).toEqual({ additions: 16, deletions: 3, incomplete: true })
  })
})
