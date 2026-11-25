import { z } from 'zod'

/** Folder inside My Space that holds the shared (synced) tech daily files. */
export const TECHDAILY_DIRECTORY = '科技日报'
export const TECHDAILY_SETTINGS_PATH = `${TECHDAILY_DIRECTORY}/设置.yaml`
/** SearXNG Basic credential lives in the Studio credential file, never in synced files. */
export const SEARXNG_CREDENTIAL_ID = 'extension:searxng:default'
/** Engines Argus verified on 2026-09-06; results from other engines are dropped. */
export const SEARXNG_DEFAULT_ENGINES = ['bing', 'bing news', 'duckduckgo news'] as const

export const techDailyProviders = ['deepseek', 'searxng'] as const
export type TechDailyProvider = (typeof techDailyProviders)[number]
export const TECHDAILY_PROVIDER_LABELS: Record<TechDailyProvider, string> = {
  deepseek: 'DeepSeek 联网搜索',
  searxng: 'SearXNG 远程服务',
}

const shortText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\u0000-\u001f]/.test(s), '不能包含控制字符')
const queryList = z.array(shortText(128)).max(16).default([])

export const techDailyDomainSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, '领域 id 只能是小写字母、数字和下划线'),
    name: shortText(20),
    queries: z.object({ zh: queryList, en: queryList }).passthrough(),
    match: z.array(shortText(40)).max(60).default([]),
  })
  .passthrough()
export type TechDailyDomain = z.infer<typeof techDailyDomainSchema>

/**
 * `科技日报/设置.yaml`. Keys stay snake_case and Argus-compatible, so an Argus
 * `queries.yaml` can be pasted in as is; Studio-only keys have defaults.
 * Unknown keys are kept (passthrough) and written back untouched.
 */
export const techDailySettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    search_provider: z.enum(techDailyProviders).default('deepseek'),
    freshness_days: z.number().int().min(1).max(14).default(3),
    keep_undated: z.boolean().default(true),
    results_per_query: z.number().int().min(5).max(20).default(15),
    /** Search calls one tech daily run may make; 0 = no own cap (monthly cap still applies). */
    daily_call_limit: z.number().int().min(0).max(500).default(80),
    domains: z
      .array(techDailyDomainSchema)
      .min(1)
      .max(20)
      .refine((list) => new Set(list.map((d) => d.id)).size === list.length, '领域 id 不能重复'),
    exclude_keywords: z.array(shortText(40)).max(300).default([]),
    domain_denylist: z.array(shortText(253)).max(300).default([]),
    taste: z
      .object({
        blacklist_brands: z.array(shortText(40)).max(100).default([]),
        preferences: z.string().max(8000).default(''),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
export type TechDailySettings = z.infer<typeof techDailySettingsSchema>

export interface TechDailySettingsSnapshot {
  workspacePath: string
  /** Relative to the workspace. */
  filePath: string
  /** `missing` = no file yet; the defaults (Argus word list) are shown and written on first save. */
  status: 'saved' | 'missing' | 'invalid'
  settings: TechDailySettings
  revision: string | null
  error?: string
  queryCount: number
}

/** The scalar options the settings page edits; domains and word lists are edited in the file. */
export const techDailyOptionsSchema = z
  .object({
    enabled: z.boolean(),
    search_provider: z.enum(techDailyProviders),
    freshness_days: z.number().int().min(1).max(14),
    keep_undated: z.boolean(),
    results_per_query: z.number().int().min(5).max(20),
    daily_call_limit: z.number().int().min(0).max(500),
  })
  .strict()
export type TechDailyOptions = z.infer<typeof techDailyOptionsSchema>

const workspacePathSchema = z.string().min(1).max(4096)
export const saveTechDailySettingsSchema = z
  .object({
    workspacePath: workspacePathSchema,
    revision: z.string().max(128).nullable(),
    options: techDailyOptionsSchema,
  })
  .strict()
export type SaveTechDailySettings = z.infer<typeof saveTechDailySettingsSchema>

// ── SearXNG (this machine only) ──────────────────────────────────

export const searxngBaseUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    } catch {
      return false
    }
  }, '请填写 http(s):// 开头的服务地址，不要带账号、查询参数或 #')

export const searxngConfigInputSchema = z
  .object({
    baseUrl: searxngBaseUrlSchema,
    engines: z.array(shortText(40)).min(1).max(20),
    /** keep = leave the saved credential as is; none = remove it; basic = replace it. */
    auth: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('keep') }).strict(),
      z.object({ mode: z.literal('none') }).strict(),
      z
        .object({
          mode: z.literal('basic'),
          username: shortText(256),
          password: z.string().min(1).max(1024),
        })
        .strict(),
    ]),
  })
  .strict()
