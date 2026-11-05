import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  modelUsageRecordSchema,
  usageConfigSchema,
  usageRunSchema,
  type ModelUsageRecord,
  type UsageConfig,
  type UsageRun,
} from '../../shared/model-usage'
import {
  mergeUsage,
  sanitizeUsage,
  sanitizeModelUsage,
  withCoverage,
} from './model-usage-normalize'

/** One database per installation. WAL + transactions also serialize CLI/import processes. */
export class ModelUsageStore {
  private readonly db: DatabaseSync
  readonly originId: string

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS calls (
          id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, run_id TEXT, data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS calls_timestamp ON calls(timestamp);
        CREATE INDEX IF NOT EXISTS calls_run ON calls(run_id);
        CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      `)
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?, ?)').run('originId', randomUUID())
      this.originId = String(
        this.db.prepare('SELECT value FROM meta WHERE key=?').get('originId')!.value,
      )
      chmodSync(path, 0o600)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  config(): UsageConfig {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get('config')
    return usageConfigSchema.parse(row ? JSON.parse(String(row.value)) : {})
  }

  configure(update: (current: UsageConfig) => UsageConfig): UsageConfig {
    return this.transaction(() => {
      const config = usageConfigSchema.parse(update(this.config()))
      this.db
        .prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)')
        .run('config', JSON.stringify(config))
      return config
    })
  }

  put(input: ModelUsageRecord): boolean {
    return this.transaction(() => {
      const next = modelUsageRecordSchema.parse(input)
      next.rawUsage = sanitizeUsage(next.rawUsage)
      const row = this.db.prepare('SELECT data FROM calls WHERE id=?').get(next.id)
      const previous = row ? modelUsageRecordSchema.parse(JSON.parse(String(row.data))) : null
      let merged = next
      if (previous) {
        // Live metadata is richer; transcript replay must not erase it or its origin identity.
        const preferNext =
          next.sources.includes('claude-sdk') || !previous.sources.includes('claude-sdk')
        const preferred = preferNext ? next : previous
        const fallback = preferNext ? previous : next
        merged = {
          ...preferred,
          originId: previous.originId,
          timestamp: previous.timestamp < next.timestamp ? previous.timestamp : next.timestamp,
          rawUsage: mergeUsage(previous.rawUsage, next.rawUsage),
          final: previous.final || next.final,
          sources: [...new Set([...previous.sources, ...next.sources])],
        }
        const rank = { unverified: 0, 'transcript-final': 1, 'stream-delta': 2 }
        const evidence =
          rank[next.outputEvidence] > rank[previous.outputEvidence] ||
          (rank[next.outputEvidence] === rank[previous.outputEvidence] &&
            !(previous.final && !next.final))
            ? next
            : previous
        merged.outputEvidence = evidence.outputEvidence
        const thinking =
          rank[next.thinkingEvidence] >= rank[previous.thinkingEvidence] &&
          !(previous.final && !next.final)
            ? next
            : previous
        merged.thinkingEvidence = thinking.thinkingEvidence
        if (thinking.thinkingEvidence !== 'unverified') {
          for (const key of ['thinking_tokens', 'output_tokens_details']) {
            if (thinking.rawUsage[key] !== undefined) merged.rawUsage[key] = thinking.rawUsage[key]
          }
        }
        if (
          evidence.outputEvidence !== 'unverified' &&
          typeof evidence.rawUsage.output_tokens === 'number'
        ) {
          merged.rawUsage.output_tokens = evidence.rawUsage.output_tokens
        }
        for (const key of [
          'provider',
          'model',
          'workspace',
          'instanceId',
          'runId',
          'sessionId',
          'taskId',
          'conversationId',
          'parentToolUseId',
          'messageId',
          'requestId',
          'retryOrdinal',
          'durationMs',
        ] as const) {
          // Assignment through a bounded field list, never arbitrary imported keys.
          Object.assign(merged, { [key]: preferred[key] ?? fallback[key] })
        }
        if (previous.final && !next.final) merged.status = previous.status
        // A resumed replay must not move the same response into a different Run.
        for (const key of ['runId', 'taskId', 'instanceId', 'conversationId'] as const) {
          merged[key] = previous[key] ?? next[key]
        }
        if (merged.category === 'unclassified') merged.category = fallback.category
      }
      merged = withCoverage(merged)
      this.db
        .prepare('INSERT OR REPLACE INTO calls VALUES (?, ?, ?, ?)')
        .run(merged.id, merged.timestamp, merged.runId, JSON.stringify(merged))
      return !previous
    })
  }

  putRun(input: UsageRun): void {
    const next = usageRunSchema.parse(input)
    next.rawUsage = sanitizeUsage(next.rawUsage)
    next.rawModelUsage = sanitizeModelUsage(next.rawModelUsage)
    this.transaction(() => {
      const row = this.db.prepare('SELECT data FROM runs WHERE id=?').get(next.id)
      const old = row ? usageRunSchema.parse(JSON.parse(String(row.data))) : null
      const value =
        old?.endedAt && !next.endedAt ? old : { ...next, originId: old?.originId ?? next.originId }
      this.db
        .prepare('INSERT OR REPLACE INTO runs VALUES (?, ?)')
        .run(value.id, JSON.stringify(value))
    })
  }

  calls(from?: string, to?: string): ModelUsageRecord[] {
    const rows = this.db
      .prepare('SELECT data FROM calls WHERE timestamp>=? AND timestamp<? ORDER BY timestamp,id')
      .all(from ?? '', to ?? '9999')
    return rows.map((row) =>
      withCoverage(modelUsageRecordSchema.parse(JSON.parse(String(row.data)))),
    )
  }
  runs(): UsageRun[] {
    return this.db
      .prepare('SELECT data FROM runs ORDER BY id')
      .all()
      .map((row) => usageRunSchema.parse(JSON.parse(String(row.data))))
  }
  close(): void {
    this.db.close()
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
