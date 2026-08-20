import { describe, expect, it } from 'vitest'
import type { GitRepositorySnapshot } from '@shared/git'
import { createDefaultCommitMessage } from './GitCommitView'

describe('GitCommitView', () => {
  it('generates a useful commit message when the user leaves the field empty', () => {
    expect(createDefaultCommitMessage(snapshot(['README.md']), ['README.md'])).toBe(
      '更新 README.md',
    )
    expect(
      createDefaultCommitMessage(snapshot(['README.md', 'package.json']), [
        'README.md',
        'package.json',
      ]),
    ).toBe('更新 2 个文件')
  })
})

function snapshot(paths: string[]): GitRepositorySnapshot {
  return {
    workspacePath: '/workspace/project',
    availability: 'available',
    repositoryRoot: '/workspace/project',
    repositoryName: 'project',
    branch: 'main',
    headOid: 'abcdef1',
    detached: false,
    unborn: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    changeCount: paths.length,
    stagedCount: 0,
    unstagedCount: paths.length,
    untrackedCount: 0,
    conflictedCount: 0,
    changes: paths.map((path) => ({
      path,
      originalPath: null,
      stagedStatus: null,
      unstagedStatus: 'M',
      untracked: false,
      conflicted: false,
    })),
    additions: 2,
    deletions: 1,
    lineStatsIncomplete: false,
    refreshedAt: '2026-08-20T00:00:00.000Z',
    revision: 'a'.repeat(64),
  }
}
