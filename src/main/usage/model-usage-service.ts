import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ModelUsageStore } from './model-usage-store'
import { ModelUsageCollector, type ModelUsageContext } from './model-usage-collector'
import { importTranscripts } from './model-usage-import'
import type { ModelUsageObserver } from '../../shared/model-usage'

/** Optional projection owned by UsageLedgerService. Errors never propagate to Agent execution. */
export class ModelUsageService {
  private store: ModelUsageStore | null = null
  private readonly instanceId = randomUUID()
  private pending: Promise<void> = Promise.resolve()
  private failures = 0
  constructor(private readonly directory: string) {}

  start(context: ModelUsageContext): ModelUsageObserver | undefined {
    try {
      if (process.env.CCLINK_MODEL_USAGE_ENABLED === '0') return undefined
      this.store ??= new ModelUsageStore(join(this.directory, 'usage.sqlite'))
      const config = this.store.config()
      if (!config.enabled) return undefined
      const startedAt = new Date().toISOString()
      const runContext = {
        ...context,
        instanceId: this.instanceId,
        runId: context.runId ?? randomUUID(),
        category:
          context.category ??
          (context.taskId ? config.taskCategories[context.taskId] : undefined) ??
          (context.sessionId ? config.sessionCategories[context.sessionId] : undefined) ??
          ('unclassified' as const),
      }
      const collector = new ModelUsageCollector(this.store, runContext)
      let sessionId = context.sessionId
      let finished = false
      const safely = (fn: () => void): void => {
        try {
          fn()
        } catch (error) {
          this.failure(error)
        }
      }
      return {
        observe: (event) =>
          safely(() => {
            const id =
              event && typeof event === 'object'
                ? (event as { session_id?: unknown }).session_id
                : null
            if (typeof id === 'string') sessionId = id
            collector.observe(event)
          }),
        finish: (status) => {
          if (finished) return
          finished = true
          safely(() => collector.finish(status))
          // Catch subagent transcripts omitted by the live stream, bounded to this run's lifetime.
          if (context.transcriptRoot && sessionId && this.store) {
            const root = context.transcriptRoot
            const session = sessionId
            const endedAt = new Date().toISOString()
            const store = this.store
            this.pending = this.pending
              .then(async () => {
                const result = await importTranscripts(store, [root], runContext, {
                  sessionId: session,
                  after: startedAt,
                  before: endedAt,
                })
                if (result.invalidLines || result.unidentifiable || result.pendingLines)
                  this.failure(new Error('TRANSCRIPT_INCOMPLETE'))
              })
              .catch((error) => {
                this.failure(error)
              })
          }
        },
      }
    } catch (error) {
      this.failure(error)
      return undefined
    }
  }

  async close(): Promise<void> {
    await this.pending
    try {
      this.store?.close()
    } catch (error) {
      this.failure(error)
    }
    this.store = null
  }
  private failure(error: unknown): void {
    this.failures++
    // Error messages may include paths or provider payloads; record only a bounded error code.
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'USAGE_RECORD_FAILED'
    const safeCode = /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'USAGE_RECORD_FAILED'
    console.warn('[ModelUsage] 统计记录失败；原任务继续。请运行 pnpm usage status', {
      code: safeCode,
      failures: this.failures,
    })
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 })
      writeFileSync(
        join(this.directory, 'last-error.json'),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          code: safeCode,
          failuresThisInstance: this.failures,
        }),
        { mode: 0o600 },
      )
    } catch {
      /* console warning remains available when the disk itself is unavailable */
    }
  }
}
