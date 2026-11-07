import type {
  TerminalRuntimeRef,
  TerminalStatus,
  TerminalCodeBlockSource,
} from '../../shared/terminal'

export interface TerminalSessionState {
  codeBlockSource?: TerminalCodeBlockSource
  sessionId: string
  runtime: TerminalRuntimeRef
  status: TerminalStatus
  createdAt: number
  updatedAt: number
  processId?: string | number
  exitCode?: number
  errorMessage?: string
  lastCommand?: string
}

export interface CreateTerminalSessionStateInput {
  codeBlockSource?: TerminalCodeBlockSource
  sessionId: string
  runtime: TerminalRuntimeRef
  now?: number
}

export interface TerminalSessionStatePatch {
  now?: number
  processId?: string | number
  exitCode?: number
  errorMessage?: string
  lastCommand?: string
}

export const TERMINAL_STATUS_TRANSITIONS = {
  idle: ['starting', 'blocked', 'error'],
  starting: ['running', 'blocked', 'exited', 'error'],
  running: ['blocked', 'exited', 'error'],
  blocked: ['idle', 'running', 'exited', 'error'],
  exited: [],
  error: [],
} as const satisfies Record<TerminalStatus, readonly TerminalStatus[]>

export function createTerminalSessionState(
  input: CreateTerminalSessionStateInput,
): TerminalSessionState {
  const timestamp = input.now ?? Date.now()
  return {
    codeBlockSource: input.codeBlockSource,
    sessionId: input.sessionId,
    runtime: input.runtime,
    status: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function canTransitionTerminalStatus(
  fromStatus: TerminalStatus,
  toStatus: TerminalStatus,
): boolean {
  if (fromStatus === toStatus) return true
  return TERMINAL_STATUS_TRANSITIONS[fromStatus].includes(toStatus as never)
}

export function assertTerminalStatusTransition(
  fromStatus: TerminalStatus,
  toStatus: TerminalStatus,
): void {
  if (!canTransitionTerminalStatus(fromStatus, toStatus)) {
    throw new Error(`非法 Terminal 状态迁移：${fromStatus} -> ${toStatus}`)
  }
}

export function transitionTerminalSessionState(
  session: TerminalSessionState,
  nextStatus: TerminalStatus,
  patch: TerminalSessionStatePatch = {},
): TerminalSessionState {
  assertTerminalStatusTransition(session.status, nextStatus)

  return {
    ...session,
    status: nextStatus,
    updatedAt: patch.now ?? Date.now(),
    processId: patch.processId ?? session.processId,
    exitCode: patch.exitCode ?? session.exitCode,
    errorMessage: patch.errorMessage ?? session.errorMessage,
    lastCommand: patch.lastCommand ?? session.lastCommand,
  }
}
