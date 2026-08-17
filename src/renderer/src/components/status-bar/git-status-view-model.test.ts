import { describe, expect, it } from 'vitest'
import type { GitRepositorySnapshot } from '@shared/git'
import {
  formatGitChangeSummary,
  formatGitUpstream,
  getGitBranchLabel,
} from './git-status-view-model'

describe('git status view model', () => {
  it('formats branch, changes and known line statistics', () => {
    const snapshot = createSnapshot()

    expect(getGitBranchLabel(snapshot)).toBe('main')
    expect(formatGitChangeSummary(snapshot)).toBe('25 · +1420 -196*')
    expect(formatGitUpstream(snapshot)).toBe('origin/main · 本机已知同步')
  })

  it('formats detached and divergent states without claiming remote freshness', () => {
    const snapshot = createSnapshot({
      branch: null,
      detached: true,
      headOid: '1234567890abcdef',
      ahead: 2,
      behind: 1,
    })

    expect(getGitBranchLabel(snapshot)).toBe('detached@1234567')
    expect(formatGitUpstream(snapshot)).toBe('origin/main · ↑2 ↓1')
  })
})

function createSnapshot(overrides: Partial<GitRepositorySnapshot> = {}): GitRepositorySnapshot {
  return {
    workspacePath: '/workspace/project',
    availability: 'available',
    repositoryRoot: '/workspace/project',
    repositoryName: 'project',
    branch: 'main',
    headOid: 'abcdef1234567890',
    detached: false,
    unborn: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    changeCount: 25,
    stagedCount: 0,
    unstagedCount: 20,
    untrackedCount: 5,
    conflictedCount: 0,
    changes: [],
    additions: 1420,
    deletions: 196,
    lineStatsIncomplete: true,
    refreshedAt: '2026-08-17T10:00:00.000Z',
    revision: 'a'.repeat(64),
    ...overrides,
  }
}
