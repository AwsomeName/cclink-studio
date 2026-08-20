import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitRepositorySnapshot } from '@shared/git'
import { useGitStore } from './git-store'

const firstWorkspace = '/workspace/first'
const secondWorkspace = '/workspace/second'

describe('git-store', () => {
  const getSnapshot = vi.fn()
  const getDiff = vi.fn()
  const commit = vi.fn()
  const push = vi.fn()

  beforeEach(() => {
    getSnapshot.mockReset()
    getDiff.mockReset()
    commit.mockReset()
    push.mockReset()
    vi.stubGlobal('window', { cclinkStudio: { git: { getSnapshot, getDiff, commit, push } } })
    useGitStore.setState({
      workspacePath: null,
      snapshot: null,
      loading: false,
      error: null,
      selectedDiff: null,
      diff: null,
      diffLoading: false,
      operation: null,
      operationError: null,
      operationDialogOpen: false,
      operationDialogTab: 'changes',
      operationDialogWorkspacePath: null,
      operationDialogBaselineRevision: null,
      commitMessage: '',
      selectedCommitPaths: [],
      operationNotice: null,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads and refreshes the active workspace snapshot', async () => {
    getSnapshot.mockResolvedValue(snapshot(firstWorkspace, 'main'))

    await useGitStore.getState().loadWorkspace(firstWorkspace)
    await useGitStore.getState().refresh()

    expect(getSnapshot).toHaveBeenCalledTimes(2)
    expect(useGitStore.getState()).toMatchObject({
      workspacePath: firstWorkspace,
      snapshot: { branch: 'main' },
      loading: false,
      error: null,
    })
  })

  it('drops a late snapshot after the workspace changes', async () => {
    let finishFirst: ((value: GitRepositorySnapshot) => void) | undefined
    getSnapshot
      .mockImplementationOnce(
        () =>
          new Promise<GitRepositorySnapshot>((resolve) => {
            finishFirst = resolve
          }),
      )
      .mockResolvedValueOnce(snapshot(secondWorkspace, 'next'))

    const firstLoad = useGitStore.getState().loadWorkspace(firstWorkspace)
    await useGitStore.getState().loadWorkspace(secondWorkspace)
    finishFirst?.(snapshot(firstWorkspace, 'stale'))
    await firstLoad

    expect(useGitStore.getState()).toMatchObject({
      workspacePath: secondWorkspace,
      snapshot: { workspacePath: secondWorkspace, branch: 'next' },
    })
  })

  it('loads a bounded diff for the active workspace', async () => {
    getSnapshot.mockResolvedValue(snapshot(firstWorkspace, 'main'))
    getDiff.mockResolvedValue({
      workspacePath: firstWorkspace,
      path: 'README.md',
      area: 'unstaged',
      content: '+changed',
      truncated: false,
      binary: false,
    })

    await useGitStore.getState().loadWorkspace(firstWorkspace)
    await useGitStore.getState().loadDiff('README.md', 'unstaged')

    expect(getDiff).toHaveBeenCalledWith({
      workspacePath: firstWorkspace,
      path: 'README.md',
      area: 'unstaged',
    })
    expect(useGitStore.getState()).toMatchObject({
      selectedDiff: { path: 'README.md', area: 'unstaged' },
      diff: { content: '+changed' },
      diffLoading: false,
    })
  })

  it('keeps the commit draft across refresh and gates it on the old revision', async () => {
    getSnapshot
      .mockResolvedValueOnce(snapshot(firstWorkspace, 'main', 'a'.repeat(64)))
      .mockResolvedValueOnce(snapshot(firstWorkspace, 'main', 'b'.repeat(64)))

    await useGitStore.getState().loadWorkspace(firstWorkspace)
    useGitStore.getState().openOperationDialog('commit')
    useGitStore.getState().setCommitMessage('keep this draft')
    useGitStore.getState().setCommitPaths(['README.md'])
    await useGitStore.getState().refresh()

    expect(useGitStore.getState()).toMatchObject({
      operationDialogOpen: true,
      operationDialogBaselineRevision: 'a'.repeat(64),
      commitMessage: 'keep this draft',
      selectedCommitPaths: ['README.md'],
      snapshot: { revision: 'b'.repeat(64) },
    })
  })

  it('replaces and deduplicates the commit selection for select all', () => {
    useGitStore.getState().setCommitPaths(['a.md', 'b.md', 'a.md'])

    expect(useGitStore.getState().selectedCommitPaths).toEqual(['a.md', 'b.md'])

    useGitStore.getState().setCommitPaths([])
    expect(useGitStore.getState().selectedCommitPaths).toEqual([])
  })

  it('includes every unstaged path when the compact commit menu opens', async () => {
    getSnapshot.mockResolvedValue({
      ...snapshot(firstWorkspace, 'main'),
      changes: [
        {
          path: 'README.md',
          originalPath: null,
          stagedStatus: null,
          unstagedStatus: 'M',
          untracked: false,
          conflicted: false,
        },
        {
          path: 'new-file.md',
          originalPath: null,
          stagedStatus: null,
          unstagedStatus: '?',
          untracked: true,
          conflicted: false,
        },
      ],
    })

    await useGitStore.getState().loadWorkspace(firstWorkspace)
    useGitStore.getState().openOperationDialog('commit')

    expect(useGitStore.getState().selectedCommitPaths).toEqual(['README.md', 'new-file.md'])
  })

  it('clears dialog state and commit draft when the workspace changes', async () => {
    getSnapshot
      .mockResolvedValueOnce(snapshot(firstWorkspace, 'main'))
      .mockResolvedValueOnce(snapshot(secondWorkspace, 'next'))

    await useGitStore.getState().loadWorkspace(firstWorkspace)
    useGitStore.getState().openOperationDialog('commit')
    useGitStore.getState().setCommitMessage('workspace-specific draft')
    useGitStore.getState().setCommitPaths(['README.md'])
    await useGitStore.getState().loadWorkspace(secondWorkspace)

    expect(useGitStore.getState()).toMatchObject({
      workspacePath: secondWorkspace,
      operationDialogOpen: false,
      operationDialogWorkspacePath: null,
      operationDialogBaselineRevision: null,
      commitMessage: '',
      selectedCommitPaths: [],
    })
  })
})

function snapshot(
  workspacePath: string,
  branch: string,
  revision = 'a'.repeat(64),
): GitRepositorySnapshot {
  return {
    workspacePath,
    availability: 'available',
    repositoryRoot: workspacePath,
    repositoryName: workspacePath.split('/').at(-1) ?? 'workspace',
    branch,
    headOid: 'abcdef1234567890',
    detached: false,
    unborn: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    changeCount: 2,
    stagedCount: 0,
    unstagedCount: 2,
    untrackedCount: 0,
    conflictedCount: 0,
    changes: [],
    additions: 12,
    deletions: 3,
    lineStatsIncomplete: false,
    refreshedAt: '2026-08-17T10:00:00.000Z',
    revision,
  }
}
