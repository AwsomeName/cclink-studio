import { randomUUID } from 'node:crypto'
import type { ModelUsageRecord, ModelUsageContext, UsageRun } from '../../shared/model-usage'
import type { ModelUsageStore } from './model-usage-store'
import {
  mergeUsage,
  normalizeUsage,
  number,
  object,
  sanitizeUsage,
  sanitizeModelUsage,
  string,
  usageId,
  withCoverage,
} from './model-usage-normalize'

export type { ModelUsageContext } from '../../shared/model-usage'

export function createCall(
  context: ModelUsageContext,
  originId: string,
  sessionId: string | null,
  messageId: string,
  timestamp: string,
  source: 'claude-sdk' | 'claude-transcript',
): ModelUsageRecord {
  return withCoverage({
    version: 1,
    id: usageId('anthropic-messages', sessionId ?? context.runId ?? originId, messageId),
    originId,
    timestamp,
    provider: context.provider ?? null,
    model: null,
    workspace: context.workspace ?? null,
    instanceId: context.instanceId ?? null,
    runId: context.runId ?? null,
    sessionId,
    taskId: context.taskId ?? null,
    conversationId: context.conversationId ?? null,
    parentToolUseId: null,
    messageId,
    requestId: null,
    retryOrdinal: null,
    category: context.category ?? 'unclassified',
    status: 'unknown',
    durationMs: null,
    timingBasis: 'unavailable',
    sources: [source],
    estimated: false,
    protocol: 'anthropic-messages',
    rawUsage: {},
    normalized: normalizeUsage({}),
    final: false,
    outputEvidence: 'unverified',
    thinkingEvidence: 'unverified',
    coverage: 'none',
    missing: [],
    missingMetadata: [],
  })
}

/** Observes only SDK messages. Run totals are an audit record, never billable child calls. */
export class ModelUsageCollector {
  private readonly calls = new Map<string, ModelUsageRecord>()
  private readonly active = new Map<string, string>()
  private readonly starts = new Map<string, number>()
  private readonly retries = new Map<string, number>()
  private readonly seenRetries = new Set<string>()
  private readonly run: UsageRun
  private sessionId: string | null
  private ended = false

  constructor(
    private readonly store: ModelUsageStore,
    private readonly context: ModelUsageContext,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.sessionId = context.sessionId ?? null
    this.run = {
      id: context.runId ?? randomUUID(),
      originId: store.originId,
      instanceId: context.instanceId ?? null,
      workspace: context.workspace ?? null,
      conversationId: context.conversationId ?? null,
      sessionId: this.sessionId,
      taskId: context.taskId ?? null,
      category: context.category ?? 'unclassified',
      startedAt: now().toISOString(),
      endedAt: null,
      status: 'in-progress',
      rawUsage: {},
      sdkEstimatedUsd: null,
      rawModelUsage: {},
    }
    this.store.putRun(this.run)
  }

