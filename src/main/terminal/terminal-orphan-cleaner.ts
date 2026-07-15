import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TerminalStatus } from '../../shared/terminal'
import type { TerminalSessionRecord, TerminalSessionStore } from './terminal-session-store'

const execFileAsync = promisify(execFile)

const LIVE_TERMINAL_STATUSES = new Set<TerminalStatus>(['starting', 'running', 'blocked'])

export interface TerminalOrphanCleanupSummary {
  scanned: number
  killed: number
  missing: number
  skipped: number
  failed: number
}

export interface TerminalOrphanCleanerOptions {
  now?: () => number
  isProcessAlive?: (pid: number) => boolean | Promise<boolean>
  isStudioTerminalProcess?: (pid: number, sessionId: string) => boolean | Promise<boolean>
  killProcess?: (pid: number, signal: NodeJS.Signals) => void
  wait?: (ms: number) => Promise<void>
  graceMs?: number
}

export async function cleanupTerminalOrphans(
  store: TerminalSessionStore,
  options: TerminalOrphanCleanerOptions = {},
): Promise<TerminalOrphanCleanupSummary> {
  const now = options.now ?? Date.now
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive
  const isStudioTerminalProcess = options.isStudioTerminalProcess ?? defaultIsStudioTerminalProcess
  const killProcess = options.killProcess ?? defaultKillProcess
  const wait = options.wait ?? delay
  const graceMs = options.graceMs ?? 500
  const summary: TerminalOrphanCleanupSummary = {
    scanned: 0,
    killed: 0,
    missing: 0,
    skipped: 0,
    failed: 0,
  }

  const sessions = await store.listSessions()
  for (const session of sessions.filter(isPossiblyLiveSession)) {
    summary.scanned += 1
    const pid = normalizePid(session.processId)
    if (!pid) {
      summary.missing += 1
      await markUnrecoverable(store, session.sessionId, now(), 'CCLink Studio 已重启，原 Terminal 进程不可恢复')
      continue
    }

    const alive = await isProcessAlive(pid)
    if (!alive) {
      summary.missing += 1
      await markUnrecoverable(store, session.sessionId, now(), 'CCLink Studio 已重启，原 Terminal 进程不可恢复')
      continue
    }

    const verified = await isStudioTerminalProcess(pid, session.sessionId)
    if (!verified) {
      summary.skipped += 1
      await markSkipped(
        store,
        session.sessionId,
        now(),
        '检测到旧 Terminal pid 仍存在，但无法确认归属，未自动清理',
      )
      continue
    }

    try {
      await terminateProcessGroup(pid, killProcess, isProcessAlive, wait, graceMs)
      summary.killed += 1
      await markUnrecoverable(
        store,
        session.sessionId,
        now(),
        'CCLink Studio 启动时已清理上次残留 Terminal 进程',
      )
    } catch (error) {
      summary.failed += 1
      await markSkipped(
        store,
        session.sessionId,
        now(),
        `清理上次残留 Terminal 进程失败：${(error as Error).message}`,
      )
    }
  }

  return summary
}

function isPossiblyLiveSession(session: TerminalSessionRecord): boolean {
  return Boolean(session.attachable || LIVE_TERMINAL_STATUSES.has(session.status))
}

function normalizePid(processId: string | number | undefined): number | null {
  if (typeof processId === 'number' && Number.isSafeInteger(processId) && processId > 0) return processId
  if (typeof processId !== 'string' || !/^\d+$/.test(processId.trim())) return null
  const pid = Number(processId)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

async function markUnrecoverable(
  store: TerminalSessionStore,
  sessionId: string,
  timestamp: number,
  message: string,
): Promise<void> {
  await store.patchSession({
    sessionId,
    status: 'exited',
    attachable: false,
    exitedAt: timestamp,
    errorMessage: message,
    now: timestamp,
  })
  await store.appendOutputLine(sessionId, {
    kind: 'system',
    text: `\n${message}\n`,
    timestamp,
  })
}

async function markSkipped(
  store: TerminalSessionStore,
  sessionId: string,
  timestamp: number,
  message: string,
): Promise<void> {
  await store.patchSession({
    sessionId,
    status: 'error',
    attachable: false,
    errorMessage: message,
    now: timestamp,
  })
  await store.appendOutputLine(sessionId, {
    kind: 'error',
    text: `\n${message}\n`,
    timestamp,
  })
}

async function terminateProcessGroup(
  pid: number,
  killProcess: NonNullable<TerminalOrphanCleanerOptions['killProcess']>,
  isProcessAlive: NonNullable<TerminalOrphanCleanerOptions['isProcessAlive']>,
  wait: NonNullable<TerminalOrphanCleanerOptions['wait']>,
  graceMs: number,
): Promise<void> {
  sendSignal(pid, 'SIGHUP', killProcess)
  await wait(graceMs)
  if (!(await isProcessAlive(pid))) return
  sendSignal(pid, 'SIGKILL', killProcess)
}

function sendSignal(
  pid: number,
  signal: NodeJS.Signals,
  killProcess: NonNullable<TerminalOrphanCleanerOptions['killProcess']>,
): void {
  if (process.platform === 'win32') {
    killProcess(pid, signal)
    return
  }
  try {
    killProcess(-pid, signal)
  } catch {
    killProcess(pid, signal)
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function defaultIsStudioTerminalProcess(pid: number, sessionId: string): Promise<boolean> {
  const command = await readProcessCommandWithEnv(pid)
  return (
    command.includes(`DEEPINK_TERMINAL_SESSION_ID=${sessionId}`) ||
    command.includes(`DEEPINK_TERMINAL_SESSION_ID='${sessionId}'`) ||
    command.includes(`DEEPINK_TERMINAL_SESSION_ID="${sessionId}"`)
  )
}

async function readProcessCommandWithEnv(pid: number): Promise<string> {
  const attempts = [
    ['eww', '-p', String(pid), '-o', 'command='],
    ['-eww', '-p', String(pid), '-o', 'command='],
  ]
  for (const args of attempts) {
    try {
      const { stdout } = await execFileAsync('ps', args, { timeout: 1000, maxBuffer: 1024 * 256 })
      if (stdout.trim()) return stdout
    } catch {
      // 不同平台的 ps 参数略有差异，继续尝试下一种。
    }
  }
  return ''
}

function defaultKillProcess(pid: number, signal: NodeJS.Signals): void {
  process.kill(pid, signal)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
