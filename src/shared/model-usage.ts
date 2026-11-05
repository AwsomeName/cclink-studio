import { z } from 'zod'

export const usageCategories = [
  'collection',
  'analysis',
  'daily-report',
  'writing',
  'development',
  'other',
  'unclassified',
] as const
export const usageCategorySchema = z.enum(usageCategories)
export type UsageCategory = z.infer<typeof usageCategorySchema>
export interface ModelUsageContext {
  workspace?: string | null
  runId?: string | null
  sessionId?: string | null
  conversationId?: string | null
  taskId?: string | null
  category?: UsageCategory
  provider?: string | null
  instanceId?: string | null
  transcriptRoot?: string
}
export interface ModelUsageObserver {
  observe(event: unknown): void
  finish(status: 'succeeded' | 'failed' | 'interrupted' | 'unknown'): void
}
export type CreateModelUsageObserver = (
  context: ModelUsageContext,
) => ModelUsageObserver | undefined
const text = z.string().max(4096)
const token = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
export const tokenFields = ['input', 'output', 'cacheRead', 'cacheWrite', 'thinking'] as const
export const normalizedUsageSchema = z
  .object({
    input: token,
    output: token,
    cacheRead: token,
    cacheWrite: token,
    thinking: token,
    inputIncludesCache: z.literal(false),
    outputIncludesThinking: z.literal(true),
  })
  .strict()
export type NormalizedUsage = z.infer<typeof normalizedUsageSchema>
export type RawUsage = { [key: string]: number | RawUsage }
export const rawUsageSchema: z.ZodType<RawUsage> = z.lazy(() =>
  z.record(
    z.string(),
    z.union([z.number().nonnegative().max(Number.MAX_SAFE_INTEGER), rawUsageSchema]),
  ),
)
export const modelUsageRecordSchema = z
  .object({
    version: z.literal(1),
    id: text,
    originId: text,
    timestamp: z.string().datetime(),
    provider: text.nullable(),
    model: text.nullable(),
    workspace: text.nullable(),
    instanceId: text.nullable(),
    runId: text.nullable(),
    sessionId: text.nullable(),
    taskId: text.nullable(),
    conversationId: text.nullable(),
    parentToolUseId: text.nullable(),
    messageId: text.nullable(),
    requestId: text.nullable(),
    retryOrdinal: token,
    category: usageCategorySchema,
    status: z.enum(['in-progress', 'succeeded', 'failed', 'interrupted', 'unknown']),
    durationMs: token,
    timingBasis: z.enum(['observed-stream', 'unavailable']),
    sources: z.array(z.enum(['claude-sdk', 'claude-transcript'])),
    estimated: z.literal(false),
    protocol: z.literal('anthropic-messages'),
    rawUsage: rawUsageSchema,
    normalized: normalizedUsageSchema,
    final: z.boolean(),
    outputEvidence: z
      .enum(['stream-delta', 'transcript-final', 'unverified'])
      .default('unverified'),
    thinkingEvidence: z
      .enum(['stream-delta', 'transcript-final', 'unverified'])
      .default('unverified'),
    coverage: z.enum(['complete', 'partial', 'none']),
    missing: z.array(z.string()),
    missingMetadata: z.array(z.string()).default([]),
  })
  .strict()
export type ModelUsageRecord = z.infer<typeof modelUsageRecordSchema>
export const usageRunSchema = z
  .object({
    id: text,
    originId: text,
    instanceId: text.nullable(),
    workspace: text.nullable(),
    conversationId: text.nullable(),
    sessionId: text.nullable(),
    taskId: text.nullable(),
    category: usageCategorySchema,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    status: z.enum(['in-progress', 'succeeded', 'failed', 'interrupted', 'unknown']),
    rawUsage: rawUsageSchema,
    sdkEstimatedUsd: z.number().nonnegative().nullable(),
    rawModelUsage: z.record(z.string(), rawUsageSchema).default({}),
  })
  .strict()
export type UsageRun = z.infer<typeof usageRunSchema>

// Configuration only in v1: rates are never mistaken for an invoice or subscription quota.
export const usagePriceSchema = z
  .object({
    provider: text,
    model: text,
    currency: z.string().length(3),
    unitTokens: z.number().positive(),
    source: z.string().url(),
    effectiveFrom: z.string().datetime(),
    effectiveTo: z.string().datetime().nullable(),
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative().nullable(),
    cacheWrite: z.number().nonnegative().nullable(),
    timeBands: z
      .array(
        z
          .object({
            timezone: z.literal('Asia/Shanghai'),
            fromHour: z.number().min(0).max(23),
            toHour: z.number().min(0).max(24),
            input: z.number().nonnegative(),
            output: z.number().nonnegative(),
            cacheRead: z.number().nonnegative().nullable(),
            cacheWrite: z.number().nonnegative().nullable(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
export const usageConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    taskCategories: z.record(z.string(), usageCategorySchema).default({}),
    sessionCategories: z.record(z.string(), usageCategorySchema).default({}),
    runCategories: z.record(z.string(), usageCategorySchema).default({}),
    prices: z.array(usagePriceSchema).default([]),
  })
  .strict()
export type UsageConfig = z.infer<typeof usageConfigSchema>

export interface UsagePeriod {
  id: string
  originId: string
  from: string
  to: string
  state: 'recording' | 'disabled' | 'degraded'
}
export interface UsageTotals {
  calls: number
  tasks: number
  executions: number
  callsWithoutTask: number
  failed: number
  interrupted: number
  unknownStatus: number
  retriedCalls: number
  callsWithUnknownRetry: number
  coverage: { complete: number; partial: number; none: number }
  tokens: Record<(typeof tokenFields)[number], { value: number | null; missingCalls: number }>
}
export interface UsageGroup extends UsageTotals {
  name: string
}
export interface UsagePeak {
  from: string
  to: string
  knownTokens: number
  calls: number
}
export interface UsageScope extends UsageTotals {
  byDay: UsageGroup[]
  byDayModel: { date: string; model: string; knownTokens: number }[]
  byWorkspace: UsageGroup[]
  byCategory: UsageGroup[]
  byModel: UsageGroup[]
  peak5Hours: UsagePeak | null
  peak7Days: UsagePeak | null
}
export interface UsageQuery {
  from: string
  to: string
  workspace?: string
  model?: string
  category?: UsageCategory
}
export interface UsageSnapshot {
  range: { from: string; to: string }
  all: UsageScope
  excludingDevelopment: UsageScope
  activity: { from: string; to: string; all: UsageGroup[]; excludingDevelopment: UsageGroup[] }
  periods: UsagePeriod[]
  enabled: boolean
  environmentDisabled: boolean
  database: string
  originId: string
  earliest: string | null
  latest: string | null
  workspaces: string[]
  models: string[]
  lastError: { timestamp: string; code: string } | null
  unfinishedRuns: number
  mismatchedRuns: number
}
export type UsageResult<T> =
  | { success: true; value: T }
  | { success: false; error: { code: string; message: string } }
