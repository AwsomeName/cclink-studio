import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 该文件会并行启动多组真实 Git 子进程；整套测试高负载下 5s 默认预算不足。
vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 })

const execFileAsync = promisify(execFile)
const mockPaths = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => mockPaths.userData },
}))

import type { WorkspaceStateService } from '../workspace/workspace-state-service'
import { GitExecutor } from '../git-backup/git-executor'
import { GitWorkspaceService } from './git-workspace-service'

let tempDir = ''

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'cclink-studio-git-workspace-'))
  mockPaths.userData = join(tempDir, 'user-data')
  await mkdir(mockPaths.userData, { recursive: true })
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('GitWorkspaceService', () => {
  it('reads branch, grouped changes and known line counts from a real repository', async () => {
    const workspacePath = join(tempDir, 'workspace')
    await mkdir(workspacePath)
    await git(workspacePath, ['init', '-b', 'main'])
    await git(workspacePath, ['config', 'user.name', 'Test User'])
    await git(workspacePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(workspacePath, 'tracked.txt'), 'before\n', 'utf-8')
    await git(workspacePath, ['add', 'tracked.txt'])
    await git(workspacePath, ['commit', '-m', 'initial'])

    await writeFile(join(workspacePath, 'tracked.txt'), 'after\n', 'utf-8')
    await writeFile(join(workspacePath, 'staged.txt'), 'staged\n', 'utf-8')
    await writeFile(join(workspacePath, 'untracked.txt'), 'untracked\n', 'utf-8')
    await git(workspacePath, ['add', 'staged.txt'])

    const service = createService(workspacePath)
    const snapshot = await service.getSnapshot(workspacePath)

    expect(snapshot).toMatchObject({
      availability: 'available',
      repositoryRoot: await realpath(workspacePath),
      repositoryName: 'workspace',
      branch: 'main',
      detached: false,
      unborn: false,
      upstream: null,
      ahead: null,
      behind: null,
      changeCount: 3,
      stagedCount: 1,
      unstagedCount: 1,
      untrackedCount: 1,
      conflictedCount: 0,
      additions: 2,
      deletions: 1,
      lineStatsIncomplete: true,
    })

    await expect(
      service.getDiff({ workspacePath, path: 'tracked.txt', area: 'unstaged' }),
    ).resolves.toMatchObject({ content: expect.stringContaining('+after'), truncated: false })
    await expect(
      service.getDiff({ workspacePath, path: 'staged.txt', area: 'staged' }),
    ).resolves.toMatchObject({ content: expect.stringContaining('+staged'), truncated: false })
    await expect(
      service.getDiff({ workspacePath, path: 'untracked.txt', area: 'untracked' }),
    ).resolves.toMatchObject({ content: expect.stringContaining('@@ 新文件 @@') })
    await expect(
      service.getDiff({ workspacePath, path: '../outside.txt', area: 'untracked' }),
    ).resolves.toMatchObject({ error: '该变更已过期，请刷新后重试' })
  })

  it('does not expose a parent repository through a child workspace', async () => {
    const repositoryPath = join(tempDir, 'repository')
    const workspacePath = join(repositoryPath, 'packages', 'child')
    await mkdir(workspacePath, { recursive: true })
    await git(repositoryPath, ['init', '-b', 'main'])

    const snapshot = await createService(workspacePath).getSnapshot(workspacePath)

    expect(snapshot).toMatchObject({
      availability: 'repository-outside-workspace',
      repositoryRoot: await realpath(repositoryPath),
      errorCode: 'REPOSITORY_OUTSIDE_WORKSPACE',
    })
  })

  it('returns a normal capability state for non-repositories', async () => {
    const workspacePath = join(tempDir, 'plain-workspace')
    await mkdir(workspacePath)

    await expect(createService(workspacePath).getSnapshot(workspacePath)).resolves.toMatchObject({
      availability: 'not-repository',
      errorCode: 'NOT_A_REPOSITORY',
      changeCount: 0,
    })
  })

  it('reports the exact Git rule that still ignores a shared task definition', async () => {
    const workspacePath = join(tempDir, 'ignored-shared-task')
    const sharedDirectory = join(workspacePath, '.cclink-studio/shared/scheduled-tasks')
    await mkdir(sharedDirectory, { recursive: true })
    await git(workspacePath, ['init', '-b', 'main'])
    await writeFile(join(workspacePath, '.gitignore'), '.cclink-studio/\n', 'utf-8')
    const taskPath =
      '.cclink-studio/shared/scheduled-tasks/12345678-1234-1234-1234-123456789abc.json'
    await writeFile(join(workspacePath, taskPath), '{}\n', 'utf-8')

    const snapshot = await createService(workspacePath).getSnapshot(workspacePath)

    expect(snapshot.ignoredSharedTaskDefinitions).toEqual([
      { path: taskPath, rule: expect.stringContaining('.gitignore') },
    ])
  })

  it('commits existing staged content without absorbing an unselected partial worktree change', async () => {
    const workspacePath = join(tempDir, 'partial-workspace')
    await mkdir(workspacePath)
    await git(workspacePath, ['init', '-b', 'main'])
    await git(workspacePath, ['config', 'user.name', 'Test User'])
    await git(workspacePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(workspacePath, 'partial.txt'), 'base\n', 'utf-8')
    await git(workspacePath, ['add', 'partial.txt'])
    await git(workspacePath, ['commit', '-m', 'initial'])
    await writeFile(join(workspacePath, 'partial.txt'), 'staged\n', 'utf-8')
    await git(workspacePath, ['add', 'partial.txt'])
    await writeFile(join(workspacePath, 'partial.txt'), 'unstaged\n', 'utf-8')

    const service = createService(workspacePath)
    const snapshot = await service.getSnapshot(workspacePath)
    const result = await service.commit({
      workspacePath,
      expectedRevision: snapshot.revision,
      message: 'keep partial staging',
      pathsToStage: [],
    })

    expect(result).toMatchObject({
      success: true,
      snapshot: { changeCount: 1, stagedCount: 0, unstagedCount: 1 },
    })
    expect(await gitOutput(workspacePath, ['show', 'HEAD:partial.txt'])).toBe('staged\n')
    expect(await readFile(join(workspacePath, 'partial.txt'), 'utf-8')).toBe('unstaged\n')
  })

  it('pushes only the current HEAD to the configured upstream without force', async () => {
    const workspacePath = join(tempDir, 'push-workspace')
    const remotePath = join(tempDir, 'remote.git')
    await mkdir(workspacePath)
    await git(tempDir, ['init', '--bare', remotePath])
    await git(workspacePath, ['init', '-b', 'main'])
    await git(workspacePath, ['config', 'user.name', 'Test User'])
    await git(workspacePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(workspacePath, 'tracked.txt'), 'initial\n', 'utf-8')
    await git(workspacePath, ['add', 'tracked.txt'])
    await git(workspacePath, ['commit', '-m', 'initial'])
    await git(workspacePath, ['remote', 'add', 'origin', remotePath])
    await git(workspacePath, ['push', '-u', 'origin', 'main'])
    await writeFile(join(workspacePath, 'tracked.txt'), 'next\n', 'utf-8')

    const service = createService(workspacePath)
    const beforeCommit = await service.getSnapshot(workspacePath)
    const committed = await service.commit({
      workspacePath,
      expectedRevision: beforeCommit.revision,
      message: 'next',
      pathsToStage: ['tracked.txt'],
    })
    expect(committed).toMatchObject({ success: true, snapshot: { ahead: 1 } })

    const pushed = await service.push({
      workspacePath,
      expectedHeadOid: committed.snapshot.headOid!,
    })
    expect(pushed).toMatchObject({ success: true, message: 'Push 成功' })
    expect(
      await gitOutput(tempDir, ['--git-dir', remotePath, 'rev-parse', 'refs/heads/main']),
    ).toBe(`${committed.snapshot.headOid}\n`)
  })

  it('rejects stale confirmation and sensitive files without creating a commit', async () => {
    const workspacePath = join(tempDir, 'guarded-workspace')
    await mkdir(workspacePath)
    await git(workspacePath, ['init', '-b', 'main'])
    await git(workspacePath, ['config', 'user.name', 'Test User'])
    await git(workspacePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(workspacePath, 'README.md'), 'initial\n', 'utf-8')
    await git(workspacePath, ['add', 'README.md'])
    await git(workspacePath, ['commit', '-m', 'initial'])
    await writeFile(join(workspacePath, '.env'), 'SECRET=value\n', 'utf-8')

    const service = createService(workspacePath)
    const staleSnapshot = await service.getSnapshot(workspacePath)
    await writeFile(join(workspacePath, 'later.txt'), 'later\n', 'utf-8')
    const staleResult = await service.commit({
      workspacePath,
      expectedRevision: staleSnapshot.revision,
      message: 'must be stale',
      pathsToStage: ['.env'],
    })
    expect(staleResult).toMatchObject({ success: false, message: expect.stringContaining('变化') })

    const latestSnapshot = await service.getSnapshot(workspacePath)
    const sensitiveResult = await service.commit({
      workspacePath,
      expectedRevision: latestSnapshot.revision,
      message: 'must reject sensitive file',
      pathsToStage: ['.env'],
    })
    expect(sensitiveResult).toMatchObject({
      success: false,
      message: expect.stringContaining('敏感文件'),
    })
    expect(await gitOutput(workspacePath, ['rev-list', '--count', 'HEAD'])).toBe('1\n')
  })

  it('blocks already tracked local CCLink Studio state even when ignore rules cannot help', async () => {
    const workspacePath = join(tempDir, 'tracked-local-state')
    await mkdir(join(workspacePath, '.cclink-studio', 'scheduled-tasks'), { recursive: true })
    await git(workspacePath, ['init', '-b', 'main'])
    await git(workspacePath, ['config', 'user.name', 'Test User'])
    await git(workspacePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(workspacePath, 'README.md'), 'initial\n', 'utf-8')
    await git(workspacePath, ['add', 'README.md'])
    await git(workspacePath, ['commit', '-m', 'initial'])
    const localDefinition =
      '.cclink-studio/scheduled-tasks/12345678-1234-1234-1234-123456789abc.json'
    await writeFile(join(workspacePath, localDefinition), '{}\n', 'utf-8')
    await git(workspacePath, ['add', '-f', localDefinition])

    const service = createService(workspacePath)
    const snapshot = await service.getSnapshot(workspacePath)
    const result = await service.commit({
      workspacePath,
      expectedRevision: snapshot.revision,
      message: 'must not commit local state',
      pathsToStage: [],
    })

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('禁止进入 Git'),
    })
    expect(await gitOutput(workspacePath, ['rev-list', '--count', 'HEAD'])).toBe('1\n')
  })

  it('allows a shared task JSON path but blocks obvious secrets in its staged content', async () => {
    const workspacePath = join(tempDir, 'shared-task-content')
    const sharedDirectory = join(workspacePath, '.cclink-studio/shared/scheduled-tasks')
    await mkdir(sharedDirectory, { recursive: true })
    await git(workspacePath, ['init', '-b', 'main'])
    await git(workspacePath, ['config', 'user.name', 'Test User'])
    await git(workspacePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(workspacePath, 'README.md'), 'initial\n', 'utf-8')
    await git(workspacePath, ['add', 'README.md'])
    await git(workspacePath, ['commit', '-m', 'initial'])
    const sharedPath =
      '.cclink-studio/shared/scheduled-tasks/12345678-1234-1234-1234-123456789abc.json'
    const sharedDefinition = {
      schemaVersion: 2,
      id: '12345678-1234-1234-1234-123456789abc',
      revision: 1,
      title: 'Shared task',
      instruction: 'Generate a report',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      resources: [{ kind: 'workspace' }],
      outputPolicy: {
        directory: 'docs',
        fileNameTemplate: 'report.md',
        mode: 'create-only',
      },
      createdAt: 1,
      updatedAt: 1,
    }
    await writeFile(
      join(workspacePath, sharedPath),
      `${JSON.stringify(sharedDefinition)}\n`,
      'utf-8',
    )
    const service = createService(workspacePath)
    const safeSnapshot = await service.getSnapshot(workspacePath)
    await expect(
      service.commit({
        workspacePath,
        expectedRevision: safeSnapshot.revision,
        message: 'safe shared task',
        pathsToStage: [sharedPath],
      }),
    ).resolves.toMatchObject({ success: true })

    await writeFile(join(workspacePath, sharedPath), '{"schemaVersion":2}\n', 'utf-8')
    const invalidSnapshot = await service.getSnapshot(workspacePath)
    await expect(
      service.commit({
        workspacePath,
        expectedRevision: invalidSnapshot.revision,
        message: 'must reject invalid shared task',
        pathsToStage: [sharedPath],
      }),
    ).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining('合法的 v2'),
    })

    await writeFile(
      join(workspacePath, sharedPath),
      `${JSON.stringify({ ...sharedDefinition, revision: 2, instruction: 'token=abcdef123456' })}\n`,
      'utf-8',
    )
    const secretSnapshot = await service.getSnapshot(workspacePath)
    await expect(
      service.commit({
        workspacePath,
        expectedRevision: secretSnapshot.revision,
        message: 'must reject secret',
        pathsToStage: [sharedPath],
      }),
    ).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining('Token'),
    })
  })

  it('blocks a forbidden path that exists only in an earlier outgoing commit', async () => {
    const workspacePath = join(tempDir, 'outgoing-history')
    const remotePath = join(tempDir, 'outgoing-history.git')
    await mkdir(join(workspacePath, '.cclink-studio', 'scheduled-task-results'), {
      recursive: true,
    })
    await git(tempDir, ['init', '--bare', remotePath])
    await git(workspacePath, ['init', '-b', 'main'])
    await git(workspacePath, ['config', 'user.name', 'Test User'])
    await git(workspacePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(workspacePath, 'README.md'), 'initial\n', 'utf-8')
    await git(workspacePath, ['add', 'README.md'])
    await git(workspacePath, ['commit', '-m', 'initial'])
    await git(workspacePath, ['remote', 'add', 'origin', remotePath])
    await git(workspacePath, ['push', '-u', 'origin', 'main'])
    const forbiddenPath = '.cclink-studio/scheduled-task-results/private.md'
    await writeFile(join(workspacePath, forbiddenPath), 'private\n', 'utf-8')
    await git(workspacePath, ['add', '-f', forbiddenPath])
    await git(workspacePath, ['commit', '-m', 'accidental local result'])
    await rm(join(workspacePath, forbiddenPath))
    await git(workspacePath, ['add', '-u', '--', forbiddenPath])
    await git(workspacePath, ['commit', '-m', 'delete accidental result'])

    const service = createService(workspacePath)
    const snapshot = await service.getSnapshot(workspacePath)
    const result = await service.push({
      workspacePath,
      expectedHeadOid: snapshot.headOid!,
    })

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('待推送历史'),
    })
  })

  it('blocks invalid shared task content that exists only in outgoing history', async () => {
    const workspacePath = join(tempDir, 'invalid-shared-history')
    const remotePath = join(tempDir, 'invalid-shared-history.git')
    await mkdir(join(workspacePath, '.cclink-studio/shared/scheduled-tasks'), {
      recursive: true,
    })
    await git(tempDir, ['init', '--bare', remotePath])
    await git(workspacePath, ['init', '-b', 'main'])
    await git(workspacePath, ['config', 'user.name', 'Test User'])
    await git(workspacePath, ['config', 'user.email', 'test@example.com'])
    await writeFile(join(workspacePath, 'README.md'), 'initial\n', 'utf-8')
    await git(workspacePath, ['add', 'README.md'])
    await git(workspacePath, ['commit', '-m', 'initial'])
    await git(workspacePath, ['remote', 'add', 'origin', remotePath])
    await git(workspacePath, ['push', '-u', 'origin', 'main'])
    const sharedPath =
      '.cclink-studio/shared/scheduled-tasks/12345678-1234-1234-1234-123456789abc.json'
    await writeFile(join(workspacePath, sharedPath), '{"schemaVersion":2}\n', 'utf-8')
    await git(workspacePath, ['add', sharedPath])
    await git(workspacePath, ['commit', '-m', 'invalid shared definition'])
    await rm(join(workspacePath, sharedPath))
    await git(workspacePath, ['add', '-u', '--', sharedPath])
    await git(workspacePath, ['commit', '-m', 'delete invalid shared definition'])

    const service = createService(workspacePath)
    const snapshot = await service.getSnapshot(workspacePath)
    await expect(
      service.push({ workspacePath, expectedHeadOid: snapshot.headOid! }),
    ).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining('无效共享任务定义'),
    })
  })
})

function createService(workspacePath: string): GitWorkspaceService {
  const workspaceStateService = {
    resolveLocalWorkspace: async (requestedPath: string) => ({
      valid: requestedPath === workspacePath,
      workspacePath,
    }),
  } as unknown as WorkspaceStateService
  return new GitWorkspaceService(workspaceStateService, {
    runner: new GitExecutor({ askPassDirectory: join(tempDir, 'askpass') }),
    now: () => new Date('2026-08-17T10:00:00.000Z'),
  })
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd })
  return String(result.stdout)
}
