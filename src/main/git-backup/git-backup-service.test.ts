import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileAsync = promisify(execFile)
const mockPaths = vi.hoisted(() => ({ home: '', userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'home' ? mockPaths.home : mockPaths.userData),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf-8'),
    decryptString: (value: Buffer) => value.toString('utf-8').replace(/^encrypted:/, ''),
  },
}))

import { SettingsService } from '../settings/settings-service'
import { WorkspaceStateService } from '../workspace/workspace-state-service'
import { GitBackupCredentialStore } from './git-backup-credential-store'
import { GitBackupProjectStore } from './git-backup-project-store'
import { GitBackupService } from './git-backup-service'
import { GitBackupError } from './git-backup-error'
import { GitClient } from './git-client'
import { GitExecutor } from './git-executor'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-git-backup-service-'))
  mockPaths.home = tempDir
  mockPaths.userData = join(tempDir, 'user-data')
  await mkdir(mockPaths.userData, { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('GitBackupService', () => {
  it('defers decrypting the GitHub token until account status is requested', async () => {
    await new GitBackupCredentialStore().saveToken('github-secret-token')
    const decryptString = vi.fn((value: Buffer) =>
      value.toString('utf-8').replace(/^encrypted:/, ''),
    )
    const credentialStore = new GitBackupCredentialStore('git-backup/secrets.enc', {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf-8'),
      decryptString,
    })
    const settingsService = new SettingsService()
    await settingsService.loadState()
    const workspaceStateService = new WorkspaceStateService()
    const service = new GitBackupService(settingsService, workspaceStateService, {
      credentialStore,
      projectStore: new GitBackupProjectStore(),
      gitClient: {
        detect: async () => ({ available: true, version: 'git version test' }),
      } as GitClient,
    })

    await service.load()

    expect(decryptString).not.toHaveBeenCalled()
    await expect(service.getAccountStatus()).resolves.toMatchObject({ tokenConfigured: true })
    expect(decryptString).toHaveBeenCalledOnce()
  })

  it('backs up manually without force operations and blocks tracked secrets', async () => {
    const workspacePath = join(tempDir, 'project')
    const remotePath = join(tempDir, 'backup.git')
    await mkdir(workspacePath)
    await execFileAsync('git', ['init', '--bare', remotePath])

    const settingsService = new SettingsService()
    await settingsService.loadState()
    const workspaceStateService = new WorkspaceStateService()
    await workspaceStateService.loadState()
    const projectId = await workspaceStateService.getLocalProjectId(workspacePath)
    expect(projectId).toBeTruthy()

    const projectStore = new GitBackupProjectStore()
    await projectStore.set({
      projectId: projectId!,
      remoteUrl: remotePath,
      repositoryLabel: 'local/backup',
      remoteName: 'cclink-backup',
      lastBackupAt: null,
    })
    const service = new GitBackupService(settingsService, workspaceStateService, {
      credentialStore: new GitBackupCredentialStore(),
      projectStore,
      gitClient: new GitClient(
        new GitExecutor({ askPassDirectory: join(tempDir, 'askpass'), timeoutMs: 20_000 }),
      ),
      now: () => new Date('2026-07-17T12:00:00.000Z'),
    })
    await service.load()

    await writeFile(join(workspacePath, 'README.md'), '# manual backup\n', 'utf-8')
    const first = await service.backup({ workspacePath })
    expect(first).toMatchObject({ success: true, status: 'backed-up' })
    const { stdout } = await execFileAsync('git', [
      '--git-dir',
      remotePath,
      'show',
      'refs/heads/main:README.md',
    ])
    expect(stdout).toBe('# manual backup\n')

    const unchanged = await service.backup({ workspacePath })
    expect(unchanged).toMatchObject({ success: true, status: 'no-changes' })

    await writeFile(join(workspacePath, '.env'), 'SECRET=do-not-upload\n', 'utf-8')
    await execFileAsync('git', ['add', '--force', '.env'], { cwd: workspacePath })
    const blocked = await service.backup({ workspacePath })
    expect(blocked).toMatchObject({
      success: false,
      status: 'failed',
      errorCode: 'SENSITIVE_FILES',
      sensitiveFiles: ['.env'],
    })
  }, 15_000)

  it('does not persist a first-time remote binding before push succeeds', async () => {
    const workspacePath = join(tempDir, 'failed-project')
    await mkdir(workspacePath)
    const settingsService = new SettingsService()
    await settingsService.loadState()
    const workspaceStateService = new WorkspaceStateService()
    await workspaceStateService.loadState()
    const projectId = await workspaceStateService.getLocalProjectId(workspacePath)
    const projectStore = new GitBackupProjectStore()
    const failingGitClient = {
      detect: async () => ({ available: true, version: 'git version test' }),
      isRepository: async () => false,
      initialize: async () => undefined,
      ensureLocalExcludes: async () => undefined,
      listCandidateFiles: async () => [],
      hasChanges: async () => true,
      hasHead: async () => false,
      stageAll: async () => ({ stdout: '', stderr: '' }),
      commit: async () => ({ stdout: '', stderr: '' }),
      setRemote: async () => undefined,
      currentBranch: async () => 'main',
      push: async () => {
        throw new GitBackupError('NETWORK_ERROR', 'network unavailable')
      },
    } as unknown as GitClient
    const service = new GitBackupService(settingsService, workspaceStateService, {
      credentialStore: new GitBackupCredentialStore(),
      projectStore,
      gitClient: failingGitClient,
    })
    await service.load()

    expect(
      await service.backup({
        workspacePath,
        repositoryInput: 'https://github.com/user/project.git',
      }),
    ).toMatchObject({ success: false, errorCode: 'NETWORK_ERROR' })
    expect(await projectStore.get(projectId!)).toBeNull()
  })
})
