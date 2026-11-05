import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker, type WorkerOptions } from 'node:worker_threads'
import type {
  ModelUsageObserver,
  ModelUsageContext,
  UsageSnapshot,
  UsageQuery,
  ModelUsageRecord,
  UsageCategory,
} from '../../shared/model-usage'
import { object, sanitizeUsage, sanitizeModelUsage, string, number } from './model-usage-normalize'
import type { UsageWorkerCommand } from './model-usage-worker-contract'
import type { ImportResult } from './model-usage-import'

/** Lifecycle owner stays in the main process; disk I/O and aggregation run in one bounded worker. */
export class ModelUsageService {
  private worker: Worker | null = null
  private sequence = 0
  private closed = false
  private failureState: { timestamp: string; code: string } | null = null
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  constructor(
    private readonly directory: string,
    private readonly workerFactory: (options: WorkerOptions) => Worker = (options) =>
      new Worker(join(__dirname, 'model-usage-worker.js'), options),
  ) {}
  initialize(): Promise<void> {
    return this.request({ type: 'initialize' })
  }
  private ensureWorker() {
    if (this.closed) throw new Error('USAGE_CLOSED')
    if (this.worker) return this.worker
    const worker = this.workerFactory({
      workerData: {
        directory: this.directory,
        instanceId: randomUUID(),
        environmentDisabled: process.env.CCLINK_MODEL_USAGE_ENABLED === '0',
      },
    })
    this.worker = worker
    worker.on(
      'message',
      (message: { id?: number; value?: unknown; error?: string; warning?: string }) => {
        if (message.warning) {
          this.failure(message.warning)
          return
        }
        const item = this.pending.get(message.id!)
        if (!item) return
        this.pending.delete(message.id!)
        clearTimeout(item.timer)
        if (message.error) {
          this.failure(message.error)
          item.reject(Object.assign(new Error(message.error), { code: message.error }))
        } else item.resolve(message.value)
      },
    )
    const unavailable = () => {
      if (this.worker !== worker) return
      this.worker = null
      if (!this.closed) this.failure('USAGE_WORKER_UNAVAILABLE')
      for (const item of this.pending.values()) {
        clearTimeout(item.timer)
        item.reject(new Error('USAGE_WORKER_UNAVAILABLE'))
      }
      this.pending.clear()
    }
    worker.on('error', unavailable)
    worker.on('exit', unavailable)
    return worker
  }
  private request<T>(command: UsageWorkerCommand): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      try {
        if (this.pending.size >= 1024)
          throw Object.assign(new Error('USAGE_QUEUE_FULL'), { code: 'USAGE_QUEUE_FULL' })
        const worker = this.ensureWorker()
        const id = ++this.sequence
        const timer = setTimeout(() => {
          this.failure('USAGE_WORKER_TIMEOUT')
          // Termination bounds queued work and prevents a late mutation after a timeout response.
          void worker.terminate()
        }, 120_000)
        this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
        worker.postMessage({ id, command, at: new Date().toISOString() })
      } catch (error) {
        this.failure('USAGE_RECORD_FAILED')
        reject(error)
      }
    })
  }
  start(context: ModelUsageContext): ModelUsageObserver | undefined {
    if (this.closed || process.env.CCLINK_MODEL_USAGE_ENABLED === '0') return undefined
    const runId = context.runId ?? randomUUID()
    const submit = (command: UsageWorkerCommand) => {
      void this.request(command).catch(() => undefined)
    }
    submit({ type: 'start', context: { ...context, runId } })
    let finished = false
    return {
      observe: (event) => {
        if (finished) return
        const sanitized = usageEvent(event)
        if (sanitized) submit({ type: 'observe', runId, event: sanitized })
      },
      finish: (status) => {
        if (finished) return
        finished = true
        submit({ type: 'finish', runId, status })
      },
    }
  }
  async snapshot(query: UsageQuery): Promise<UsageSnapshot> {
    const value = await this.request<UsageSnapshot>({ type: 'snapshot', query })
    if (
      this.failureState &&
      (!value.lastError || value.lastError.timestamp < this.failureState.timestamp)
    )
      value.lastError = this.failureState
    if (this.failureState)
      value.periods.push({
        id: 'main-process-recording-gap',
        originId: value.originId,
        from: this.failureState.timestamp,
        to: new Date(Date.parse(this.failureState.timestamp) + 1).toISOString(),
        state: 'degraded',
      })
    return value
  }
  calls(query: UsageQuery, offset: number, excludeDevelopment: boolean) {
    return this.request<{ total: number; records: ModelUsageRecord[] }>({
      type: 'calls',
      query,
      offset,
      excludeDevelopment,
    })
  }
  setEnabled(enabled: boolean) {
    return this.request<void>({ type: 'setEnabled', enabled })
  }
  classify(target: { kind: 'run' | 'session' | 'task'; id: string; category: UsageCategory }) {
    return this.request<void>({ type: 'classify', target })
  }
  backfill(root?: string) {
    return this.request<ImportResult>({ type: 'backfill', root })
  }
  importFile(path: string) {
    return this.request<{ inserted: number; replayed: number }>({ type: 'import', path })
  }
  exportFile(path: string, format: 'csv' | 'json', query: UsageQuery, excludeDevelopment: boolean) {
    return this.request<{ path: string; calls: number }>({
      type: 'export',
      path,
      format,
      query,
      excludeDevelopment,
    })
  }
  async close() {
    if (this.closed) return
    if (this.worker) {
      const worker = this.worker
      const deadline = setTimeout(() => {
        this.failure('USAGE_SHUTDOWN_TIMEOUT')
        void worker.terminate()
      }, 5000)
      try {
        await this.request({ type: 'close' })
      } catch {
        /* diagnostic already recorded */
      } finally {
        clearTimeout(deadline)
      }
      this.closed = true
      await worker.terminate()
    }
    this.closed = true
  }
  private failure(code: string) {
    this.failureState = { timestamp: new Date().toISOString(), code }
    console.warn('[ModelUsage] 统计异常；原任务继续。请查看设置 → 模型用量', this.failureState)
    void mkdir(this.directory, { recursive: true, mode: 0o700 })
      .then(() =>
        writeFile(join(this.directory, 'last-error.json'), JSON.stringify(this.failureState), {
          mode: 0o600,
        }),
      )
      .catch(() => undefined)
  }
}

