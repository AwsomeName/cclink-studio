import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { claudeProcessCommand } from '../runtime/claude-process-launch'
import { sanitizeDiagnosticText } from '../../../shared/diagnostics'
import type { CodexDiagnosticStage, CodexRuntimeDiagnostic } from '../../../shared/codex-runtime'
import { CodexRuntimeError, codexRpcError } from './codex-runtime-policy'

export interface CodexMessage {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

export function codexExecutableCandidates(): string[] {
  const candidates = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((p) => join(p, process.platform === 'win32' ? 'codex.exe' : 'codex'))
  if (process.platform === 'darwin') {
    for (const root of ['/Applications', join(homedir(), 'Applications')]) {
      for (const app of ['Codex.app', 'ChatGPT.app']) {
        candidates.push(
          join(root, app, 'Contents/Resources/codex'),
          join(root, app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
        )
      }
    }
  }
  return [...new Set(candidates)]
}

export async function resolveCodexExecutable(
  candidates = codexExecutableCandidates(),
): Promise<string> {
  let permissionDenied = false
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch (error) {
      permissionDenied ||= (error as NodeJS.ErrnoException).code === 'EACCES'
      /* next */
    }
  }
  if (permissionDenied)
    throw new CodexRuntimeError(
      'CODEX_NOT_EXECUTABLE',
      '找到 Codex 候选路径，但没有执行或目录访问权限。',
      'start-failed',
      'discovery',
    )
  throw new CodexRuntimeError(
    'CODEX_NOT_FOUND',
    '未找到可执行的本机 Codex。请检查安装位置和 Studio 进程的 PATH。',
    'not-found',
    'discovery',
  )
}

export function codexEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      /^(ANTHROPIC_|CLAUDE_|CCLINK_|ELECTRON_|CODEX_INTERNAL_|CODEX_THREAD)/.test(key) ||
      ['CLAUDECODE', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL'].includes(key)
    )
      delete env[key]
  }
  // Studio MCP is loopback-only. Inherited proxies must not receive its requests
  // (including the per-run session token); keep proxies for the model service.
  const noProxy = [
    ...new Set(
      [env.NO_PROXY, env.no_proxy, '127.0.0.1,localhost,::1']
        .flatMap((value) => value?.split(',') ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].join(',')
  env.NO_PROXY = noProxy
  env.no_proxy = noProxy
  return env
}

/** Owned stdio connection; never attaches to or mutates another Codex app's server. */
export class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null
  private lines: Interface | null = null
  private sequence = 0
  private closed = false
  private exited: Promise<void> = Promise.resolve()
  private diagnostic: CodexRuntimeDiagnostic = {
    checkedAt: new Date().toISOString(),
    state: 'start-failed',
    stage: 'discovery',
    code: 'CODEX_NOT_STARTED',
    message: '尚未启动',
    executable: null,
    searchedPaths: [],
    platform: process.platform,
    arch: process.arch,
    auth: 'not-checked',
    exitCode: null,
    signal: null,
  }
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  constructor(
    private readonly onMessage: (message: CodexMessage) => void,
    private readonly onExit: (error: Error) => void,
    private readonly requestTimeoutMs = 60_000,
  ) {}

  getDiagnostic(error?: unknown): CodexRuntimeDiagnostic {
    const known = error instanceof CodexRuntimeError ? error : null
    return {
      ...this.diagnostic,
      checkedAt: new Date().toISOString(),
      ...(error
        ? {
            state:
              known?.state ??
              (['thread', 'tools', 'turn'].includes(this.diagnostic.stage)
                ? 'run-failed'
                : 'start-failed'),
            stage: known?.stage ?? this.diagnostic.stage,
            code: known?.code ?? 'CODEX_OPERATION_FAILED',
            message:
              known?.message ?? 'Codex 操作失败；请结合失败阶段和运行错误检查版本、配置及网络。',
          }
        : {}),
    }
  }

  recordAccount(account: Record<string, unknown>): void {
    const type = (account.account as { type?: unknown } | null)?.type
    this.diagnostic.auth = !account.account
      ? 'missing'
      : type === 'chatgpt' && account.requiresOpenaiAuth === true
        ? 'chatgpt'
        : 'unsupported'
  }

  markReady(): void {
    this.diagnostic.state = 'ready'
    this.diagnostic.code = 'CODEX_READY'
    this.diagnostic.message =
      '进程握手和本地 ChatGPT 文件登录检查通过；尚未验证模型网络请求或账号额度。'
  }

  async start(cwd: string): Promise<void> {
    const candidates = codexExecutableCandidates()
    this.diagnostic.searchedPaths = candidates
      .slice(0, 100)
      .map((path) => sanitizeDiagnosticText(path, 500))
    const executable = await resolveCodexExecutable(candidates)
    this.diagnostic.executable = sanitizeDiagnosticText(executable, 500)
    this.diagnostic.stage = 'spawn'
    if (this.closed) throw new Error('Codex 运行已取消')
    const env = codexEnvironment()
    const args = [
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'cli_auth_credentials_store="file"',
      '-c',
      'mcp_oauth_credentials_store="file"',
      '-c',
      'analytics.enabled=false',
    ]
    for (const feature of [
      'apps',
      'plugins',
      'hooks',
      'multi_agent',
      'multi_agent_v2',
      'browser_use',
      'computer_use',
      'in_app_browser',
      'in_app_local_automation',
      'skill_mcp_dependency_install',
    ])
      args.push('-c', `features.${feature}=false`)
    const launch = claudeProcessCommand(executable, args, env)
    const child = spawn(launch.command, launch.args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    this.child = child
    this.exited = new Promise((resolve) => {
      child.once('exit', () => resolve())
      child.once('error', () => resolve())
    })
    // Drain without logging provider diagnostics that can contain credentials or prompts.
    child.stderr.resume()
    child.stdin.on('error', () => this.fail(new Error('Codex 输入通道已关闭')))
    child.once('error', (error: NodeJS.ErrnoException) =>
      this.fail(
        new CodexRuntimeError(
          `CODEX_SPAWN_${['ENOENT', 'EACCES', 'ENOEXEC', 'EPERM'].includes(error.code ?? '') ? error.code : 'FAILED'}`,
          'Codex 进程启动失败，请检查可执行文件、系统权限和架构是否匹配。',
          'start-failed',
          'spawn',
        ),
      ),
    )
    child.once('exit', (code, signal) => {
      if (this.closed) return
      this.diagnostic.exitCode = code
      this.diagnostic.signal = signal
      this.fail(
        new CodexRuntimeError(
          'CODEX_PROCESS_EXITED',
          `Codex 进程异常退出（${code ?? signal ?? 'unknown'}）。`,
          ['thread', 'tools', 'turn'].includes(this.diagnostic.stage)
            ? 'run-failed'
            : 'start-failed',
          this.diagnostic.stage,
        ),
      )
    })
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', (line) => {
      let message: CodexMessage
      try {
        message = JSON.parse(line) as CodexMessage
      } catch {
        return
      }
      if (!message || typeof message !== 'object') return
      if (typeof message.id === 'number' && !message.method) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error)
          pending.reject(
            codexRpcError(message.error.code, message.error.message, this.diagnostic.stage),
          )
        else pending.resolve(message.result)
      } else this.onMessage(message)
    })
    await this.request('initialize', {
      clientInfo: { name: 'cclink_studio', title: 'CCLink Studio', version: '1' },
    })
    this.write({ method: 'initialized', params: {} })
  }

  request<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (this.closed || !this.child) return Promise.reject(new Error('Codex 连接未就绪'))
    const stages: Record<string, CodexDiagnosticStage> = {
      initialize: 'initialize',
      'account/read': 'account',
      'config/read': 'config',
      'thread/start': 'thread',
      'thread/resume': 'thread',
      'mcpServerStatus/list': 'tools',
      'turn/start': 'turn',
    }
    if (stages[method]) this.diagnostic.stage = stages[method]
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new CodexRuntimeError(
            'CODEX_REQUEST_TIMEOUT',
            `Codex 请求超时：${method}`,
            ['thread', 'tools', 'turn'].includes(this.diagnostic.stage)
              ? 'run-failed'
              : 'start-failed',
            this.diagnostic.stage,
          ),
        )
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.write({ id, method, params })
    })
  }

  respond(id: number | string, result: unknown): void {
    this.write({ id, result })
  }

  private write(message: CodexMessage): void {
    if (!this.closed && this.child?.stdin.writable)
      this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  close(): void {
    this.closed = true
    this.lines?.close()
    this.lines = null
    const child = this.child
    this.child = null
    child?.stdin.end()
    if (child && child.exitCode === null && child.signalCode === null) {
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
          else child.kill(signal)
        } catch {
          /* Already exited. */
        }
      }
      kill('SIGTERM')
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) kill('SIGKILL')
      }, 2000)
      child.once('exit', () => clearTimeout(timer))
      timer.unref()
    }
    this.rejectPending(new Error('Codex 连接已关闭'))
  }

  async stop(): Promise<void> {
    this.close()
    await this.exited
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.rejectPending(error)
    this.onExit(error)
  }
}
