import type {
  GitBackupAccountStatus,
  GitBackupOperationResult,
  GitBackupProjectStatus,
  GitBackupRunInput,
  GitBackupRunResult,
  GitBackupSaveAccountInput,
  GitBackupTestAccountInput,
} from '../../shared/ipc/git-backup'
import type { SettingsService } from '../settings/settings-service'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import { GitBackupCredentialStore } from './git-backup-credential-store'
import { GitBackupError, toGitBackupError } from './git-backup-error'
import { GitBackupProjectStore, type GitBackupProjectBinding } from './git-backup-project-store'
import { GitClient } from './git-client'
import { GitHubClient } from './github-client'
import {
  findSensitiveFiles,
  normalizeGitHubUsername,
  parseRepositoryInput,
} from './git-backup-validation'

interface GitBackupServiceOptions {
  credentialStore?: GitBackupCredentialStore
  projectStore?: GitBackupProjectStore
  gitClient?: GitClient
  githubClientFactory?: (token: string) => GitHubClient
  now?: () => Date
}

export class GitBackupService {
  private readonly credentialStore: GitBackupCredentialStore
  private readonly projectStore: GitBackupProjectStore
  private readonly gitClient: GitClient
  private readonly githubClientFactory: (token: string) => GitHubClient
  private readonly now: () => Date
  private readonly activeBackups = new Set<string>()
  private connectedLogin: string | null = null

  constructor(
    private readonly settingsService: SettingsService,
    private readonly workspaceStateService: WorkspaceStateService,
    options: GitBackupServiceOptions = {},
  ) {
    this.credentialStore = options.credentialStore ?? new GitBackupCredentialStore()
    this.projectStore = options.projectStore ?? new GitBackupProjectStore()
    this.gitClient = options.gitClient ?? new GitClient()
    this.githubClientFactory = options.githubClientFactory ?? ((token) => new GitHubClient(token))
    this.now = options.now ?? (() => new Date())
  }

  async load(): Promise<void> {
    await this.projectStore.load()
  }

  async getAccountStatus(): Promise<GitBackupAccountStatus> {
    const git = await this.gitClient.detect()
    try {
      return {
        gitAvailable: git.available,
        gitVersion: git.version,
        username: this.settingsService.getAll().gitBackupUsername,
        tokenConfigured: await this.credentialStore.hasToken(),
        connected: Boolean(this.connectedLogin),
        connectedLogin: this.connectedLogin ?? undefined,
      }
    } catch (error: unknown) {
      const failure = toGitBackupError(error)
      return {
        gitAvailable: git.available,
        gitVersion: git.version,
        username: this.settingsService.getAll().gitBackupUsername,
        tokenConfigured: false,
        connected: false,
        error: failure.message,
        errorCode: failure.code,
      }
    }
  }

  async saveAccount(input: GitBackupSaveAccountInput): Promise<GitBackupOperationResult> {
    try {
      if (
        !input ||
        typeof input.username !== 'string' ||
        (input.token !== undefined && typeof input.token !== 'string')
      ) {
        throw new GitBackupError('INVALID_INPUT', 'Git 备份账号输入无效')
      }
      const username = normalizeGitHubUsername(input.username)
      const currentUsername = this.settingsService.getAll().gitBackupUsername
      if (
        !input.token?.trim() &&
        username !== currentUsername &&
        (await this.credentialStore.hasToken())
      ) {
        throw new GitBackupError('INVALID_INPUT', '修改 GitHub 账号时请同时填写对应 Token')
      }
      if (input.token?.trim()) await this.credentialStore.saveToken(input.token)
      if (!(await this.credentialStore.hasToken())) {
        throw new GitBackupError('INVALID_INPUT', '请输入 GitHub Token')
      }
      await this.settingsService.set({ gitBackupUsername: username })
      this.connectedLogin = null
      return {
        success: true,
        message: 'Git 备份账号已保存',
        account: await this.getAccountStatus(),
      }
    } catch (error: unknown) {
      return operationFailure(error)
    }
  }

  async clearAccount(): Promise<GitBackupOperationResult> {
    try {
      await this.credentialStore.clear()
      await this.settingsService.set({ gitBackupUsername: '' })
      this.connectedLogin = null
      return {
        success: true,
        message: 'Git 备份账号已清除',
        account: await this.getAccountStatus(),
      }
    } catch (error: unknown) {
      return operationFailure(error)
    }
  }

