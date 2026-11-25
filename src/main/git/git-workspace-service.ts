import { readWorkspaceSettings } from '../workspace/workspace-settings-files'
import { workspaceSettingsPath } from '../../shared/workspace-settings'
import {
  gitTransferInputSchema,
  type GitTransferInput,
  type GitTransferSnapshot,
} from '../../shared/git'
import { transferRepository } from './git-transfer'
import { lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { PROJECT_SYNC_SECTION, parseGitHubHttpsRepository } from '../../shared/git/project-sync'
import type { SyncScope } from './sync-diary'
import {
  isProjectSyncRepository,
  markProjectSyncRepository,
  previewProjectFiles,
} from './project-sync-scope'
import type { ProjectSyncPreview } from '../../shared/git/project-sync'
import { createHash } from 'node:crypto'
import type {
  GitChangeEntry,
  GitCommitInput,
  GitDiffRequest,
  GitDiffResult,
  GitOperationResult,
  GitPushInput,
  GitRepositorySnapshot,
  GitSnapshotErrorCode,
} from '../../shared/git'
import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import { GitBackupError } from '../git-backup/git-backup-error'
import { GitExecutor } from '../git-backup/git-executor'
import { findSensitiveFiles } from '../git-backup/git-backup-validation'
import { parseGitNumstat, parseGitStatusPorcelainV2 } from './git-status-parser'
import {
  inspectCclinkStudioIndex,
  inspectCclinkStudioOutgoingHistory,
  inspectSharedTaskIndexDefinitions,
  inspectSharedTaskIndexSecrets,
  inspectSharedTaskOutgoingContent,
  resolveKnownRemoteBaseRef,
} from './cclink-studio-path-policy'

interface GitCommandRunner {
  detect(): Promise<{ available: boolean; version: string | null }>
  run(
    cwd: string,
    args: string[],
    authentication?: { username: string; token: string },
  ): Promise<{ stdout: string; stderr: string }>
}

interface GitWorkspaceServiceOptions {
  decide?: (prompt: string) => Promise<string>
  runner?: GitCommandRunner
  now?: () => Date
  resolveAuthentication?: (remoteUrl: string) => Promise<{ username: string; token: string } | null>
  /** Company projects: row counts shown in 第一次会上传什么. */
  companyPreview?: (root: string) => Promise<Array<{ label: string; count: number }> | undefined>
  /** ADR 0026: throws unless the saved GitHub account sees this repository as private. */
  assertPrivateRepository?: (remoteUrl: string) => Promise<{ fullName: string }>
  /** Company export/import around a project sync round; undefined for other projects. */
  projectHooks?: (
    root: string,
  ) => Promise<
    Pick<SyncScope, 'beforeCommit' | 'afterUpdate' | 'describeRecordConflict'> | undefined
  >
}

export class GitWorkspaceService {
  private readonly runner: GitCommandRunner
  private readonly now: () => Date
  private readonly resolveAuthentication: NonNullable<
    GitWorkspaceServiceOptions['resolveAuthentication']
  >
  private readonly transferRunner = new GitExecutor({ isolatedConfig: true })
  private readonly activeOperations = new Set<string>()

  constructor(
    private readonly workspaceStateService: WorkspaceStateService,
    private readonly options: GitWorkspaceServiceOptions = {},
  ) {
    this.runner = options.runner ?? new GitExecutor()
    this.now = options.now ?? (() => new Date())
    this.resolveAuthentication = options.resolveAuthentication ?? (async () => null)
  }

  async shareWorkspaceSettings(path: string): Promise<GitOperationResult> {
    const snapshot = await this.getSnapshot(path)
    if (snapshot.availability !== 'available' || !snapshot.repositoryRoot)
      return operationFailure(snapshot, snapshot.error || '请先建立 Git 仓库')
    const root = snapshot.repositoryRoot
    if (this.activeOperations.has(root))
      return operationFailure(snapshot, '仓库已有操作，请稍后重试')
    this.activeOperations.add(root)
    try {
      const config = await readWorkspaceSettings(root)
      if (config.status !== 'saved') throw Error(config.error || '项目配置尚未保存')
      await this.runner.run(root, ['add', '-f', '--', workspaceSettingsPath])
      return {
        success: true,
        message: '项目配置已纳入 Git 暂存；请核对变更后提交、推送。',
        snapshot: await this.getSnapshot(root),
      }
    } catch (error) {
      return operationFailure(snapshot, String(error))
    } finally {
      this.activeOperations.delete(root)
    }
  }

  async transfer(raw: GitTransferInput): Promise<GitTransferSnapshot> {
    const input = gitTransferInputSchema.parse(raw)
    let key = 'clone'
    if (input.action !== 'clone') {
      if (!input.workspacePath) throw Error('请先连接原资料')
      const known = this.workspaceStateService
        .listLocalWorkspaces()
        .find((item) => item.workspacePath === input.workspacePath)
      if (!known?.projectId) throw Error('请先打开并登记来源工作空间')
      await this.workspaceStateService.verifyLocalIdentity(input.workspacePath, known.projectId)
      key = await realpath(input.workspacePath)
    }
    if (input.action === 'project-sync') return this.syncProject(input, raw.url, key)
    if (input.action === 'clone' && input.projectSync) return this.downloadProject(input)
    if (this.activeOperations.has(key)) throw Error('此仓库已有 Git 操作正在执行')
    this.activeOperations.add(key)
    try {
      const diarySection = 'personal-diary-sync'
      let diary
      if (input.action === 'diary-sync') {
        const space = this.workspaceStateService.getFixedSpaces().personal
        if (space?.workspacePath !== key || !space.diaryRootConfirmed)
          throw Error('请先确认我的空间目录')
        const { settings } = await readWorkspaceSettings(key)
        if (settings.type !== 'diary' || !settings.diary) throw Error('我的空间日记目录未配置')
        const saved = (await this.workspaceStateService.getSnapshot(key)).sections[diarySection] as
          | GitTransferSnapshot
          | undefined
        if (!input.url && saved?.conflict && !input.feedback) return saved
        input.url ??= saved?.remoteUrl
        if (!input.url)
          return {
            workspacePath: key,
            remoteUrl: '',
            branch: '',
            head: '',
            target: '',
            checkedAt: '',
            changes: '',
            localChanges: '',
            diverged: false,
          }
        diary = settings.diary
      }
      const authentication = input.token
        ? { username: input.username || 'git', token: input.token }
        : // My Space sync uses the GitHub account saved in Studio settings for github.com HTTPS.
          (diary && input.url && (await this.resolveAuthentication(input.url))) || undefined
      const authSource: TransferAuthSource = input.token
        ? 'one-off'
        : authentication
          ? 'saved-github'
          : input.sshKeyPath
            ? 'ssh-key'
            : 'none'
      let result: GitTransferSnapshot
      try {
        result = await transferRepository(input, {
          diary,
          decide: this.options.decide,
          onDiaryAddress: raw.url
            ? async (url) => {
                await this.workspaceStateService.setSection(key, diarySection, { remoteUrl: url })
              }
            : undefined,
          runner: this.transferRunner,
          copyRoot: input.destinationParent,
          authentication,
        })
      } catch (error) {
        throw reportTransferFailure(error, input.action, input.url, authSource)
      }
      if (diary) await this.workspaceStateService.setSection(key, diarySection, result)
      // Register only a newly-created copy. Never initialize or migrate the connected old root.
      if (result.newCopy) {
        await this.workspaceStateService.getSnapshot(result.workspacePath)
        const { settings } = await readWorkspaceSettings(result.workspacePath)
        if (settings.type === 'diary' && settings.diary) {
          const { directory, timezone } = settings.diary
          result.diaryMapping = { directory, timezone }
        }
      }
      return result
    } finally {
      this.activeOperations.delete(key)
    }
  }

  /** 第一次会上传什么 / 同步范围 for a local project. Read-only for folders not yet synced. */
  async previewProjectSync(requestedPath: string): Promise<ProjectSyncPreview> {
    const resolved = await this.workspaceStateService.resolveLocalWorkspace(requestedPath)
    if (!resolved.valid || !resolved.workspacePath) throw Error(resolved.error ?? '项目不可用')
    const root = await realpath(resolved.workspacePath)
    const hasRepository = Boolean(await lstat(join(root, '.git')).catch(() => null))
    const synced = hasRepository && (await isProjectSyncRepository(root))
    const run = async (args: string[]) =>
      (await this.transferRunner.run(root, ['-c', 'core.quotepath=false', ...args])).stdout
    const preview = await previewProjectFiles(root, run, synced)
    const company = await this.options.companyPreview?.(root).catch(() => undefined)
    return {
      workspacePath: root,
      gitManaged: hasRepository && !synced,
      ...preview,
      ...(company ? { company } : {}),
    }
  }

  /** Project sync status as last recorded on this computer, or null when never set up. */
  async getProjectSyncState(path: string): Promise<GitTransferSnapshot | null> {
    const saved = (await this.workspaceStateService.getSnapshot(path)).sections[
      PROJECT_SYNC_SECTION
    ] as GitTransferSnapshot | undefined
    return saved?.remoteUrl ? saved : null
  }

  /**
   * ADR 0026. One round of whole-project two-way sync with a private GitHub repository.
   * Only folders that are not Git repositories, or that project sync itself set up, qualify.
   */
  private async syncProject(
    input: GitTransferInput,
    requestedUrl: string | undefined,
    key: string,
  ): Promise<GitTransferSnapshot> {
    if (this.activeOperations.has(key)) throw Error('这个项目正在同步，请稍候')
    this.activeOperations.add(key)
    try {
      const personal = this.workspaceStateService.getFixedSpaces().personal
      if (personal?.workspacePath === key) throw Error('我的空间使用自己的同步')
      const { settings } = await readWorkspaceSettings(key)
      if (settings.type === 'diary') throw Error('日记项目使用我的空间同步')
      const saved = await this.getProjectSyncState(key)
      if (input.stop) {
        await this.workspaceStateService.setSection(key, PROJECT_SYNC_SECTION, null)
        return {
          workspacePath: key,
          remoteUrl: '',
          branch: '',
          head: '',
          target: '',
          checkedAt: '',
          changes: '',
          localChanges: '',
          diverged: false,
        }
      }
      const paused =
        saved?.conflict || saved?.conflictFiles?.length || saved?.pendingDeletions?.length
      if (!requestedUrl && paused && !input.feedback && !input.resolutions && !input.deletions)
        return saved!
      if (!saved) {
        if (!requestedUrl) throw Error('这个项目还没有设置同步')
        const isRepository = await lstat(join(key, '.git')).catch(() => null)
        if (isRepository && !(await isProjectSyncRepository(key)))
          throw Error('这个文件夹本身是 Git 仓库，请用左下角 Git 提交和推送，不提供自动同步。')
      }
      const parsed = parseGitHubHttpsRepository(requestedUrl ?? saved!.remoteUrl)
      if (!parsed) throw Error('项目同步只支持 GitHub 私有仓库地址')
      const url = parsed.url
      if (!this.options.assertPrivateRepository) throw Error('GitHub 账号服务未就绪')
      const { fullName } = await this.options.assertPrivateRepository(url)
      const authentication = await this.resolveAuthentication(url)
      if (!authentication) throw Error('请先在 设置 → API Key 与连接 → GitHub 中保存账号和 Token')
      if (requestedUrl && requestedUrl !== saved?.remoteUrl)
        await this.workspaceStateService.setSection(key, PROJECT_SYNC_SECTION, {
          ...(saved ?? {}),
          remoteUrl: url,
          repository: fullName,
        })
      let result: GitTransferSnapshot
      try {
        result = await transferRepository(
          { ...input, url },
          {
            runner: this.transferRunner,
            authentication,
            decide: this.options.decide,
            project: (await this.options.projectHooks?.(key)) ?? {},
          },
        )
      } catch (error) {
        throw reportTransferFailure(error, input.action, url, 'saved-github')
      }
      result = { ...result, repository: fullName }
      await this.workspaceStateService.setSection(key, PROJECT_SYNC_SECTION, result)
      return result
    } finally {
      this.activeOperations.delete(key)
    }
  }

  /**
   * Second computer: download a private project repository into a new folder with the saved
   * GitHub account, register it, and keep syncing it with the same address.
   */
  private async downloadProject(input: GitTransferInput): Promise<GitTransferSnapshot> {
    const parsed = parseGitHubHttpsRepository(input.url ?? '')
    if (!parsed) throw Error('只能下载 GitHub 私有仓库')
    if (!input.destinationParent || !input.destinationName) throw Error('请选择保存位置')
    if (!this.options.assertPrivateRepository) throw Error('GitHub 账号服务未就绪')
    const { fullName } = await this.options.assertPrivateRepository(parsed.url)
    const authentication = await this.resolveAuthentication(parsed.url)
    if (!authentication) throw Error('请先在 设置 → API Key 与连接 → GitHub 中保存账号和 Token')
    const parent = await realpath(input.destinationParent)
    const destination = join(parent, input.destinationName!)
    const existing = await lstat(destination).catch(() => null)
    if (existing && (!existing.isDirectory() || (await readdir(destination)).length))
      throw Error(`${destination} 已存在且不是空文件夹，请换一个名字或位置`)
    if (!existing) await mkdir(destination)
    const key = 'download:' + destination
    if (this.activeOperations.has(key)) throw Error('正在下载这个项目')
    this.activeOperations.add(key)
    try {
      let result: GitTransferSnapshot
      try {
        result = await transferRepository(
          { action: 'clone', url: parsed.url, destination },
          { runner: this.transferRunner, authentication },
        )
      } catch (error) {
        throw reportTransferFailure(error, 'clone', parsed.url, 'saved-github')
      }
      await markProjectSyncRepository(result.workspacePath)
      // Registers the copy with a fresh project identity (project.json is never synced).
      await this.workspaceStateService.getSnapshot(result.workspacePath)
      const synced: GitTransferSnapshot = { ...result, remoteUrl: parsed.url, repository: fullName }
      await this.workspaceStateService.setSection(
        result.workspacePath,
        PROJECT_SYNC_SECTION,
        synced,
      )
      return synced
    } finally {
      this.activeOperations.delete(key)
    }
  }

  async getSnapshot(requestedWorkspacePath: string): Promise<GitRepositorySnapshot> {
    let workspacePath = requestedWorkspacePath
    try {
      const resolved =
        await this.workspaceStateService.resolveLocalWorkspace(requestedWorkspacePath)
      if (!resolved.valid || !resolved.workspacePath) {
        return this.failureSnapshot(
          requestedWorkspacePath,
          'invalid-workspace',
          'INVALID_WORKSPACE',
          resolved.error ?? '当前工作空间不可用',
        )
      }
      workspacePath = await realpath(resolved.workspacePath)

      const detected = await this.runner.detect()
      if (!detected.available) {
        return this.failureSnapshot(
          workspacePath,
          'git-unavailable',
          'GIT_NOT_FOUND',
          '未检测到 Git，请先安装 Git',
        )
      }

      let repositoryRoot: string
      try {
        const result = await this.runner.run(workspacePath, ['rev-parse', '--show-toplevel'])
        repositoryRoot = await realpath(result.stdout.trim())
      } catch (error: unknown) {
        if (isNotRepositoryError(error)) {
          return this.failureSnapshot(
            workspacePath,
            'not-repository',
            'NOT_A_REPOSITORY',
            '当前工作空间不是 Git 仓库',
          )
        }
        throw error
      }

      if (repositoryRoot !== workspacePath) {
        return {
          ...this.emptySnapshot(workspacePath),
          availability: 'repository-outside-workspace',
          repositoryRoot,
          repositoryName: basename(repositoryRoot),
          errorCode: 'REPOSITORY_OUTSIDE_WORKSPACE',
          error: 'Git 仓库根目录位于当前工作空间之外，请打开仓库根目录',
        }
      }

      const [statusResult, workingNumstatResult, stagedNumstatResult, ignoredSharedTasks] =
        await Promise.all([
          this.runner.run(workspacePath, [
            'status',
            '--porcelain=v2',
            '--branch',
            '-z',
            '--untracked-files=all',
          ]),
          this.runner.run(workspacePath, ['diff', '--numstat', '-z', '--']),
          this.runner.run(workspacePath, ['diff', '--cached', '--numstat', '-z', '--']),
          this.findIgnoredSharedTaskDefinitions(workspacePath),
        ])
      let workspaceSettingsTracked = false
      try {
        workspaceSettingsTracked = Boolean(
          (
            await this.runner.run(workspacePath, ['ls-files', '--', workspaceSettingsPath])
          ).stdout.trim(),
        )
      } catch {
        /* status remains usable if optional sharing inspection fails */
      }
      const status = parseGitStatusPorcelainV2(statusResult.stdout)
      const workingNumstat = parseGitNumstat(workingNumstatResult.stdout)
      const stagedNumstat = parseGitNumstat(stagedNumstatResult.stdout)

      return {
        workspacePath,
        availability: 'available',
        repositoryRoot,
        repositoryName: basename(repositoryRoot),
        branch: status.branch,
        workspaceSettingsTracked,
        headOid: status.headOid,
        detached: status.detached,
        unborn: status.unborn,
        upstream: status.upstream,
        ahead: status.ahead,
        behind: status.behind,
        changeCount: status.changeCount,
        stagedCount: status.stagedCount,
        unstagedCount: status.unstagedCount,
        untrackedCount: status.untrackedCount,
        conflictedCount: status.conflictedCount,
        changes: status.changes,
        additions: workingNumstat.additions + stagedNumstat.additions,
        deletions: workingNumstat.deletions + stagedNumstat.deletions,
        lineStatsIncomplete:
          status.untrackedCount > 0 || workingNumstat.incomplete || stagedNumstat.incomplete,
        refreshedAt: this.now().toISOString(),
        revision: createHash('sha256').update(statusResult.stdout).digest('hex'),
        ...(ignoredSharedTasks.length ? { ignoredSharedTaskDefinitions: ignoredSharedTasks } : {}),
      }
    } catch (error: unknown) {
      const failure = normalizeGitFailure(error)
      return this.failureSnapshot(
        workspacePath,
        failure.code === 'GIT_NOT_FOUND' ? 'git-unavailable' : 'unavailable',
        failure.code,
        failure.message,
      )
    }
  }

  async getDiff(input: GitDiffRequest): Promise<GitDiffResult> {
    const fallback: GitDiffResult = {
      workspacePath: input.workspacePath,
      path: input.path,
      area: input.area,
      content: '',
      truncated: false,
      binary: false,
    }
    try {
      const snapshot = await this.getSnapshot(input.workspacePath)
      if (snapshot.availability !== 'available' || !snapshot.repositoryRoot) {
        return { ...fallback, error: snapshot.error ?? '当前 Git 仓库不可用' }
      }
      const change = snapshot.changes.find((entry) => entry.path === input.path)
      if (!change || !changeSupportsArea(change, input.area)) {
        return { ...fallback, error: '该变更已过期，请刷新后重试' }
      }
      if (input.area === 'conflicted') {
        return { ...fallback, error: '冲突文件暂不提供内置 Diff，请在 Terminal 中处理' }
      }

      if (input.area === 'untracked') {
        return await this.readUntrackedDiff(snapshot.repositoryRoot, input, fallback)
      }

      const args = [
        'diff',
        ...(input.area === 'staged' ? ['--cached'] : []),
        '--no-ext-diff',
        '--no-color',
        '--unified=3',
        '--',
        input.path,
      ]
      const result = await this.runner.run(snapshot.repositoryRoot, args)
      return limitDiff({ ...fallback, content: result.stdout })
    } catch (error: unknown) {
      return {
        ...fallback,
        error: normalizeGitFailure(error).message,
      }
    }
  }

  async commit(input: GitCommitInput): Promise<GitOperationResult> {
    let snapshot = await this.getSnapshot(input.workspacePath)
    if (snapshot.availability !== 'available' || !snapshot.repositoryRoot) {
      return operationFailure(snapshot, snapshot.error ?? '当前 Git 仓库不可用')
    }
    const repositoryRoot = snapshot.repositoryRoot
    if (this.activeOperations.has(repositoryRoot)) {
      return operationFailure(snapshot, '当前仓库正在执行 Git 操作，请稍候')
    }
    if (snapshot.detached) return operationFailure(snapshot, 'detached HEAD 不支持快捷提交')
    if (snapshot.conflictedCount > 0) {
      return operationFailure(snapshot, '存在冲突文件，请先在 Terminal 中处理')
    }
    if (snapshot.revision !== input.expectedRevision) {
      return operationFailure(snapshot, 'Git 状态已经变化，请刷新并重新确认提交内容')
    }

    const stageablePaths = new Set(
      snapshot.changes
        .filter((change) => !change.conflicted && (change.unstagedStatus || change.untracked))
        .map((change) => change.path),
    )
    if (input.pathsToStage.some((path) => !stageablePaths.has(path))) {
      return operationFailure(snapshot, '提交文件清单已经变化，请刷新后重试')
    }

    this.activeOperations.add(repositoryRoot)
    try {
      if (input.pathsToStage.length > 0) {
        await this.runner.run(repositoryRoot, ['add', '--', ...input.pathsToStage])
      }
      const stagedResult = await this.runner.run(repositoryRoot, [
        'diff',
        '--cached',
        '--name-only',
        '-z',
        '--',
      ])
      const stagedPaths = stagedResult.stdout.split('\0').filter(Boolean)
      if (stagedPaths.length === 0) {
        return operationFailure(
          await this.getSnapshot(input.workspacePath),
          '没有已暂存的内容可提交',
        )
      }
      const sensitiveFiles = findSensitiveFiles(stagedPaths)
      if (sensitiveFiles.length > 0) {
        return operationFailure(
          await this.getSnapshot(input.workspacePath),
          `发现敏感文件，已停止提交：${sensitiveFiles.join('、')}`,
        )
      }
      const forbiddenPaths = await inspectCclinkStudioIndex(this.runner, repositoryRoot)
      if (forbiddenPaths.length > 0) {
        return operationFailure(
          await this.getSnapshot(input.workspacePath),
          `发现禁止进入 Git 的 CCLink Studio 本机数据，已停止提交：${forbiddenPaths.join('、')}`,
        )
      }
      const sharedTaskSecrets = await inspectSharedTaskIndexSecrets(this.runner, repositoryRoot)
      if (sharedTaskSecrets.length > 0) {
        return operationFailure(
          await this.getSnapshot(input.workspacePath),
          `项目配置或共享任务定义疑似包含密码、Token 或密钥，已停止提交：${sharedTaskSecrets.join('、')}`,
        )
      }
      const invalidSharedTasks = await inspectSharedTaskIndexDefinitions(
        this.runner,
        repositoryRoot,
      )
      if (invalidSharedTasks.length > 0) {
        return operationFailure(
          await this.getSnapshot(input.workspacePath),
          `项目配置或共享任务定义格式不受支持，已停止提交：${invalidSharedTasks.join('、')}`,
        )
      }
      await this.assertGitIdentity(repositoryRoot)
      await this.runner.run(repositoryRoot, ['commit', '-m', input.message])
      snapshot = await this.getSnapshot(input.workspacePath)
      return { success: true, message: '提交成功', snapshot }
    } catch (error: unknown) {
      snapshot = await this.getSnapshot(input.workspacePath)
      const failure = normalizeGitFailure(error)
      return operationFailure(snapshot, failure.message, failure.code)
    } finally {
      this.activeOperations.delete(repositoryRoot)
    }
  }

  async push(input: GitPushInput): Promise<GitOperationResult> {
    let snapshot = await this.getSnapshot(input.workspacePath)
    if (snapshot.availability !== 'available' || !snapshot.repositoryRoot) {
      return operationFailure(snapshot, snapshot.error ?? '当前 Git 仓库不可用')
    }
    const repositoryRoot = snapshot.repositoryRoot
    if (this.activeOperations.has(repositoryRoot)) {
      return operationFailure(snapshot, '当前仓库正在执行 Git 操作，请稍候')
    }
    if (snapshot.detached || !snapshot.branch || !snapshot.headOid) {
      return operationFailure(snapshot, '当前 HEAD 不支持快捷 Push')
    }
    if (snapshot.headOid !== input.expectedHeadOid) {
      return operationFailure(snapshot, 'HEAD 已经变化，请刷新后重试')
    }
    if (!snapshot.upstream) return operationFailure(snapshot, '当前分支未设置上游')
    if ((snapshot.behind ?? 0) > 0) {
      return operationFailure(snapshot, '本机已知上游包含新提交，请先在 Terminal 中同步和确认历史')
    }

    this.activeOperations.add(repositoryRoot)
    try {
      const [remoteResult, mergeResult] = await Promise.all([
        this.runner.run(repositoryRoot, ['config', '--get', `branch.${snapshot.branch}.remote`]),
        this.runner.run(repositoryRoot, ['config', '--get', `branch.${snapshot.branch}.merge`]),
      ])
      const remote = remoteResult.stdout.trim()
      const mergeRef = mergeResult.stdout.trim()
      if (!remote || !/^[A-Za-z0-9._/-]+$/.test(remote) || !mergeRef.startsWith('refs/heads/')) {
        return operationFailure(snapshot, '当前 upstream 配置不受支持，请在 Terminal 中检查')
      }
      const targetBranch = mergeRef.slice('refs/heads/'.length)
      const forbiddenIndexPaths = await inspectCclinkStudioIndex(this.runner, repositoryRoot)
      if (forbiddenIndexPaths.length > 0) {
        return operationFailure(
          snapshot,
          `Git 已跟踪禁止共享的 CCLink Studio 本机数据，已停止 Push：${forbiddenIndexPaths.join('、')}`,
        )
      }
      const baseRef = await resolveKnownRemoteBaseRef(
        this.runner,
        repositoryRoot,
        remote,
        targetBranch,
      )
      const forbiddenHistoryPaths = await inspectCclinkStudioOutgoingHistory(
        this.runner,
        repositoryRoot,
        baseRef,
      )
      if (forbiddenHistoryPaths.length > 0) {
        return operationFailure(
          snapshot,
          `待推送历史包含禁止共享的 CCLink Studio 本机数据，已停止 Push：${forbiddenHistoryPaths.join('、')}`,
        )
      }
      const invalidSharedTasks = await inspectSharedTaskIndexDefinitions(
        this.runner,
        repositoryRoot,
      )
      const sharedTaskSecrets = await inspectSharedTaskIndexSecrets(this.runner, repositoryRoot)
      const outgoingSharedTaskContent = await inspectSharedTaskOutgoingContent(
        this.runner,
        repositoryRoot,
        baseRef,
      )
      if (invalidSharedTasks.length > 0 || outgoingSharedTaskContent.invalid.length > 0) {
        return operationFailure(
          snapshot,
          `当前或待推送历史包含无效项目配置或共享任务定义，已停止 Push：${Array.from(new Set([...invalidSharedTasks, ...outgoingSharedTaskContent.invalid])).join('、')}`,
        )
      }
      if (sharedTaskSecrets.length > 0 || outgoingSharedTaskContent.sensitive.length > 0) {
        return operationFailure(
          snapshot,
          `当前或待推送历史中的共享任务疑似包含密码、Token 或密钥，已停止 Push：${Array.from(new Set([...sharedTaskSecrets, ...outgoingSharedTaskContent.sensitive])).join('、')}`,
        )
      }
      const remoteUrlResult = await this.runner.run(repositoryRoot, ['remote', 'get-url', remote])
      const authentication = await this.resolveAuthentication(remoteUrlResult.stdout.trim())
      await this.runner.run(
        repositoryRoot,
        ['push', remote, `HEAD:refs/heads/${targetBranch}`],
        authentication ?? undefined,
      )
      snapshot = await this.getSnapshot(input.workspacePath)
      return { success: true, message: 'Push 成功', snapshot }
    } catch (error: unknown) {
      snapshot = await this.getSnapshot(input.workspacePath)
      const failure = normalizeGitFailure(error)
      return operationFailure(snapshot, failure.message, failure.code)
    } finally {
      this.activeOperations.delete(repositoryRoot)
    }
  }

  private async assertGitIdentity(repositoryRoot: string): Promise<void> {
    try {
      const [name, email] = await Promise.all([
        this.runner.run(repositoryRoot, ['config', '--get', 'user.name']),
        this.runner.run(repositoryRoot, ['config', '--get', 'user.email']),
      ])
      if (!name.stdout.trim() || !email.stdout.trim()) throw new Error('identity missing')
    } catch {
      throw new GitBackupError(
        'GIT_COMMAND_FAILED',
        'Git identity 未配置，请先设置 user.name 和 user.email',
      )
    }
  }

  private async findIgnoredSharedTaskDefinitions(
    repositoryRoot: string,
  ): Promise<Array<{ path: string; rule: string }>> {
    const relativeDirectory = '.cclink-studio/shared/scheduled-tasks'
    let entries
    try {
      entries = await readdir(resolve(repositoryRoot, relativeDirectory), { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const ignored: Array<{ path: string; rule: string }> = []
    for (const entry of entries.slice(0, 200)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const path = `${relativeDirectory}/${entry.name}`
      try {
        const result = await this.runner.run(repositoryRoot, ['check-ignore', '-v', '--', path])
        const rule = result.stdout.trim().split('\t')[0] || '未知 Git ignore 规则'
        ignored.push({ path, rule })
      } catch (error) {
        if (error instanceof GitBackupError && error.code === 'GIT_COMMAND_FAILED') continue
        throw error
      }
    }
    return ignored
  }

  private async readUntrackedDiff(
    repositoryRoot: string,
    input: GitDiffRequest,
    fallback: GitDiffResult,
  ): Promise<GitDiffResult> {
    const candidate = resolve(repositoryRoot, input.path)
    const resolvedPath = await realpath(candidate)
    if (!isWithinRoot(repositoryRoot, resolvedPath)) {
      return { ...fallback, error: 'Git 变更路径位于工作空间之外' }
    }
    const fileStat = await stat(resolvedPath)
    if (!fileStat.isFile()) return { ...fallback, error: '该未跟踪路径不是普通文件' }
    const buffer = await readFile(resolvedPath)
    if (buffer.includes(0)) return { ...fallback, binary: true, error: '二进制文件不提供文本 Diff' }
    const text = buffer.toString('utf8')
    const content = [
      `diff --git a/${input.path} b/${input.path}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${input.path}`,
      '@@ 新文件 @@',
      ...text.split('\n').map((line) => `+${line}`),
    ].join('\n')
    return limitDiff({ ...fallback, content })
  }

  private emptySnapshot(workspacePath: string): GitRepositorySnapshot {
    return {
      workspacePath,
      availability: 'unavailable',
      repositoryRoot: null,
      repositoryName: null,
      branch: null,
      headOid: null,
      detached: false,
      unborn: false,
      upstream: null,
      ahead: null,
      behind: null,
      changeCount: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      changes: [],
      additions: 0,
      deletions: 0,
      lineStatsIncomplete: false,
      refreshedAt: this.now().toISOString(),
      revision: createHash('sha256').update(`unavailable:${workspacePath}`).digest('hex'),
    }
  }

  private failureSnapshot(
    workspacePath: string,
    availability: GitRepositorySnapshot['availability'],
    errorCode: GitSnapshotErrorCode,
    error: string,
  ): GitRepositorySnapshot {
    return { ...this.emptySnapshot(workspacePath), availability, errorCode, error }
  }
}

function changeSupportsArea(change: GitChangeEntry, area: GitDiffRequest['area']): boolean {
  if (area === 'staged') return Boolean(change.stagedStatus)
  if (area === 'unstaged') return Boolean(change.unstagedStatus)
  if (area === 'untracked') return change.untracked
  return change.conflicted
}

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

function limitDiff(result: GitDiffResult): GitDiffResult {
  const maxBytes = 256 * 1024
  const maxLines = 4_000
  let content = result.content
  let truncated = false
  const lines = content.split('\n')
  if (lines.length > maxLines) {
    content = lines.slice(0, maxLines).join('\n')
    truncated = true
  }
  const encoded = Buffer.from(content, 'utf8')
  if (encoded.byteLength > maxBytes) {
    content = encoded.subarray(0, maxBytes).toString('utf8')
    truncated = true
  }
  const binary = /Binary files .* differ|GIT binary patch/i.test(content)
  return {
    ...result,
    content: binary ? '' : content,
    truncated,
    binary,
    ...(binary ? { error: '二进制文件不提供文本 Diff' } : {}),
  }
}

type TransferAuthSource = 'one-off' | 'saved-github' | 'ssh-key' | 'none'

function remoteHost(url: string | undefined): string {
  if (!url) return '-'
  try {
    return new URL(url).hostname || '-'
  } catch {
    return /^[^@\s]+@([^:\s]+):/.exec(url)?.[1] ?? '-'
  }
}

/**
 * Logs a sanitized, bounded failure record for the framework diagnostic report and turns an
 * authentication failure without any credential into an actionable message. The executor already
 * redacts the token and `user:pass@` from stderr; only the host (never the path) is added here.
 */
function reportTransferFailure(
  error: unknown,
  action: GitTransferInput['action'],
  url: string | undefined,
  authSource: TransferAuthSource,
): unknown {
  const code = error instanceof GitBackupError ? error.code : 'GIT_TRANSFER_FAILED'
  const rawStderr = error instanceof GitBackupError ? error.details?.stderr : undefined
  const stderr =
    typeof rawStderr === 'string'
      ? rawStderr.replace(/\s+/g, ' ').trim().slice(0, 500)
      : (error instanceof Error ? error.message : String(error)).slice(0, 200)
  const host = remoteHost(url)
  console.warn(`[GitSync] ${action} failed ${JSON.stringify({ code, authSource, host, stderr })}`)
  if (!(error instanceof GitBackupError) || error.code !== 'AUTHENTICATION_FAILED') return error
  if (authSource !== 'none') return error
  const message =
    host === 'github.com'
      ? 'Git 认证失败：这台电脑的 Studio 尚未保存 GitHub 用户名和 Token。请在 设置 → API Key 与连接 → GitHub 中配置，或在下方填写本次认证。'
      : 'Git 认证失败：未提供任何凭证。请在下方填写本次认证（HTTPS Token 或 SSH 私钥路径）。'
  return new GitBackupError(error.code, message, error.details, { cause: error })
}

function operationFailure(
  snapshot: GitRepositorySnapshot,
  message: string,
  errorCode?: string,
): GitOperationResult {
  return { success: false, message, snapshot, ...(errorCode ? { errorCode } : {}) }
}

function isNotRepositoryError(error: unknown): boolean {
  return (
    error instanceof GitBackupError &&
    error.code === 'GIT_COMMAND_FAILED' &&
    /not a git repository/i.test(error.message)
  )
}

function normalizeGitFailure(error: unknown): { code: GitSnapshotErrorCode; message: string } {
  if (error instanceof GitBackupError) {
    if (error.code === 'GIT_NOT_FOUND') return { code: 'GIT_NOT_FOUND', message: error.message }
    return { code: 'GIT_COMMAND_FAILED', message: error.message }
  }
  return {
    code: 'GIT_COMMAND_FAILED',
    message: error instanceof Error ? error.message : 'Git 状态读取失败',
  }
}
