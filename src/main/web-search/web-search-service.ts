import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  WEB_SEARCH_RESULT_COUNTS,
  type WebSearchBackendAccess,
  type WebSearchKeySource,
  type WebSearchMonthUsage,
  type WebSearchResultItem,
  type WebSearchSettingsInput,
  type WebSearchSource,
  type WebSearchStatus,
  type WebSearchVerifyResult,
} from '../../shared/web-search/web-search-types'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const REQUEST_TIMEOUT_MS = 30_000
/** Keep tool results within a reasonable model context budget. */
const MAX_FETCH_CHARACTERS = 60_000
const MAX_RESULT_CONTENT_CHARACTERS = 8_000
const USAGE_MONTHS_KEPT = 24

export const webSearchSettingsSchema = z
  .object({
    enabled: z.boolean(),
    keySource: z.enum(['agent', 'own']),
    monthlyLimit: z.number().int().min(0).max(1_000_000),
    resultCount: z
      .number()
      .int()
      .refine((value) => (WEB_SEARCH_RESULT_COUNTS as readonly number[]).includes(value)),
    backends: z
      .object({ codex: z.boolean(), claudeCode: z.boolean(), owner: z.boolean() })
      .strict(),
  })
  .strict()

const usageSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  search: z.number().int().min(0),
  fetch: z.number().int().min(0),
  failed: z.number().int().min(0),
  bySource: z.record(
    z.string(),
    z.object({ search: z.number().int().min(0), fetch: z.number().int().min(0) }),
  ),
})

const stateSchema = z.object({
  version: z.literal(1),
  settings: webSearchSettingsSchema,
  lastVerifiedAt: z.string().optional(),
  usage: z.array(usageSchema).max(USAGE_MONTHS_KEPT),
})
type State = z.infer<typeof stateSchema>

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettingsInput = {
  enabled: false,
  keySource: 'agent',
  monthlyLimit: 2000,
  resultCount: 10,
  backends: { codex: true, claudeCode: false, owner: true },
}

