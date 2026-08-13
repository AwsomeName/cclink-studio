import type { TerminalBackend } from '../../shared/terminal'
import type {
  TerminalExecutionAdapter,
  TerminalExecutionEventListener,
  TerminalSize,
  TerminalStartInput,
  TerminalStartResult,
  TerminalWriteInput,
} from './terminal-execution-adapter'

export interface CompositeTerminalExecutionAdapterOptions {
  local: TerminalExecutionAdapter
  remote?: TerminalExecutionAdapter
}

export class CompositeTerminalExecutionAdapter implements TerminalExecutionAdapter {
  readonly backend: TerminalBackend = 'custom'

  private readonly sessionAdapters = new Map<string, TerminalExecutionAdapter>()
  private readonly listeners = new Set<TerminalExecutionEventListener>()

  constructor(private readonly options: CompositeTerminalExecutionAdapterOptions) {
    this.bindAdapter(options.local)
    if (options.remote) this.bindAdapter(options.remote)
  }

  async start(input: TerminalStartInput): Promise<TerminalStartResult> {
    const adapter = this.resolveStartAdapter(input)
    const result = await adapter.start(input)
    this.sessionAdapters.set(input.sessionId, adapter)
    return result
  }

  async write(input: TerminalWriteInput): Promise<void> {
    await this.resolveSessionAdapter(input.sessionId).write(input)
  }

  async resize(sessionId: string, size: TerminalSize): Promise<void> {
    await this.resolveSessionAdapter(sessionId).resize(sessionId, size)
  }

  async terminate(sessionId: string): Promise<void> {
    await this.resolveSessionAdapter(sessionId).terminate(sessionId)
    this.sessionAdapters.delete(sessionId)
  }

  onEvent(listener: TerminalExecutionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private bindAdapter(adapter: TerminalExecutionAdapter): void {
    adapter.onEvent((event) => {
      for (const listener of this.listeners) listener(event)
      if (event.kind === 'exit' || event.kind === 'error') {
        this.sessionAdapters.delete(event.sessionId)
      }
    })
  }

  private resolveStartAdapter(input: TerminalStartInput): TerminalExecutionAdapter {
    if (input.runtime.location === 'remote') {
      if (!this.options.remote) throw new Error('远程 Terminal 执行后端未就绪')
      return this.options.remote
    }
    return this.options.local
  }

  private resolveSessionAdapter(sessionId: string): TerminalExecutionAdapter {
    const adapter = this.sessionAdapters.get(sessionId)
    if (!adapter) throw new Error('Terminal session 不存在或尚未启动')
    return adapter
  }
}