  async testAccount(input: GitBackupTestAccountInput = {}): Promise<GitBackupOperationResult> {
    try {
      if (
        !input ||
        (input.username !== undefined && typeof input.username !== 'string') ||
        (input.token !== undefined && typeof input.token !== 'string')
      ) {
        throw new GitBackupError('INVALID_INPUT', 'Git 备份账号输入无效')
      }
      const username = normalizeGitHubUsername(
        input.username?.trim() || this.settingsService.getAll().gitBackupUsername,
      )
      const token = input.token?.trim() || (await this.credentialStore.getToken())
      if (!token) throw new GitBackupError('ACCOUNT_NOT_CONFIGURED', '请先填写 GitHub Token')
      const login = await this.githubClientFactory(token).verifyAccount(username)
      this.connectedLogin = login
      return {
        success: true,
        message: `已连接 GitHub 账号 ${login}`,
        account: await this.getAccountStatus(),
      }
    } catch (error: unknown) {
      this.connectedLogin = null
      return operationFailure(error)
    }
  }

  async getProjectStatus(workspacePath: string): Promise<GitBackupProjectStatus> {
    try {
      const resolvedPath = await this.resolveWorkspace(workspacePath)
      const projectId = await this.workspaceStateService.getLocalProjectId(resolvedPath)
      const binding = projectId ? await this.projectStore.get(projectId) : null
      return {
        workspacePath: resolvedPath,
        projectId,
        bound: Boolean(binding),
        remoteUrl: binding?.remoteUrl ?? null,
        repositoryLabel: binding?.repositoryLabel ?? null,
        lastBackupAt: binding?.lastBackupAt ?? null,
        busy: this.activeBackups.has(resolvedPath),
      }
    } catch (error: unknown) {
      return {
        workspacePath,
        projectId: null,
        bound: false,
        remoteUrl: null,
        repositoryLabel: null,
        lastBackupAt: null,
        busy: false,
        error: toGitBackupError(error).message,
      }
    }
  }

  async backup(input: GitBackupRunInput): Promise<GitBackupRunResult> {
    let workspacePath = ''
    try {
      if (
        !input ||
        typeof input.workspacePath !== 'string' ||
        (input.repositoryInput !== undefined && typeof input.repositoryInput !== 'string')
      ) {
        throw new GitBackupError('INVALID_INPUT', 'Git 备份请求无效')
      }
      workspacePath = input.workspacePath
      workspacePath = await this.resolveWorkspace(input.workspacePath)
      if (this.activeBackups.has(workspacePath)) {
        throw new GitBackupError('BACKUP_IN_PROGRESS', '当前项目正在备份，请稍候')
      }
      this.activeBackups.add(workspacePath)
      return await this.runBackup(workspacePath, input.repositoryInput)
    } catch (error: unknown) {
      return backupFailure(error)
    } finally {
      if (workspacePath) this.activeBackups.delete(workspacePath)
    }
  }

