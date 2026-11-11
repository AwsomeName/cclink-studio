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
  clipboard: { writeText: vi.fn() },
  shell: { openPath: vi.fn(async () => '') },
}))

import { CredentialService } from '../credentials/credential-service'
import { PlaintextCredentialStore } from '../credentials/plaintext-credential-store'
import { SettingsService } from '../settings/settings-service'
import { WorkspaceStateService } from '../workspace/workspace-state-service'
import { GitBackupProjectStore } from './git-backup-project-store'
import { GitBackupService } from './git-backup-service'
import { GitBackupError } from './git-backup-error'
import { GitClient } from './git-client'
import { GitExecutor } from './git-executor'
import type { GitHubClient } from './github-client'

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
  async function accountFixture(verifyAccount = async (username: string) => username) {
    const credentials = createCredentialService()
    const settings = new SettingsService(credentials)
    await settings.loadState()
    const service = new GitBackupService(settings, {} as WorkspaceStateService, credentials, {
      gitClient: { detect: async () => ({ available: true, version: 'test' }) } as GitClient,
      githubClientFactory: () => ({ verifyAccount }) as GitHubClient,
    })
    return { credentials, settings, service }
  }

  it('invalidates verified account status when advanced management replaces or removes the Token', async () => {
    const { credentials, service } = await accountFixture()
    expect((await service.saveAccount({ username: 'old-user', token: 'old-token' })).success).toBe(
      true,
    )
    expect((await service.testAccount()).account?.connected).toBe(true)
    await credentials.setCredential({
      id: 'git:github',
      kind: 'token',
      fields: { token: 'new-token' },
    })
    expect(await service.getAccountStatus()).toMatchObject({
      tokenConfigured: true,
      connected: false,
    })
    expect((await service.testAccount()).account?.connected).toBe(true)
    await credentials.removeCredential('git:github')
    expect(await service.getAccountStatus()).toMatchObject({
      tokenConfigured: false,
      connected: false,
    })
  })

  it('does not apply an in-flight verification to a subsequently removed Token', async () => {
    let finish!: (login: string) => void
    const { credentials, service } = await accountFixture(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await service.saveAccount({ username: 'user', token: 'token' })
    const pending = service.testAccount()
    await credentials.removeCredential('git:github')
    finish('user')
    expect((await pending).account?.connected).toBe(false)
  })

  it('restores the previous Token when saving the new account settings fails', async () => {
    const { credentials, settings, service } = await accountFixture()
    await service.saveAccount({ username: 'old-user', token: 'old-token' })
    await rm(join(mockPaths.userData, 'settings.json'))
    await mkdir(join(mockPaths.userData, 'settings.json'))
    expect(await service.saveAccount({ username: 'new-user', token: 'new-token' })).toMatchObject({
      success: false,
    })
    expect(settings.getAll().gitBackupUsername).toBe('old-user')
    expect(credentials.resolveCredential('git:github')?.token).toBe('old-token')
  })
  it('backs up manually without force operations and blocks tracked secrets', async () => {
    const workspacePath = join(tempDir, 'project')
    const remotePath = join(tempDir, 'backup.git')
    await mkdir(workspacePath)
    await execFileAsync('git', ['init', '--bare', remotePath])

    const credentialService = createCredentialService()
    const settingsService = new SettingsService(credentialService)
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
    const service = new GitBackupService(
      settingsService,
      workspaceStateService,
      credentialService,
      {
        projectStore,
        gitClient: new GitClient(
          new GitExecutor({ askPassDirectory: join(tempDir, 'askpass'), timeoutMs: 20_000 }),
        ),
        now: () => new Date('2026-07-17T12:00:00.000Z'),
      },
    )
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
    const credentialService = createCredentialService()
    const settingsService = new SettingsService(credentialService)
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
      inspectCclinkStudioIndex: async () => [],
      inspectSharedTaskIndexSecrets: async () => [],
      inspectSharedTaskIndexDefinitions: async () => [],
      inspectCclinkStudioOutgoingHistory: async () => [],
      inspectSharedTaskOutgoingContent: async () => ({ invalid: [], sensitive: [] }),
      commit: async () => ({ stdout: '', stderr: '' }),
      setRemote: async () => undefined,
      currentBranch: async () => 'main',
      push: async () => {
        throw new GitBackupError('NETWORK_ERROR', 'network unavailable')
      },
    } as unknown as GitClient
    const service = new GitBackupService(
      settingsService,
      workspaceStateService,
      credentialService,
      {
        projectStore,
        gitClient: failingGitClient,
      },
    )
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

function createCredentialService(): CredentialService {
  return new CredentialService(
    new PlaintextCredentialStore(join(mockPaths.userData, 'credentials/credentials.json')),
    { userDataPath: mockPaths.userData },
  )
}
