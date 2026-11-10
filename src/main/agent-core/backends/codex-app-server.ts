import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeProcessCommand } from '../runtime/claude-process-launch'

export interface CodexMessage {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

export async function resolveCodexExecutable(): Promise<string> {
  const candidates = (process.env.PATH ?? '')
    .split(':')
    .filter(Boolean)
    .map((p) => join(p, 'codex'))
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
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      /* next */
    }
  }
  throw new Error('未找到本机 Codex。请安装并在终端登录 Codex，或在新会话中选择 Claude Code。')
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
  return env
}

/** Owned stdio connection; never attaches to or mutates another Codex app's server. */
export class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null
  private lines: Interface | null = null
  private sequence = 0
  private closed = false
  private exited: Promise<void> = Promise.resolve()
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
  ) {}

  async start(cwd: string): Promise<void> {
    const executable = await resolveCodexExecutable()
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
    child.once('error', () => this.fail(new Error('Codex 启动失败，请检查本机安装和执行权限')))
    child.once('exit', (code) => this.fail(new Error(`Codex 进程已退出（${code ?? 'signal'}）`)))
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
        if (message.error) pending.reject(new Error(message.error.message))
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
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex 请求超时：${method}`))
      }, 60_000)
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