  private async runBackup(
    workspacePath: string,
    repositoryInput?: string,
  ): Promise<GitBackupRunResult> {
    const git = await this.gitClient.detect()
    if (!git.available) throw new GitBackupError('GIT_NOT_FOUND', '未检测到 Git，请先安装 Git')

    const projectId = await this.workspaceStateService.getLocalProjectId(workspacePath)
    if (!projectId) {
      throw new GitBackupError(
        'INVALID_WORKSPACE',
        '当前工作空间无法创建稳定项目标识，不能保存备份绑定',
      )
    }

    let binding = await this.projectStore.get(projectId)
    if (!binding) {
      if (!repositoryInput?.trim()) {
        throw new GitBackupError('INVALID_INPUT', '首次备份请输入远程仓库地址或项目名')
      }
      binding = await this.createBinding(projectId, repositoryInput)
    }

    if (!(await this.gitClient.isRepository(workspacePath))) {
      await this.gitClient.initialize(workspacePath)
    }
    await this.gitClient.ensureLocalExcludes(workspacePath)

    const sensitiveFiles = findSensitiveFiles(
      await this.gitClient.listCandidateFiles(workspacePath),
    )
    if (sensitiveFiles.length > 0) {
      throw new GitBackupError(
        'SENSITIVE_FILES',
        `发现敏感文件，已停止备份：${sensitiveFiles.join('、')}`,
        { sensitiveFiles },
      )
    }

    const hadChanges = await this.gitClient.hasChanges(workspacePath)
    const hadHead = await this.gitClient.hasHead(workspacePath)
    if (hadChanges) {
      await this.gitClient.stageAll(workspacePath)
      await this.gitClient.commit(workspacePath, formatCommitMessage(this.now()))
    } else if (!hadHead) {
      await this.gitClient.commit(workspacePath, formatCommitMessage(this.now()), true)
    }

    await this.gitClient.setRemote(workspacePath, binding.remoteName, binding.remoteUrl)
    const branch = await this.gitClient.currentBranch(workspacePath)
    const authentication = await this.getAuthenticationForRemote(binding.remoteUrl)
    const pushResult = await this.gitClient.push(
      workspacePath,
      binding.remoteName,
      branch,
      authentication ?? undefined,
    )

    const lastBackupAt = this.now().toISOString()
    binding = { ...binding, lastBackupAt }
    await this.projectStore.set(binding)
    const pushOutput = `${pushResult.stdout}\n${pushResult.stderr}`
    const noChanges = !hadChanges && hadHead && /Everything up-to-date/i.test(pushOutput)
    return {
      success: true,
      status: noChanges ? 'no-changes' : 'backed-up',
      message: noChanges ? '没有需要备份的变更' : '备份成功',
      remoteUrl: binding.remoteUrl,
      lastBackupAt,
    }
  }

  private async createBinding(
    projectId: string,
    repositoryInput: string,
  ): Promise<GitBackupProjectBinding> {
    const parsed = parseRepositoryInput(repositoryInput)
    if (parsed.kind === 'remote-url') {
      return {
        projectId,
        remoteUrl: parsed.url,
        repositoryLabel: parsed.label,
        remoteName: 'cclink-backup',
        lastBackupAt: null,
      }
    }

    const username = normalizeGitHubUsername(this.settingsService.getAll().gitBackupUsername)
    const token = await this.credentialStore.getToken()
    if (!token) {
      throw new GitBackupError(
        'ACCOUNT_NOT_CONFIGURED',
        '使用项目名建仓前，请先在设置中配置 GitHub 账号和 Token',
      )
    }
    const github = this.githubClientFactory(token)
    await github.verifyAccount(username)
    const repository = await github.getOrCreatePrivateRepository(username, parsed.name)
    return {
      projectId,
      remoteUrl: repository.cloneUrl,
      repositoryLabel: repository.fullName,
      remoteName: 'cclink-backup',
      lastBackupAt: null,
    }
  }

  private async getAuthenticationForRemote(
    remoteUrl: string,
  ): Promise<{ username: string; token: string } | null> {
    let parsed: URL
    try {
      parsed = new URL(remoteUrl)
    } catch {
      return null
    }
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return null
    const username = this.settingsService.getAll().gitBackupUsername.trim()
    const token = await this.credentialStore.getToken()
    return username && token ? { username, token } : null
  }

  private async resolveWorkspace(workspacePath: string): Promise<string> {
    if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
      throw new GitBackupError('INVALID_WORKSPACE', '请先打开本地工作空间')
    }
    const resolved = await this.workspaceStateService.resolveLocalWorkspace(workspacePath)
    if (!resolved.valid || !resolved.workspacePath) {
      throw new GitBackupError('INVALID_WORKSPACE', resolved.error ?? '当前工作空间不可用')
    }
    return resolved.workspacePath
  }
}

function operationFailure(error: unknown): GitBackupOperationResult {
  const failure = toGitBackupError(error)
  return { success: false, error: failure.message, errorCode: failure.code }
}

function backupFailure(error: unknown): GitBackupRunResult {
  const failure = toGitBackupError(error)
  const sensitiveFiles = Array.isArray(failure.details?.sensitiveFiles)
    ? failure.details.sensitiveFiles.filter((value): value is string => typeof value === 'string')
    : undefined
  return {
    success: false,
    status: 'failed',
    message: failure.message,
    errorCode: failure.code,
    sensitiveFiles,
  }
}

function formatCommitMessage(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `CCLink backup ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
