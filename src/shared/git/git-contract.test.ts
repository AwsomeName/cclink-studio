import { describe, expect, it } from 'vitest'
import { gitIpc, gitIpcContracts } from './git-contract'

describe('Git IPC contract', () => {
  it('binds every definition to a bounded absolute workspace path parser', () => {
    expect(Object.keys(gitIpcContracts)).toEqual(Object.keys(gitIpc))
    expect(gitIpcContracts.getSnapshot.parseArgs(['/workspace/project'])).toEqual([
      '/workspace/project',
    ])
    expect(
      gitIpcContracts.getDiff.parseArgs([
        { workspacePath: '/workspace/project', path: 'src/file.ts', area: 'unstaged' },
      ]),
    ).toEqual([{ workspacePath: '/workspace/project', path: 'src/file.ts', area: 'unstaged' }])
    expect(() => gitIpcContracts.getSnapshot.parseArgs(['relative/project'])).toThrow()
    expect(() => gitIpcContracts.getSnapshot.parseArgs(['/workspace/bad\0path'])).toThrow()
    expect(() => gitIpcContracts.getSnapshot.parseArgs(['/workspace/project', 'extra'])).toThrow()
    expect(() =>
      gitIpcContracts.getDiff.parseArgs([
        { workspacePath: '/workspace/project', path: 'src/file.ts', area: 'invalid' },
      ]),
    ).toThrow()
    expect(
      gitIpcContracts.commit.parseArgs([
        {
          workspacePath: '/workspace/project',
          expectedRevision: 'a'.repeat(64),
          message: '  explain the change  ',
          pathsToStage: ['src/file.ts', 'src/file.ts'],
        },
      ]),
    ).toEqual([
      {
        workspacePath: '/workspace/project',
        expectedRevision: 'a'.repeat(64),
        message: 'explain the change',
        pathsToStage: ['src/file.ts'],
      },
    ])
    expect(
      gitIpcContracts.push.parseArgs([
        { workspacePath: '/workspace/project', expectedHeadOid: 'abcdef1' },
      ]),
    ).toHaveLength(1)
  })
})
