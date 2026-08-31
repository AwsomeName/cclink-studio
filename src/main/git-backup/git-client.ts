import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { GitBackupError } from './git-backup-error'
import type { GitAuthentication, GitCommandResult } from './git-executor'
import { GitExecutor } from './git-executor'
import {
  inspectCclinkStudioIndex,
  inspectCclinkStudioOutgoingHistory,
  inspectSharedTaskIndexDefinitions,
  inspectSharedTaskIndexSecrets,
  inspectSharedTaskOutgoingContent,
  resolveKnownRemoteBaseRef,
  updateCclinkStudioExcludeBlock,
} from '../git/cclink-studio-path-policy'

const EXCLUDE_RULES = [
  '# CCLink Studio manual backup',
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  '.cache/',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
]

export class GitClient {
  constructor(private readonly executor = new GitExecutor()) {}

  detect(): Promise<{ available: boolean; version: string | null }> {
    return this.executor.detect()
  }

  async isRepository(workspacePath: string): Promise<boolean> {
    try {
      const result = await this.executor.run(workspacePath, ['rev-parse', '--is-inside-work-tree'])
      return result.stdout.trim() === 'true'
    } catch (error: unknown) {
      if (error instanceof GitBackupError && error.code === 'GIT_COMMAND_FAILED') return false
      throw error
    }
  }

  async initialize(workspacePath: string): Promise<void> {
    try {
      await this.executor.run(workspacePath, ['init', '-b', 'main'])
    } catch (error: unknown) {
      if (
        !(error instanceof GitBackupError) ||
        !/unknown switch|unknown option/i.test(error.message)
      ) {
        throw error
      }
      await this.executor.run(workspacePath, ['init'])
      await this.executor.run(workspacePath, ['branch', '-M', 'main'])
    }
  }

  async ensureLocalExcludes(workspacePath: string): Promise<void> {
    const result = await this.executor.run(workspacePath, [
      'rev-parse',
      '--git-path',
      'info/exclude',
    ])
    const rawPath = result.stdout.trim()
    if (!rawPath) throw new GitBackupError('GIT_COMMAND_FAILED', '无法定位 Git 排除文件')
    const excludePath = isAbsolute(rawPath) ? rawPath : resolve(workspacePath, rawPath)
    let current = ''
    try {
      current = await readFile(excludePath, 'utf-8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const withGeneralRules = EXCLUDE_RULES.reduce((contents, rule) => {
      const lines = new Set(contents.split(/\r?\n/))
      if (lines.has(rule)) return contents
      const prefix = contents && !contents.endsWith('\n') ? `${contents}\n` : contents
      return `${prefix}${rule}\n`
    }, current)
    const next = updateCclinkStudioExcludeBlock(withGeneralRules)
    if (next !== current) {
      if (current) await copyFile(excludePath, `${excludePath}.cclink-studio.bak`)
      const tempPath = `${excludePath}.${process.pid}.cclink-studio.tmp`
      await writeFile(tempPath, next, 'utf-8')
      await rename(tempPath, excludePath)
    }
  }

  async listCandidateFiles(workspacePath: string): Promise<string[]> {
    const result = await this.executor.run(workspacePath, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ])
    return result.stdout.split('\0').filter(Boolean)
  }

  async hasChanges(workspacePath: string): Promise<boolean> {
    const result = await this.executor.run(workspacePath, ['status', '--porcelain=v1', '-z'])
    return result.stdout.length > 0
  }

  async hasHead(workspacePath: string): Promise<boolean> {
    try {
      await this.executor.run(workspacePath, ['rev-parse', '--verify', 'HEAD'])
      return true
    } catch (error: unknown) {
      if (error instanceof GitBackupError && error.code === 'GIT_COMMAND_FAILED') return false
      throw error
    }
  }

  stageAll(workspacePath: string): Promise<GitCommandResult> {
    return this.executor.run(workspacePath, ['add', '--all'])
  }

  inspectCclinkStudioIndex(workspacePath: string): Promise<string[]> {
    return inspectCclinkStudioIndex(this.executor, workspacePath)
  }

  inspectSharedTaskIndexSecrets(workspacePath: string): Promise<string[]> {
    return inspectSharedTaskIndexSecrets(this.executor, workspacePath)
  }

  inspectSharedTaskIndexDefinitions(workspacePath: string): Promise<string[]> {
    return inspectSharedTaskIndexDefinitions(this.executor, workspacePath)
  }

  async inspectCclinkStudioOutgoingHistory(
    workspacePath: string,
    remoteName: string,
    branch: string,
  ): Promise<string[]> {
    const baseRef = await resolveKnownRemoteBaseRef(
      this.executor,
      workspacePath,
      remoteName,
      branch,
    )
    return inspectCclinkStudioOutgoingHistory(this.executor, workspacePath, baseRef)
  }

  async inspectSharedTaskOutgoingContent(
    workspacePath: string,
    remoteName: string,
    branch: string,
  ): Promise<{ invalid: string[]; sensitive: string[] }> {
    const baseRef = await resolveKnownRemoteBaseRef(
      this.executor,
      workspacePath,
      remoteName,
      branch,
    )
    return inspectSharedTaskOutgoingContent(this.executor, workspacePath, baseRef)
  }

  commit(workspacePath: string, message: string, allowEmpty = false): Promise<GitCommandResult> {
    const args = [
      '-c',
      'user.name=CCLink Studio Backup',
      '-c',
      'user.email=backup@cclink.local',
      'commit',
      ...(allowEmpty ? ['--allow-empty'] : []),
      '-m',
      message,
    ]
    return this.executor.run(workspacePath, args)
  }

  async currentBranch(workspacePath: string): Promise<string> {
    const result = await this.executor.run(workspacePath, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD',
    ])
    const branch = result.stdout.trim()
    if (!branch)
      throw new GitBackupError('GIT_COMMAND_FAILED', '当前仓库处于 detached HEAD，无法备份')
    return branch
  }

  async setRemote(workspacePath: string, remoteName: string, remoteUrl: string): Promise<void> {
    let currentUrl: string
    try {
      const current = await this.executor.run(workspacePath, ['remote', 'get-url', remoteName])
      currentUrl = current.stdout.trim()
    } catch (error: unknown) {
      if (!(error instanceof GitBackupError) || error.code !== 'GIT_COMMAND_FAILED') throw error
      await this.executor.run(workspacePath, ['remote', 'add', remoteName, remoteUrl])
      return
    }
    if (currentUrl !== remoteUrl) {
      await this.executor.run(workspacePath, ['remote', 'set-url', remoteName, remoteUrl])
    }
  }

  push(
    workspacePath: string,
    remoteName: string,
    branch: string,
    authentication?: GitAuthentication,
  ): Promise<GitCommandResult> {
    return this.executor.run(
      workspacePath,
      ['push', remoteName, `HEAD:refs/heads/${branch}`],
      authentication,
    )
  }
}
