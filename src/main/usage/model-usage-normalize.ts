import { createHash } from 'node:crypto'
import {
  tokenFields,
  type ModelUsageRecord,
  type NormalizedUsage,
  type RawUsage,
} from '../../shared/model-usage'

const numericKeys = new Set([
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
  'thinking_tokens',
  'reasoning_tokens',
  'ephemeral_5m_input_tokens',
  'ephemeral_1h_input_tokens',
])
const objectKeys = new Set(['output_tokens_details', 'cache_creation'])

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
export function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : null
}
export function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
/** Whitelist extraction: never persist the event, content blocks, errors, or arbitrary usage keys. */
export function sanitizeUsage(value: unknown): RawUsage {
  const result: RawUsage = {}
  for (const [key, item] of Object.entries(object(value))) {
    if (numericKeys.has(key) && number(item) !== null) result[key] = item as number
    if (objectKeys.has(key)) result[key] = sanitizeUsage(item)
  }
  return result
}
export function mergeUsage(previous: RawUsage, next: RawUsage): RawUsage {
  const merged = { ...previous }
  for (const [key, value] of Object.entries(next)) {
    // Cumulative snapshots, never sum; a shorter replay must not lower the recorded final count.
    merged[key] =
      typeof value === 'number'
        ? Math.max(typeof merged[key] === 'number' ? (merged[key] as number) : 0, value)
        : mergeUsage(typeof merged[key] === 'object' ? (merged[key] as RawUsage) : {}, value)
  }
  return merged
}
export function normalizeUsage(raw: RawUsage): NormalizedUsage {
  const details = object(raw.output_tokens_details)
  return {
    input: number(raw.input_tokens),
    output: number(raw.output_tokens),
    cacheRead: number(raw.cache_read_input_tokens),
    cacheWrite: number(raw.cache_creation_input_tokens),
    thinking:
      number(details.thinking_tokens) ??
      number(details.reasoning_tokens) ??
      number(raw.thinking_tokens),
    inputIncludesCache: false,
    outputIncludesThinking: true,
  }
}
export function withCoverage(record: ModelUsageRecord): ModelUsageRecord {
  const normalized = normalizeUsage(record.rawUsage)
  // Assistant events can carry a message_start placeholder, even when the run succeeds.
  if (record.outputEvidence === 'unverified') {
    normalized.output = null
  }
  if (record.thinkingEvidence === 'unverified') normalized.thinking = null
  const missing: string[] = tokenFields.filter((key) => normalized[key] === null)
  if (!record.final) missing.push('final-usage')
  return {
    ...record,
    normalized,
    missingMetadata: [
      'provider',
      'model',
      'workspace',
      'instanceId',
      'runId',
      'sessionId',
      'taskId',
      'requestId',
      'retryOrdinal',
      'durationMs',
    ].filter((key) => record[key as keyof ModelUsageRecord] === null),
    missing,
    coverage: tokenFields.every((key) => normalized[key] === null)
      ? 'none'
      : missing.length
        ? 'partial'
        : 'complete',
  }
}
export function usageId(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}
export function sanitizeModelUsage(value: unknown): Record<string, RawUsage> {
  const result: Record<string, RawUsage> = {}
  for (const [model, usage] of Object.entries(object(value))) {
    if (model.length > 256) continue
    const record: RawUsage = {}
    for (const key of [
      'inputTokens',
      'outputTokens',
      'cacheReadInputTokens',
      'cacheCreationInputTokens',
    ]) {
      const count = number(object(usage)[key])
      if (count !== null) record[key] = count
    }
    if (Object.keys(record).length) result[model] = record
  }
  return result
}
export function providerFromBaseUrl(value: string | undefined): string | null {
  if (!value) return null // Claude may inherit configuration; don't claim Anthropic by default.
  try {
    return new URL(value).hostname.toLowerCase() || null
  } catch {
    return null
  }
}