  observe(value: unknown): void {
    const event = object(value)
    const sessionId = string(event.session_id)
    if (sessionId) this.sessionId = sessionId
    const lane = string(event.parent_tool_use_id) ?? 'main'
    if (event.type === 'system' && event.subtype === 'api_retry') {
      const retryId =
        string(event.uuid) ?? `${this.run.id}:${lane}:${event.attempt}:${this.calls.size}`
      if (this.seenRetries.has(retryId)) return
      this.seenRetries.add(retryId)
      const attempt = number(event.attempt)
      const activeId = this.active.get(lane)
      const record = activeId ? this.calls.get(activeId) : undefined
      if (record && record.status === 'in-progress') {
        this.complete(record, 'failed', false)
      } else {
        const failed = this.newCall(`retry:${retryId}`, lane)
        failed.messageId = null
        failed.retryOrdinal = attempt === null ? null : Math.max(0, attempt - 1)
        failed.status = 'failed'
        this.save(failed)
      }
      this.active.delete(lane)
      if (attempt !== null) this.retries.set(lane, attempt)
      return
    }
    if (event.type === 'stream_event') {
      const stream = object(event.event)
      if (stream.type === 'message_start') {
        const message = object(stream.message)
        const id = string(message.id)
        if (!id) return
        const record = this.newCall(id, lane)
        record.model = string(message.model)
        record.rawUsage = mergeUsage(record.rawUsage, sanitizeUsage(message.usage))
        record.status = 'in-progress'
        this.active.set(lane, record.id)
        this.starts.set(record.id, this.now().getTime())
        this.save(record)
      } else {
        const id = this.active.get(lane)
        const record = id ? this.calls.get(id) : undefined
        if (!record) return
        if (stream.type === 'message_delta') {
          record.rawUsage = mergeUsage(record.rawUsage, sanitizeUsage(stream.usage))
          const output = number(object(stream.usage).output_tokens)
          if (output !== null) {
            record.rawUsage.output_tokens = output
            record.outputEvidence = 'stream-delta'
          }
          if (normalizeUsage(sanitizeUsage(stream.usage)).thinking !== null) {
            record.thinkingEvidence = 'stream-delta'
          }
          this.save(record)
        } else if (stream.type === 'message_stop') {
          this.complete(record, 'succeeded', true)
          this.active.delete(lane)
          this.retries.delete(lane)
        } else if (stream.type === 'error') this.complete(record, 'failed', false)
      }
      return
    }
    if (event.type === 'assistant') {
      const message = object(event.message)
      // SDK synthetic error responses contain fabricated zero usage. Record the error, not those zeros.
      const synthetic = message.model === '<synthetic>' || event.isApiErrorMessage === true
      const id = string(message.id) ?? string(event.uuid)
      if (!id) return
      const record = this.newCall(id, lane)
      record.requestId = string(event.request_id) ?? string(event.requestId)
      record.model = synthetic ? null : string(message.model)
      if (!synthetic) {
        const raw = sanitizeUsage(message.usage)
        if (record.outputEvidence !== 'unverified') {
          delete raw.output_tokens
          delete raw.output_tokens_details
          delete raw.thinking_tokens
        }
        record.rawUsage = mergeUsage(record.rawUsage, raw)
      }
      record.status =
        event.error || synthetic
          ? 'failed'
          : typeof message.stop_reason === 'string' || record.final
            ? 'succeeded'
            : 'in-progress'
      this.complete(record, record.status, record.final)
      this.retries.delete(lane)
      return
    }
    if (event.type === 'result') {
      // Background notification totals do not own this run and may overlap its child calls.
      if (object(event.origin).kind === 'task-notification') return
      this.run.rawUsage = sanitizeUsage(event.usage)
      this.run.rawModelUsage = sanitizeModelUsage(event.modelUsage)
      this.run.sdkEstimatedUsd =
        typeof event.total_cost_usd === 'number' &&
        Number.isFinite(event.total_cost_usd) &&
        event.total_cost_usd >= 0
          ? event.total_cost_usd
          : null
      this.finish(event.is_error === true ? 'failed' : 'succeeded')
    }
  }

  finish(status: 'succeeded' | 'failed' | 'interrupted' | 'unknown'): void {
    if (this.ended) return
    this.ended = true
    for (const record of this.calls.values()) {
      if (record.status === 'in-progress')
        this.complete(record, status === 'succeeded' ? 'unknown' : status, false)
    }
    this.run.sessionId = this.sessionId
    this.run.endedAt = this.now().toISOString()
    this.run.status = status
    this.store.putRun(this.run)
  }

  private newCall(messageId: string, lane: string): ModelUsageRecord {
    const record = createCall(
      { ...this.context, runId: this.run.id },
      this.store.originId,
      this.sessionId,
      messageId,
      this.now().toISOString(),
      'claude-sdk',
    )
    const previous = this.calls.get(record.id)
    if (previous) return previous
    record.parentToolUseId = lane === 'main' ? null : lane
    record.retryOrdinal = this.retries.get(lane) ?? 0
    this.calls.set(record.id, record)
    return record
  }
  private complete(
    record: ModelUsageRecord,
    status: ModelUsageRecord['status'],
    final: boolean,
  ): void {
    record.status = status
    record.final = record.final || final
    const start = this.starts.get(record.id)
    if (start !== undefined) {
      record.durationMs = Math.max(0, this.now().getTime() - start)
      record.timingBasis = 'observed-stream'
    }
    this.save(record)
  }
  private save(record: ModelUsageRecord): void {
    this.store.put(record)
  }
}