/** Strip bodies before queueing, including content deltas and tool input. */
export function usageEvent(value: unknown): unknown | null {
  const event = object(value)
  const base = {
    type: event.type,
    session_id: string(event.session_id),
    parent_tool_use_id: string(event.parent_tool_use_id),
  }
  const message = (value: unknown) => {
    const row = object(value)
    return {
      id: string(row.id),
      model: string(row.model),
      stop_reason: string(row.stop_reason),
      usage: sanitizeUsage(row.usage),
    }
  }
  if (event.type === 'stream_event') {
    const stream = object(event.event)
    if (!['message_start', 'message_delta', 'message_stop', 'error'].includes(String(stream.type)))
      return null
    return {
      ...base,
      event: {
        type: stream.type,
        message: message(stream.message),
        usage: sanitizeUsage(stream.usage),
      },
    }
  }
  if (event.type === 'assistant')
    return {
      ...base,
      uuid: string(event.uuid),
      request_id: string(event.request_id) ?? string(event.requestId),
      message: message(event.message),
      isApiErrorMessage: event.isApiErrorMessage === true,
      error: Boolean(event.error),
    }
  if (event.type === 'system' && event.subtype === 'api_retry')
    return {
      ...base,
      subtype: 'api_retry',
      uuid: string(event.uuid),
      attempt: number(event.attempt),
    }
  if (event.type === 'result')
    return {
      ...base,
      usage: sanitizeUsage(event.usage),
      modelUsage: sanitizeModelUsage(event.modelUsage),
      total_cost_usd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null,
      is_error: event.is_error === true,
      origin: { kind: string(object(event.origin).kind) },
    }
  return null
}