export type SearxngConfigInput = z.infer<typeof searxngConfigInputSchema>

export interface SearxngConfigSnapshot {
  configured: boolean
  baseUrl: string | null
  engines: string[]
  /** Only the username is returned; the password never leaves the main process. */
  username: string | null
  hasPassword: boolean
  lastTest?: SearxngTestResult
}

export interface SearxngTestResult {
  ok: boolean
  message: string
  testedAt: string
  query: string
  durationMs: number
  rawCount: number
  /** Results from allowed engines. */
  allowedCount: number
  datedCount: number
  engines: Record<string, number>
  sample: Array<{ title: string; url: string; date: string | null; engines: string[] }>
}

// ── Trial collection (search + filters + URL merge; no AI, no report) ─────

export interface TechDailyDomainFunnel {
  id: string
  name: string
  requests: number
  failedRequests: number
  raw: number
  /** Not http(s) or empty title. */
  invalid: number
  denied: number
  engineRejected: number
  excluded: number
  stale: number
  guarded: number
  /** Same URL inside this domain. */
  mergedInDomain: number
  kept: number
  undated: number
}

export interface TechDailyCollectSample {
  domain: string
  title: string
  url: string
  date: string | null
  queries: string[]
}

export interface TechDailyCollectResult {
  provider: TechDailyProvider
  startedAt: string
  durationMs: number
  /** Set when the run stopped early (call cap, provider unavailable). */
  stoppedReason?: string
  requests: number
  failedRequests: number
  domains: TechDailyDomainFunnel[]
  /** Same URL already kept by an earlier domain this run. */
  mergedAcrossDomains: number
  articles: number
  dated: number
  /** Stored into the local article table for the first time / seen again. */
  inserted: number
  updated: number
  samples: TechDailyCollectSample[]
}

export interface TechDailyStatus {
  provider: TechDailyProvider
  /** Whether the saved provider can be called now, and why not. */
  ready: boolean
  reason?: string
  /** Readiness of each provider, so the page can explain an unsaved choice. */
  providers: Record<TechDailyProvider, { ready: boolean; reason?: string }>
  callsToday: number
  dailyCallLimit: number
  collecting: boolean
  lastCollect?: TechDailyCollectResult
}

export const techDailyWorkspaceInputSchema = z
  .object({ workspacePath: workspacePathSchema })
  .strict()

export type TechDailyResult<T> = { success: true; data: T } | { success: false; error: string }

// ── Daily report runs ─────────────────────────────────────────────

/** `科技日报/{yyyy}/{mm}/{MMDD}.md` relative to the workspace. */
export function techDailyReportPath(day: string): string {
  const [year, month, date] = day.split('-')
  return `${TECHDAILY_DIRECTORY}/${year}/${month}/${month}${date}.md`
}

export const techDailyStepIds = [
  'check',
  'read',
  'search',
  'frontier',
  'merge',
  'candidates',
  'select',
  'render',
  'leaderboard',
  'save',
] as const
export type TechDailyStepId = (typeof techDailyStepIds)[number]

export interface TechDailyStep {
  id: TechDailyStepId
  label: string
  actor: 'Studio' | 'AI' | '搜索服务' | '公开数据源'
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  /** What happened, from real execution events (counts, reasons). */
  detail?: string
  startedAt?: string
  endedAt?: string
}

export interface TechDailyRun {
  day: string
  runId: string
  /** empty = saved a "候选不足" short report; interrupted = Studio quit mid-run. */
  status: 'running' | 'completed' | 'empty' | 'failed' | 'interrupted' | 'stopped'
  startedAt: string
  endedAt?: string
  steps: TechDailyStep[]
  error?: string
  /** Relative to the workspace, once written. */
  filePath?: string
  itemCount?: number
}

export interface TechDailyMonth {
  month: string
  today: string
  /** YYYY-MM-DD → report path (absolute) for days that have a report file. */
  days: Record<string, string>
}

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const techDailyMonthInputSchema = z
  .object({ workspacePath: workspacePathSchema, month: z.string().regex(/^\d{4}-\d{2}$/) })
  .strict()
export const techDailyDayInputSchema = z
  .object({ workspacePath: workspacePathSchema, day: daySchema })
  .strict()
export const techDailyGenerateInputSchema = z
  .object({ workspacePath: workspacePathSchema, overwrite: z.boolean() })
  .strict()
