import type {
  TerminalBackend,
  TerminalCommandActor,
  TerminalExecutionEvent,
  TerminalRuntimeRef,
  TerminalStatus,
} from '../../shared/terminal'

export interface TerminalSize {
  columns: number
  rows: number
}

export interface TerminalStartInput {
  sessionId: string
  runtime: TerminalRuntimeRef
  size?: TerminalSize
  env?: Record<string, string>
  resume?: { processId?: string | number }
  /** 消息命令必须使用原目录；目录失效时让 PTY 启动失败，禁止回退。 */
  requireCwd?: boolean
}

export interface TerminalWriteInput {
  sessionId: string
  data: string
  actor: TerminalCommandActor
}

export interface TerminalStartResult {
  sessionId: string
  status: Extract<TerminalStatus, 'running' | 'blocked'>
  processId?: string | number
}

export type TerminalExecutionEventListener = (event: TerminalExecutionEvent) => void

export interface TerminalExecutionAdapter {
  readonly backend: TerminalBackend
  start(input: TerminalStartInput): Promise<TerminalStartResult>
  write(input: TerminalWriteInput): Promise<void>
  resize(sessionId: string, size: TerminalSize): Promise<void>
  terminate(sessionId: string): Promise<void>
  onEvent(listener: TerminalExecutionEventListener): () => void
}