export class WebSearchError extends Error {
  constructor(
    readonly code:
      | 'DISABLED'
      | 'MISSING_KEY'
      | 'LIMIT_REACHED'
      | 'INVALID_INPUT'
      | 'UPSTREAM'
      | 'TIMEOUT'
      | 'CANCELLED',
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export interface WebSearchDependencies {
  statePath: string
  /** DeepSeek key saved for Claude Code, or null when the agent provider is not DeepSeek. */
  resolveAgentKey(): string | null
  resolveOwnKey(): string | null
  fetch?: typeof fetch
  now?: () => Date
}

export interface WebSearchCallOptions {
  source: WebSearchSource
  signal?: AbortSignal
}

/**
 * Sole owner of DeepSeek Search/Fetch calls, the monthly cap and the local usage log.
 * Only search terms and URLs leave the machine; keys are read per call and never returned.
 */
export class WebSearchService {
  private state: State = {
    version: 1,
    settings: DEFAULT_WEB_SEARCH_SETTINGS,
    usage: [],
  }
  private loaded = false
  private writes: Promise<void> = Promise.resolve()
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date

  constructor(private readonly deps: WebSearchDependencies) {
    this.fetchImpl = deps.fetch ?? fetch
    this.now = deps.now ?? (() => new Date())
  }

  async load(): Promise<void> {
    try {
      const parsed = stateSchema.safeParse(JSON.parse(await readFile(this.deps.statePath, 'utf8')))
      if (parsed.success) this.state = parsed.data
    } catch {
      // Missing or unreadable state keeps the defaults; web search stays disabled.
    }
    this.loaded = true
  }

  getStatus(): WebSearchStatus {
    const settings = this.state.settings
    const usage = this.currentUsage()
    const agentKeyAvailable = Boolean(this.deps.resolveAgentKey())
    const ownKeyConfigured = Boolean(this.deps.resolveOwnKey())
    const key = this.resolveKey(settings.keySource)
    const used = usage.search + usage.fetch
    let state: WebSearchStatus['state'] = 'ready'
    let reason: string | undefined
    if (!settings.enabled) {
      state = 'disabled'
      reason = '联网搜索未启用'
    } else if (!key) {
      state = 'missing-key'
      reason =
        settings.keySource === 'agent'
          ? 'Claude Code 未保存 DeepSeek Key'
          : '未填写联网搜索的 DeepSeek Key'
    } else if (settings.monthlyLimit > 0 && used >= settings.monthlyLimit) {
      state = 'limit-reached'
      reason = `本月已达 ${settings.monthlyLimit} 次上限`
    }
    return {
      state,
      ...(reason ? { reason } : {}),
      enabled: settings.enabled,
      keySource: settings.keySource,
      agentKeyAvailable,
      ownKeyConfigured,
      monthlyLimit: settings.monthlyLimit,
      resultCount: settings.resultCount,
      backends: { ...settings.backends },
      usage,
      ...(this.state.lastVerifiedAt ? { lastVerifiedAt: this.state.lastVerifiedAt } : {}),
    }
  }

  getUsage(month: string): WebSearchMonthUsage {
    return structuredClone(
      this.state.usage.find((item) => item.month === month) ?? emptyUsage(month),
    )
  }

  /** Whether an agent of this kind may see the tools right now (enabled and a key resolves). */
  isAvailableFor(agent: keyof WebSearchBackendAccess): boolean {
    const status = this.getStatus()
    return status.state === 'ready' && status.backends[agent]
  }

  async saveSettings(input: WebSearchSettingsInput): Promise<WebSearchStatus> {
    this.state = { ...this.state, settings: webSearchSettingsSchema.parse(input) }
    await this.persist()
    return this.getStatus()
  }

  async search(
    input: { query: string; count?: number; needContent?: boolean },
    options: WebSearchCallOptions,
  ): Promise<WebSearchResultItem[]> {
    const query = input.query.trim()
    if (!query || [...query].length > 128)
      throw new WebSearchError('INVALID_INPUT', '搜索词需要 1–128 个字符')
    const count = Math.min(
      50,
      Math.max(1, Math.trunc(input.count ?? this.state.settings.resultCount)),
    )
    const key = this.requireUsableKey()
    const body = await this.call(
      key,
      '/v1/tools/search',
      {
        query,
        count,
        need_content: input.needContent === true,
      },
      options,
    )
    const results = z
      .object({
        results: z.array(
          z
            .object({
              title: z.string().catch(''),
              url: z.string().catch(''),
              snippet: z.string().catch(''),
              summary: z.string().catch(''),
              content: z.string().catch(''),
              site_name: z.string().nullable().catch(null),
              date: z.string().nullable().catch(null),
            })
            .passthrough(),
        ),
      })
      .parse(body).results
    // DeepSeek bills only non-empty results; count the same way.
    await this.record(options.source, 'search', results.length > 0)
    return results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      summary: item.summary,
      ...(item.content ? { content: item.content.slice(0, MAX_RESULT_CONTENT_CHARACTERS) } : {}),
      siteName: item.site_name ?? null,
      date: item.date ?? null,
    }))
  }

  async fetchPage(
    input: { url: string },
    options: WebSearchCallOptions,
  ): Promise<{ url: string; title: string; content: string; truncated: boolean }> {
    let url: URL
    try {
      url = new URL(input.url)
    } catch {
      throw new WebSearchError('INVALID_INPUT', '网址无效')
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new WebSearchError('INVALID_INPUT', '只能读取不含账号密码的 http(s) 网址')
    if (url.href.length > 8192) throw new WebSearchError('INVALID_INPUT', '网址过长')
    const key = this.requireUsableKey()
    const body = await this.call(key, '/v1/tools/fetch', { url: url.href }, options)
    const page = z.object({ title: z.string().catch(''), content: z.string() }).parse(body)
    await this.record(options.source, 'fetch', true)
    return {
      url: url.href,
      title: page.title,
      content: page.content.slice(0, MAX_FETCH_CHARACTERS),
      truncated: page.content.length > MAX_FETCH_CHARACTERS,
    }
  }

  /** One real search and one real fetch; enables the service only when both succeed. */
  async verify(input: WebSearchSettingsInput): Promise<WebSearchVerifyResult> {
    const previous = this.state.settings
    this.state = {
      ...this.state,
      settings: { ...webSearchSettingsSchema.parse(input), enabled: true },
    }
    try {
      const query = 'DeepSeek API 文档'
      let started = Date.now()
      const results = await this.search({ query, count: 5 }, { source: 'verify' })
      const search = { query, resultCount: results.length, durationMs: Date.now() - started }
      if (!results.length)
        throw new WebSearchError('UPSTREAM', '搜索请求成功，但没有返回结果；请稍后重试')
      const target = 'https://api-docs.deepseek.com/'
      started = Date.now()
      const page = await this.fetchPage({ url: target }, { source: 'verify' })
      this.state.lastVerifiedAt = this.now().toISOString()
      await this.persist()
      return {
        success: true,
        message: '联网搜索可用',
        search,
        fetch: {
          url: target,
          title: page.title,
          characters: page.content.length,
          durationMs: Date.now() - started,
        },
      }
    } catch (error) {
      this.state = { ...this.state, settings: { ...input, enabled: previous.enabled } }
      await this.persist()
      return { success: false, message: error instanceof Error ? error.message : '验证失败' }
    }
  }

  async flush(): Promise<void> {
    await this.writes
  }

  private resolveKey(source: WebSearchKeySource): string | null {
    return (source === 'agent' ? this.deps.resolveAgentKey() : this.deps.resolveOwnKey()) || null
  }

  private requireUsableKey(): string {
    const status = this.getStatus()
    if (status.state === 'disabled') throw new WebSearchError('DISABLED', '联网搜索未启用')
    if (status.state === 'missing-key') throw new WebSearchError('MISSING_KEY', status.reason!)
    if (status.state === 'limit-reached')
      throw new WebSearchError(
        'LIMIT_REACHED',
        `${status.reason}，已停止调用。可在设置中提高上限，或下月再用。`,
      )
    return this.resolveKey(this.state.settings.keySource)!
  }

  private async call(
    key: string,
    path: string,
    payload: Record<string, unknown>,
    options: WebSearchCallOptions,
  ): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS)
    const forward = () => controller.abort('cancelled')
    options.signal?.addEventListener('abort', forward, { once: true })
    try {
      const response = await this.fetchImpl(DEEPSEEK_BASE_URL + path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      const text = await response.text()
      let body: unknown = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = null
      }
      if (!response.ok) {
        await this.record(options.source, null, false)
        throw new WebSearchError(
          'UPSTREAM',
          describeFailure(response.status, body),
          response.status,
        )
      }
      return body
    } catch (error) {
      if (error instanceof WebSearchError) throw error
      await this.record(options.source, null, false)
      if (controller.signal.aborted)
        throw controller.signal.reason === 'cancelled'
          ? new WebSearchError('CANCELLED', '已取消')
          : new WebSearchError('TIMEOUT', 'DeepSeek 在 30 秒内没有响应')
      throw new WebSearchError('UPSTREAM', '无法连接 DeepSeek，请检查网络')
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', forward)
    }
  }

  private currentUsage(): WebSearchMonthUsage {
    return this.getUsage(monthOf(this.now()))
  }

  private async record(
    source: WebSearchSource,
    kind: 'search' | 'fetch' | null,
    billable: boolean,
  ): Promise<void> {
    const month = monthOf(this.now())
    let usage = this.state.usage.find((item) => item.month === month)
    if (!usage) {
      usage = emptyUsage(month)
      this.state.usage = [usage, ...this.state.usage].slice(0, USAGE_MONTHS_KEPT)
    }
    if (!kind || !billable) {
      usage.failed++
    } else {
      usage[kind]++
      const bucket = (usage.bySource[source] ??= { search: 0, fetch: 0 })
      bucket[kind]++
    }
    await this.persist()
  }

  private persist(): Promise<void> {
    if (!this.loaded) return Promise.resolve()
    const snapshot = JSON.stringify(this.state, null, 2)
    const path = this.deps.statePath
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        const temporary = `${path}.${process.pid}.tmp`
        await writeFile(temporary, snapshot, { mode: 0o600 })
        await rename(temporary, path)
      })
    return this.writes
  }
}

function emptyUsage(month: string): WebSearchMonthUsage {
  return { month, search: 0, fetch: 0, failed: 0, bySource: {} }
}

function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function describeFailure(status: number, body: unknown): string {
  const upstream =
    body && typeof body === 'object' && 'error' in body
      ? String((body as { error?: { message?: unknown } }).error?.message ?? '')
      : ''
  const reason =
    status === 401
      ? 'DeepSeek Key 无效或已失效'
      : status === 402
        ? 'DeepSeek 账户余额不足，请充值后重试'
        : status === 403
          ? '该网页被 DeepSeek 安全策略拒绝读取'
          : status === 404
            ? '该网页无法读取（不可访问、被站点拒绝或没有可提取的正文）'
            : status === 429
              ? 'DeepSeek 调用过于频繁，请稍后重试'
              : status === 408 || status === 504
                ? 'DeepSeek 请求超时，请稍后重试'
                : status >= 500
                  ? 'DeepSeek 服务暂时不可用，请稍后重试'
                  : 'DeepSeek 拒绝了这次请求'
  return upstream && status === 400
    ? `${reason}：${upstream.slice(0, 200)}`
    : `${reason}（HTTP ${status}）`
}
