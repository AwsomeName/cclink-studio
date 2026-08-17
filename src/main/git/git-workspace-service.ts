import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
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

interface GitCommandRunner {
  detect(): Promise<{ available: boolean; version: string | null }>
  run(
    cwd: string,
    args: string[],
    authentication?: { username: string; token: string },
  ): Promise<{ stdout: string; stderr: string }>
}

interface GitWorkspaceServiceOptions {
  runner?: GitCommandRunner
  now?: () => Date
  resolveAuthentication?: (remoteUrl: string) => Promise<{ username: string; token: string } | null>
}

export class GitWorkspaceService {
  private readonly runner: GitCommandRunner
  private readonly now: () => Date
  private readonly resolveAuthentication: NonNullable<
    GitWorkspaceServiceOptions['resolveAuthentication']
  >
  private readonly activeOperations = new Set<string>()

  constructor(
    private readonly workspaceStateService: WorkspaceStateService,
    options: GitWorkspaceServiceOptions = {},
  ) {
    this.runner = options.runner ?? new GitExecutor()
    this.now = options.now ?? (() => new Date())
    this.resolveAuthentication = options.resolveAuthentication ?? (async () => null)
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

      const [statusResult, workingNumstatResult, stagedNumstatResult] = await Promise.all([
        this.runner.run(workspacePath, [
          'status',
          '--porcelain=v2',
          '--branch',
          '-z',
          '--untracked-files=all',
        ]),
        this.runner.run(workspacePath, ['diff', '--numstat', '-z', '--']),
        this.runner.run(workspacePath, ['diff', '--cached', '--numstat', '-z', '--']),
      ])
      const status = parseGitStatusPorcelainV2(statusResult.stdout)
      const workingNumstat = parseGitNumstat(workingNumstatResult.stdout)
      const stagedNumstat = parseGitNumstat(stagedNumstatResult.stdout)

      return {
        workspacePath,
        availability: 'available',
        repositoryRoot,
        repositoryName: basename(repositoryRoot),
        branch: status.branch,
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
