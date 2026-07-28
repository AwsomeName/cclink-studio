import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockPaths = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => mockPaths.userDataDir },
}))

import { GitBackupProjectStore } from './git-backup-project-store'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-git-backup-store-'))
  mockPaths.userDataDir = tempDir
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('GitBackupProjectStore', () => {
  it('persists non-sensitive binding state by project id', async () => {
    const store = new GitBackupProjectStore()
    await store.set({
      projectId: 'project-1',
      remoteUrl: 'https://github.com/user/repo.git',
      repositoryLabel: 'user/repo',
      remoteName: 'cclink-backup',
      lastBackupAt: null,
    })

    expect(await new GitBackupProjectStore().get('project-1')).toMatchObject({
      remoteUrl: 'https://github.com/user/repo.git',
      repositoryLabel: 'user/repo',
    })
    const raw = await readFile(join(tempDir, 'git-backup/projects.json'), 'utf-8')
    expect(raw).not.toMatch(/token|secret/i)
  })
})
