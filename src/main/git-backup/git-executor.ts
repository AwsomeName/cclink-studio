import { execFile } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { GitBackupError } from './git-backup-error'

export interface GitAuthentication {
  username: string
  token: string
}

export interface GitCommandResult {
  stdout: string
  stderr: string
}

interface GitExecutorOptions {
  isolatedConfig?: boolean
  gitPath?: string
  timeoutMs?: number
  askPassDirectory?: string
}

interface ExecFileError extends Error {
  code?: string | number
  killed?: boolean
  stdout?: string | Buffer
  stderr?: string | Buffer
}

export class GitExecutor {
  private readonly gitPath: string
  private readonly timeoutMs: number
  private readonly askPassDirectory: string
  private readonly isolatedConfig: boolean
  private askPassPath: string | null = null

  constructor(options: GitExecutorOptions = {}) {
    this.isolatedConfig = options.isolatedConfig ?? false
    this.gitPath = options.gitPath ?? 'git'
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.askPassDirectory = options.askPassDirectory ?? join(app.getPath('userData'), 'git-backup')
  }

  async detect(): Promise<{ available: boolean; version: string | null }> {
    try {
      const result = await this.execute(['--version'], process.cwd(), undefined, 10_000)
      return { available: true, version: result.stdout.trim() || null }
    } catch (error: unknown) {
      if (error instanceof GitBackupError && error.code === 'GIT_NOT_FOUND') {
        return { available: false, version: null }
      }
      return { available: false, version: null }
    }
  }

  async run(
    cwd: string,
    args: string[],
    authentication?: GitAuthentication,
    timeoutMs = this.timeoutMs,
  ): Promise<GitCommandResult> {
    return this.execute(args, cwd, authentication, timeoutMs)
  }

  private async execute(
    args: string[],
    cwd: string,
    authentication?: GitAuthentication,
    timeoutMs = this.timeoutMs,
  ): Promise<GitCommandResult> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
      LANG: 'C',
    }
    // Explicit authentication settings must take precedence over inherited Git and SSH settings.
    for (const key of Object.keys(env))
      if (key.startsWith('GIT_') || key === 'SSH_ASKPASS') delete env[key]
    env.GIT_TERMINAL_PROMPT = '0'
    env.GIT_ASKPASS = process.platform === 'win32' ? 'cmd /c exit 1' : '/usr/bin/false'
    env.SSH_ASKPASS_REQUIRE = 'never'
    if (this.isolatedConfig) {
      env.GIT_CONFIG_NOSYSTEM = '1'
      env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
    }
    if (authentication) {
      env.GIT_ASKPASS = await this.ensureAskPass()
      env.CCLINK_GIT_USERNAME = authentication.username
      env.CCLINK_GIT_TOKEN = authentication.token
    }

    return new Promise((resolve, reject) => {
      execFile(
        this.gitPath,
        [
          '-c',
          'credential.helper=',
          '-c',
          'core.sshCommand=ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentityAgent=none -o AddKeysToAgent=no -o IgnoreUnknown=UseKeychain -o UseKeychain=no',
          ...args,
        ],
        { cwd, env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          const sanitizedStdout = sanitizeOutput(String(stdout ?? ''), authentication)
          const sanitizedStderr = sanitizeOutput(String(stderr ?? ''), authentication)
          if (!error) {
            resolve({ stdout: sanitizedStdout, stderr: sanitizedStderr })
            return
          }

          const execError = error as ExecFileError
          if (execError.code === 'ENOENT') {
            reject(new GitBackupError('GIT_NOT_FOUND', '未检测到 Git，请先安装 Git'))
            return
          }
          const detail = (sanitizedStderr || sanitizedStdout || error.message).trim()
          reject(
            new GitBackupError(
              classifyGitFailure(detail),
              describeGitFailure(detail, execError.killed === true),
              { exitCode: execError.code, stderr: detail.slice(0, 4000) },
              { cause: error },
            ),
          )
        },
      )
    })
  }

  private async ensureAskPass(): Promise<string> {
    if (this.askPassPath) return this.askPassPath
    await mkdir(this.askPassDirectory, { recursive: true })
    if (process.platform === 'win32') {
      const filePath = join(this.askPassDirectory, 'askpass.cmd')
      const script = [
        '@echo off',
        'echo %1 | findstr /I "username" >nul',
        'if %errorlevel%==0 (echo %CCLINK_GIT_USERNAME%) else (echo %CCLINK_GIT_TOKEN%)',
      ].join('\r\n')
      await writeFile(filePath, script, { encoding: 'utf-8', mode: 0o700 })
      this.askPassPath = filePath
      return filePath
    }

    const filePath = join(this.askPassDirectory, 'askpass.sh')
    const script = [
      '#!/bin/sh',
      'case "$1" in',
      '  *[Uu]sername*) printf "%s\\n" "$CCLINK_GIT_USERNAME" ;;',
      '  *) printf "%s\\n" "$CCLINK_GIT_TOKEN" ;;',
      'esac',
    ].join('\n')
    await writeFile(filePath, script, { encoding: 'utf-8', mode: 0o700 })
    await chmod(filePath, 0o700)
    this.askPassPath = filePath
    return filePath
  }
}

function sanitizeOutput(value: string, authentication?: GitAuthentication): string {
  let output = value
  if (authentication?.token) output = output.split(authentication.token).join('[REDACTED]')
  return output.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
}

function classifyGitFailure(
  detail: string,
): 'AUTHENTICATION_FAILED' | 'REMOTE_CONFLICT' | 'NETWORK_ERROR' | 'GIT_COMMAND_FAILED' {
  if (/authentication failed|could not read username|permission denied|403|401/i.test(detail)) {
    return 'AUTHENTICATION_FAILED'
  }
  if (/non-fast-forward|fetch first|refusing to merge|remote contains work/i.test(detail)) {
    return 'REMOTE_CONFLICT'
  }
  if (
    /could not resolve host|failed to connect|network is unreachable|connection timed out/i.test(
      detail,
    )
  ) {
    return 'NETWORK_ERROR'
  }
  return 'GIT_COMMAND_FAILED'
}

function describeGitFailure(detail: string, timedOut: boolean): string {
  if (timedOut) return 'Git 操作超时，请检查网络后重试'
  if (/authentication failed|could not read username|permission denied|403|401/i.test(detail)) {
    return 'Git 认证失败，请检查账号、Token 或 SSH 权限'
  }
  if (/non-fast-forward|fetch first|remote contains work/i.test(detail)) {
    return '远程仓库包含不同历史，已停止备份且不会覆盖远程内容'
  }
  if (
    /could not resolve host|failed to connect|network is unreachable|connection timed out/i.test(
      detail,
    )
  ) {
    return '无法连接远程仓库，请检查网络后重试'
  }
  return detail ? `Git 操作失败：${detail.slice(0, 300)}` : 'Git 操作失败'
}

export function getAskPassDirectory(filePath: string): string {
  return dirname(filePath)
}
