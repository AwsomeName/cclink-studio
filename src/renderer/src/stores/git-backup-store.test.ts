import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  GitBackupAccountStatus,
  GitBackupProjectStatus,
  GitBackupRunResult,
} from '@shared/ipc/git-backup'
import { useGitBackupStore } from './git-backup-store'

const workspacePath = '/workspace/project'

const accountStatus: GitBackupAccountStatus = {
  gitAvailable: true,
  gitVersion: 'git version 2.50.0',
  username: 'octocat',
  tokenConfigured: true,
  connected: true,
  connectedLogin: 'octocat',
}

function projectStatus(overrides: Partial<GitBackupProjectStatus> = {}): GitBackupProjectStatus {
  return {
    workspacePath,
    projectId: 'project-1',
    bound: false,
    remoteUrl: null,
    repositoryLabel: null,
    lastBackupAt: null,
    busy: false,
    ...overrides,
  }
}

describe('git-backup-store', () => {
  const getAccountStatus = vi.fn()
  const getProjectStatus = vi.fn()
  const backup = vi.fn()

  beforeEach(() => {
    getAccountStatus.mockReset().mockResolvedValue(accountStatus)
    getProjectStatus.mockReset().mockResolvedValue(projectStatus())
    backup.mockReset()
    vi.stubGlobal('window', {
      cclinkStudio: {
        gitBackup: { getAccountStatus, getProjectStatus, backup },
      },
    })
    useGitBackupStore.setState({
      workspacePath: null,
      accountStatus: null,
      projectStatus: null,
      loading: false,
      busy: false,
      error: null,
      dialogOpen: false,
      repositoryInput: '',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads account and project status without coupling the two records', async () => {
    await useGitBackupStore.getState().loadWorkspace(workspacePath)

    expect(getAccountStatus).toHaveBeenCalledOnce()
    expect(getProjectStatus).toHaveBeenCalledWith(workspacePath)
    expect(useGitBackupStore.getState()).toMatchObject({
      workspacePath,
      accountStatus,
      projectStatus: projectStatus(),
      loading: false,
      error: null,
    })
  })

  it('opens the repository dialog for the first manual backup', async () => {
    await useGitBackupStore.getState().requestBackup(workspacePath)

    expect(backup).not.toHaveBeenCalled()
    expect(useGitBackupStore.getState().dialogOpen).toBe(true)
  })

  it('binds the repository only after the first backup succeeds', async () => {
    const result: GitBackupRunResult = {
      success: true,
      status: 'backed-up',
      message: '备份完成',
    }
    const boundStatus = projectStatus({
      bound: true,
      remoteUrl: 'https://github.com/octocat/project.git',
      repositoryLabel: 'octocat/project',
      lastBackupAt: '2026-07-17T08:00:00.000Z',
    })
    backup.mockResolvedValue(result)
    getProjectStatus.mockResolvedValueOnce(projectStatus()).mockResolvedValueOnce(boundStatus)

    await useGitBackupStore.getState().requestBackup(workspacePath)
    useGitBackupStore.getState().setRepositoryInput('project')
    const submitted = await useGitBackupStore.getState().submitFirstBackup()

    expect(submitted).toEqual(result)
    expect(backup).toHaveBeenCalledWith({ workspacePath, repositoryInput: 'project' })
    expect(useGitBackupStore.getState()).toMatchObject({
      projectStatus: boundStatus,
      dialogOpen: false,
      repositoryInput: '',
      busy: false,
      error: null,
    })
  })

  it('keeps the first-backup dialog open when push fails', async () => {
    backup.mockResolvedValue({
      success: false,
      status: 'failed',
      message: '远程仓库拒绝了推送',
      errorCode: 'REMOTE_CONFLICT',
    } satisfies GitBackupRunResult)

    await useGitBackupStore.getState().requestBackup(workspacePath)
    useGitBackupStore.getState().setRepositoryInput('octocat/project')
    const submitted = await useGitBackupStore.getState().submitFirstBackup()

    expect(submitted?.success).toBe(false)
    expect(useGitBackupStore.getState()).toMatchObject({
      dialogOpen: true,
      repositoryInput: 'octocat/project',
      busy: false,
      error: '远程仓库拒绝了推送',
    })
  })

  it('lets Escape-style dismissal hide the dialog while backup continues', () => {
    useGitBackupStore.setState({ dialogOpen: true, repositoryInput: 'octocat/project', busy: true })

    useGitBackupStore.getState().closeDialog()

    expect(useGitBackupStore.getState()).toMatchObject({
      dialogOpen: false,
      repositoryInput: '',
      busy: true,
    })
  })

  it('does not let a completed backup overwrite the next workspace state', async () => {
    let finishBackup: ((result: GitBackupRunResult) => void) | undefined
    backup.mockImplementation(
      () =>
        new Promise<GitBackupRunResult>((resolve) => {
          finishBackup = resolve
        }),
    )
    getProjectStatus.mockResolvedValueOnce(
      projectStatus({
        bound: true,
        remoteUrl: 'git@github.com:octocat/project.git',
        repositoryLabel: 'octocat/project',
      }),
    )

    const backupPromise = useGitBackupStore.getState().requestBackup(workspacePath)
    await vi.waitFor(() => expect(useGitBackupStore.getState().busy).toBe(true))

    getProjectStatus.mockResolvedValueOnce(
      projectStatus({ workspacePath: '/workspace/next', projectId: 'project-2' }),
    )
    await useGitBackupStore.getState().loadWorkspace('/workspace/next')
    finishBackup?.({ success: true, status: 'backed-up', message: '旧项目备份完成' })
    await backupPromise

    expect(useGitBackupStore.getState()).toMatchObject({
      workspacePath: '/workspace/next',
      busy: false,
      projectStatus: { workspacePath: '/workspace/next' },
    })
  })
})
