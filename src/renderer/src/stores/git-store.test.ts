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
})

function snapshot(workspacePath: string, branch: string): GitRepositorySnapshot {
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
    revision: 'a'.repeat(64),
  }
}
