import { existsSync } from 'node:fs'
import type { IPty, IPtyForkOptions } from 'node-pty'
import * as pty from 'node-pty'
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

interface PtySession {
  process: PtyProcess
  runtimeCwd?: string
  exited: boolean
  exitPromise: Promise<void>
  resolveExit: () => void
}

interface PtyProcess {
  pid: number
  write(data: string): void
  resize(columns: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

export interface PtySpawnInput {
  shell: string
  args?: string[]
  cwd?: string
  env: NodeJS.ProcessEnv
  columns: number
  rows: number
}

export interface PtyExecutionAdapterOptions {
  now?: () => number
  spawnPty?: (input: PtySpawnInput) => PtyProcess
  wait?: (ms: number) => Promise<void>
  terminateGraceMs?: number
  terminateForceGraceMs?: number
}

export class TerminalPtyError extends Error {
  readonly remoteError: RemoteError

  constructor(remoteError: RemoteError) {
    super(remoteError.message)
    this.name = 'TerminalPtyError'
    this.remoteError = remoteError
  }
}

export class PtyExecutionAdapter implements TerminalExecutionAdapter {
  readonly backend: TerminalBackend = 'local-shell'

  private readonly sessions = new Map<string, PtySession>()
  private readonly listeners = new Set<TerminalExecutionEventListener>()
  private readonly now: () => number
  private readonly spawnPty: NonNullable<PtyExecutionAdapterOptions['spawnPty']>
  private readonly wait: NonNullable<PtyExecutionAdapterOptions['wait']>
  private readonly terminateGraceMs: number
  private readonly terminateForceGraceMs: number

  constructor(options: PtyExecutionAdapterOptions = {}) {
    this.now = options.now ?? Date.now
    this.spawnPty = options.spawnPty ?? defaultSpawnPty
    this.wait = options.wait ?? delay
    this.terminateGraceMs = options.terminateGraceMs ?? 800
    this.terminateForceGraceMs = options.terminateForceGraceMs ?? 400
  }

  async start(input: TerminalStartInput): Promise<TerminalStartResult> {
    if (input.runtime.location !== 'local') {
      throw this.createUnavailableError(
        input.sessionId,
        'terminal.startPty',
        '本地 PTY 只支持本机 Terminal；远程 PTY 需要远端执行通道接入',
      )
    }

    const existing = this.sessions.get(input.sessionId)
    if (existing) {
      return {
        sessionId: input.sessionId,
        status: 'running',
        processId: existing.process.pid,
      }
    }

    const cwd = normalizeCwd(input.runtime.cwd)
    const size = normalizeTerminalSize(input.size)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...input.env,
      TERM: process.env.TERM || 'xterm-256color',
      COLORTERM: process.env.COLORTERM || 'truecolor',
      DEEPINK_TERMINAL_SESSION_ID: input.sessionId,
      DEEPINK_TERMINAL_PARENT_PID: String(process.pid),
      DEEPINK_TERMINAL_RUNTIME: input.runtime.location,
    }
    if (cwd) env.DEEPINK_TERMINAL_CWD = cwd
    const launch = createPtyLaunch(input.runtime.shell || getDefaultShell(), input.sessionId)
    const child = this.spawnPty({
      shell: launch.shell,
      args: launch.args,
      cwd,
      env,
      columns: size.columns,
      rows: size.rows,
    })

    let resolveExit = (): void => undefined
    const exitPromise = new Promise<void>((resolve) => {
      resolveExit = resolve
    })
    const session: PtySession = {
      process: child,
      runtimeCwd: cwd,
      exited: false,
      exitPromise,
      resolveExit,
    }
    this.sessions.set(input.sessionId, session)
    this.bindPtyProcess(input.sessionId, session)
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
        'terminal.writePty',
        'Terminal PTY session 不存在或已经退出',
        false,
      )
    }
    session.process.write(input.data)
  }

  async resize(sessionId: string, size: TerminalSize): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const normalized = normalizeTerminalSize(size)
    session.process.resize(normalized.columns, normalized.rows)
  }

  async terminate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.process.kill(getGracefulSignal())
    await this.waitForExit(session, this.terminateGraceMs)
    if (session.exited || !this.sessions.has(sessionId)) return

    session.process.kill(getForceSignal())
    await this.waitForExit(session, this.terminateForceGraceMs)
    if (!session.exited) this.sessions.delete(sessionId)
  }

  onEvent(listener: TerminalExecutionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  destroy(): void {
    for (const sessionId of this.sessions.keys()) {
      void this.terminate(sessionId)
    }
    this.sessions.clear()
    this.listeners.clear()
  }

  private bindPtyProcess(sessionId: string, session: PtySession): void {
    session.process.onData((data) => {
      this.emit({
        kind: 'output',
        sessionId,
        data,
        stream: 'stdout',
        timestamp: this.now(),
      })
    })
    session.process.onExit((event) => {
      session.exited = true
      session.resolveExit()
      this.sessions.delete(sessionId)
      this.emit({
        kind: 'exit',
        sessionId,
        exitCode: event.exitCode,
        signal: event.signal ? String(event.signal) : undefined,
        timestamp: this.now(),
      })
    })
  }

  private async waitForExit(session: PtySession, timeoutMs: number): Promise<void> {
    if (session.exited) return
    if (timeoutMs <= 0) return
    await Promise.race([session.exitPromise, this.wait(timeoutMs)])
  }

  private createUnavailableError(
    sessionId: string,
    operation: string,
    message: string,
    retryable = true,
  ): TerminalPtyError {
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

    return new TerminalPtyError(remoteError)
  }

  private emit(event: TerminalExecutionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function getGracefulSignal(): string | undefined {
  if (process.platform === 'win32') return undefined
  return 'SIGHUP'
}

function getForceSignal(): string | undefined {
  if (process.platform === 'win32') return undefined
  return 'SIGKILL'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultSpawnPty(input: PtySpawnInput): IPty {
  const options: IPtyForkOptions = {
    name: 'xterm-256color',
    cols: input.columns,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env,
  }
  return pty.spawn(input.shell, input.args ?? [], options)
}

function createPtyLaunch(shell: string, sessionId: string): { shell: string; args?: string[] } {
  if (process.platform === 'win32') return { shell }
  return {
    shell: '/bin/sh',
    args: [
      '-lc',
      `DEEPINK_TERMINAL_SESSION_ID=${shellQuote(sessionId)} ${shellQuote(shell)} -i`,
    ],
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function getDefaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe'
  return process.env.SHELL || '/bin/zsh'
}

function normalizeCwd(cwd: string | undefined): string | undefined {
  if (!cwd || !existsSync(cwd)) return undefined
  return cwd
}

function normalizeTerminalSize(size: TerminalSize | undefined): TerminalSize {
  return {
    columns: clampInteger(size?.columns, 2, 500, 80),
    rows: clampInteger(size?.rows, 2, 200, 24),
  }
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}
