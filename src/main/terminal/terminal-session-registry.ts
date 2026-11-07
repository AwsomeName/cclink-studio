import type {
  TerminalRuntimeRef,
  TerminalStatus,
  TerminalCodeBlockSource,
} from '../../shared/terminal'
import {
  createTerminalSessionState,
  transitionTerminalSessionState,
  type TerminalSessionState,
  type TerminalSessionStatePatch,
} from './terminal-session-state'

export interface RegisterTerminalSessionInput {
  codeBlockSource?: TerminalCodeBlockSource
  sessionId: string
  runtime: TerminalRuntimeRef
  now?: number
}

export class TerminalSessionRegistry {
  private readonly sessions = new Map<string, TerminalSessionState>()

  register(input: RegisterTerminalSessionInput): TerminalSessionState {
    if (this.sessions.has(input.sessionId)) {
      throw new Error(`Terminal session 已存在：${input.sessionId}`)
    }

    const session = createTerminalSessionState(input)
    this.sessions.set(session.sessionId, session)
    return session
  }

  get(sessionId: string): TerminalSessionState | null {
    return this.sessions.get(sessionId) ?? null
  }

  list(): TerminalSessionState[] {
    return [...this.sessions.values()]
  }

  transition(
    sessionId: string,
    nextStatus: TerminalStatus,
    patch: TerminalSessionStatePatch = {},
  ): TerminalSessionState {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Terminal session 不存在：${sessionId}`)
    }

    const nextSession = transitionTerminalSessionState(session, nextStatus, patch)
    this.sessions.set(sessionId, nextSession)
    return nextSession
  }

  remove(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
  }

  clear(): void {
    this.sessions.clear()
  }
}
