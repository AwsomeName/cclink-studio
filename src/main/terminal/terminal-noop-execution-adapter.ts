import type { TerminalBackend, TerminalExecutionErrorInfo, TerminalExecutionEvent } from '../../shared/terminal'
import type {
  TerminalExecutionAdapter,
  TerminalExecutionEventListener,
  TerminalSize,
  TerminalStartInput,
  TerminalStartResult,
  TerminalWriteInput,
} from './terminal-execution-adapter'

export class TerminalExecutionAdapterUnavailableError extends Error {
  readonly executionError: TerminalExecutionErrorInfo

  constructor(executionError: TerminalExecutionErrorInfo) {
    super(executionError.message)
    this.name = 'TerminalExecutionAdapterUnavailableError'
    this.executionError = executionError
  }
}

export interface NoopTerminalExecutionAdapterOptions {
  backend?: TerminalBackend
  now?: () => number
}

export class NoopTerminalExecutionAdapter implements TerminalExecutionAdapter {
  readonly backend: TerminalBackend

  private readonly listeners = new Set<TerminalExecutionEventListener>()
  private readonly now: () => number

  constructor(options: NoopTerminalExecutionAdapterOptions = {}) {
    this.backend = options.backend ?? 'custom'
    this.now = options.now ?? Date.now
  }

  async start(input: TerminalStartInput): Promise<TerminalStartResult> {
    throw this.createUnavailableError(input.sessionId, 'terminal.start')
  }

  async write(input: TerminalWriteInput): Promise<void> {
    throw this.createUnavailableError(input.sessionId, 'terminal.write')
  }

  async resize(sessionId: string, _size: TerminalSize): Promise<void> {
    throw this.createUnavailableError(sessionId, 'terminal.resize')
  }

  async terminate(sessionId: string): Promise<void> {
    throw this.createUnavailableError(sessionId, 'terminal.terminate')
  }

  onEvent(listener: TerminalExecutionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private createUnavailableError(sessionId: string, operation: string): TerminalExecutionAdapterUnavailableError {
    const executionError: TerminalExecutionErrorInfo = {
      layer: 'execution-backend',
      code: 'EXECUTION_BACKEND_UNAVAILABLE',
      message: 'Terminal 执行适配器尚未接入真实 shell',
      retryable: false,
      context: {
        backend: this.backend,
        operation,
        sessionId,
      },
    }

    this.emit({
      kind: 'error',
      sessionId,
      message: executionError.message,
      executionError,
      timestamp: this.now(),
    })

    return new TerminalExecutionAdapterUnavailableError(executionError)
  }

  private emit(event: TerminalExecutionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
