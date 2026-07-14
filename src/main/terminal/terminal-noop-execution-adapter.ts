import type { TerminalBackend, TerminalExecutionEvent } from '../../shared/terminal'
import { REMOTE_ERROR_CODE, type RemoteError } from '../../shared/remote-error'
import type {
  TerminalExecutionAdapter,
  TerminalExecutionEventListener,
  TerminalSize,
  TerminalStartInput,
  TerminalStartResult,
  TerminalWriteInput,
} from './terminal-execution-adapter'

export class TerminalExecutionAdapterUnavailableError extends Error {
  readonly remoteError: RemoteError

  constructor(remoteError: RemoteError) {
    super(remoteError.message)
    this.name = 'TerminalExecutionAdapterUnavailableError'
    this.remoteError = remoteError
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
    const remoteError: RemoteError = {
      layer: 'execution-backend',
      code: REMOTE_ERROR_CODE.EXECUTION_BACKEND_UNAVAILABLE,
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
      message: remoteError.message,
      remoteError,
      timestamp: this.now(),
    })

    return new TerminalExecutionAdapterUnavailableError(remoteError)
  }

  private emit(event: TerminalExecutionEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
