import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { REMOTE_ERROR_CODE, type RemoteError } from '../../shared/remote-error'
import type { TerminalBackend, TerminalExecutionEvent } from '../../shared/terminal'
import type {
  TerminalExecutionAdapter,
  TerminalExecutionEventListener,
  TerminalSize,
  TerminalStartInput,
  TerminalStartResult,
  TerminalWriteInput,
} from './terminal-execution-adapter'

interface LocalShellSession {
  process: ChildProcessWithoutNullStreams
  runtimeCwd?: string
}

export interface LocalShellExecutionAdapterOptions {
  now?: () => number
  spawnShell?: (input: {
    shell: string
    cwd?: string
    env: NodeJS.ProcessEnv
  }) => ChildProcessWithoutNullStreams
}

export class TerminalLocalShellError extends Error {
  readonly remoteError: RemoteError

  constructor(remoteError: RemoteError) {
    super(remoteError.message)
    this.name = 'TerminalLocalShellError'
    this.remoteError = remoteError
  }
}

export class LocalShellExecutionAdapter implements TerminalExecutionAdapter {
  readonly backend: TerminalBackend = 'local-shell'

  private readonly sessions = new Map<string, LocalShellSession>()
  private readonly listeners = new Set<TerminalExecutionEventListener>()
  private readonly now: () => number
  private readonly spawnShell: NonNullable<LocalShellExecutionAdapterOptions['spawnShell']>

  constructor(options: LocalShellExecutionAdapterOptions = {}) {
    this.now = options.now ?? Date.now
    this.spawnShell = options.spawnShell ?? defaultSpawnShell
  }

  async start(input: TerminalStartInput): Promise<TerminalStartResult> {
    if (input.runtime.location !== 'local') {
      throw this.createUnavailableError(
        input.sessionId,
        'terminal.start',
        '远程 Terminal 执行后端尚未接入',
      )
    }
    if (this.sessions.has(input.sessionId)) {
      return {
        sessionId: input.sessionId,
        status: 'running',
        processId: this.sessions.get(input.sessionId)?.process.pid,
      }
    }

    const cwd = normalizeCwd(input.runtime.cwd)
    const child = this.spawnShell({
      shell: input.runtime.shell || getDefaultShell(),
      cwd,
      env: {
        ...process.env,
        ...input.env,
        TERM: process.env.TERM || 'xterm-256color',
      },
    })

    this.sessions.set(input.sessionId, { process: child, runtimeCwd: cwd })
    this.bindChildProcess(input.sessionId, child)
    this.emit({
      kind: 'started',
      sessionId: input.sessionId,
      processId: child.pid,
      timestamp: this.now(),
    })

    return {
      sessionId: input.sessionId,
      status: 'running',
      processId: child.pid,
    }
  }

  async write(input: TerminalWriteInput): Promise<void> {
    const session = this.sessions.get(input.sessionId)
    if (!session) {
      throw this.createUnavailableError(
        input.sessionId,
        'terminal.write',
        'Terminal shell session 不存在或已经退出',
        false,
      )
    }
    session.process.stdin.write(input.data)
  }

  async resize(_sessionId: string, _size: TerminalSize): Promise<void> {
    // child_process 不是 PTY，没有可用 resize 通道；接 node-pty 后再实现。
  }

  async terminate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.process.kill('SIGTERM')
  }

  onEvent(listener: TerminalExecutionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private bindChildProcess(sessionId: string, child: ChildProcessWithoutNullStreams): void {
    child.stdout.on('data', (chunk: Buffer) => {
      this.emit({
        kind: 'output',
        sessionId,
        data: chunk.toString('utf-8'),
        stream: 'stdout',
        timestamp: this.now(),
      })
    })
    child.stderr.on('data', (chunk: Buffer) => {
      this.emit({
        kind: 'output',
        sessionId,
        data: chunk.toString('utf-8'),
        stream: 'stderr',
        timestamp: this.now(),
      })
    })
    child.on('error', (error) => {
      this.emit({
        kind: 'error',
        sessionId,
        message: error.message,
        timestamp: this.now(),
      })
    })
    child.on('exit', (exitCode, signal) => {
      this.sessions.delete(sessionId)
      this.emit({
        kind: 'exit',
        sessionId,
        exitCode: exitCode ?? undefined,
        signal: signal ?? undefined,
        timestamp: this.now(),
      })
    })
  }

  private createUnavailableError(
    sessionId: string,
    operation: string,
    message: string,
    retryable = true,
  ): TerminalLocalShellError {
    const remoteError: RemoteError = {
      layer: 'execution-backend',
      code: REMOTE_ERROR_CODE.EXECUTION_BACKEND_UNAVAILABLE,
      message,
      retryable,
      context: {
        backend: this.backend,
        operation,
        sessionId,
      },
    }

    this.emit({
      kind: 'error',
      sessionId,
      message,
      remoteError,
      timestamp: this.now(),
    })

    return new TerminalLocalShellError(remoteError)
  }

  private emit(event: TerminalExecutionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function defaultSpawnShell(input: {
  shell: string
  cwd?: string
  env: NodeJS.ProcessEnv
}): ChildProcessWithoutNullStreams {
  return spawn(input.shell, [], {
    cwd: input.cwd,
    env: input.env,
    windowsHide: true,
  })
}

function getDefaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe'
  return process.env.SHELL || '/bin/zsh'
}

function normalizeCwd(cwd: string | undefined): string | undefined {
  if (!cwd || !existsSync(cwd)) return undefined
  return cwd
}
