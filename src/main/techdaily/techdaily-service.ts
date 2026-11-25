import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  SEARXNG_DEFAULT_ENGINES,
  searxngBaseUrlSchema,
  type SaveTechDailySettings,
  type SearxngConfigInput,
  type SearxngConfigSnapshot,
  type SearxngTestResult,
  type TechDailyCollectResult,
  type TechDailyProvider,
  type TechDailySettingsSnapshot,
  type TechDailyStatus,
} from '../../shared/techdaily/techdaily-types'
import { filterResults, newFunnel, type KeptItem, type QueryLanguage } from './filters'
import {
  deepSeekProvider,
  searxngProvider,
  toRawItem,
  type DeepSeekSearchPort,
  type SearchProvider,
  type SearxngConnection,
} from './search-providers'
import { readTechDailySettings, writeTechDailyOptions } from './settings-file'
import { TechDailyStore } from './techdaily-store'
import { addDays, articleKey, extractPublishedDate, extractUrlDate } from './url-rules'

const searxngFileSchema = z
  .object({
    version: z.literal(1),
    baseUrl: searxngBaseUrlSchema,
    engines: z.array(z.string().min(1).max(40)).min(1).max(20),
    lastTest: z.unknown().optional(),
  })
  .strict()
type SearxngFile = z.infer<typeof searxngFileSchema>

export interface TechDailyCredentialPort {
  resolve(id: string): Readonly<Record<string, string>> | null
  set(id: string, fields: Record<string, string>): Promise<void>
  remove(id: string): Promise<void>
}

export interface DeepSeekStatusPort {
  /** null = ready; otherwise why web search cannot be used now. */
  unavailableReason(): string | null
}

export interface TechDailyServiceDependencies {
  /** `userData/techdaily`. */
  dataDirectory: string
  personalRoot: () => string | null
  deepSeek: DeepSeekSearchPort & DeepSeekStatusPort
  credentials: TechDailyCredentialPort
  credentialId: string
  timezone: (root: string) => Promise<string>
  now?: () => Date
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  searxngDelayMs?: number
}

const TEST_QUERY = 'AI chip'
const ARTICLE_KEEP_DAYS = 14

/** Calendar day in a time zone, YYYY-MM-DD. */
export function dayIn(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * Owns tech daily settings I/O, the SearXNG connection on this machine and search
 * collection into the local article store. Single owner; renderer only goes through IPC.
 */
export class TechDailyService {
  private store: TechDailyStore | null = null
  private collecting = false
  private lastCollect: TechDailyCollectResult | undefined
  private readonly now: () => Date
  /** Test run before its address was saved; persisted when that address is saved. */
  private unsavedTest: { baseUrl: string; result: SearxngTestResult } | null = null

  constructor(private readonly deps: TechDailyServiceDependencies) {
    this.now = deps.now ?? (() => new Date())
  }

  private get searxngPath(): string {
    return join(this.deps.dataDirectory, 'searxng.json')
  }

  private db(): TechDailyStore {
    this.store ??= new TechDailyStore(join(this.deps.dataDirectory, 'techdaily.sqlite'))
    return this.store
  }

  private root(workspacePath: string): string {
    const personal = this.deps.personalRoot()
    if (!personal || resolve(personal) !== resolve(workspacePath))
      throw new Error('科技日报只在“我的空间”中可用')
    return personal
  }

  // ── settings ──

  async getSettings(input: { workspacePath: string }): Promise<TechDailySettingsSnapshot> {
    return readTechDailySettings(this.root(input.workspacePath))
  }

  async saveSettings(input: SaveTechDailySettings): Promise<TechDailySettingsSnapshot> {
    return writeTechDailyOptions(this.root(input.workspacePath), input.options, input.revision)
  }

  async getStatus(input: { workspacePath: string }): Promise<TechDailyStatus> {
    const root = this.root(input.workspacePath)
    const { settings } = await readTechDailySettings(root)
    const provider = settings.search_provider
    const readiness = async (id: TechDailyProvider) => {
      const why = await this.unavailableReason(id)
      return why ? { ready: false, reason: why } : { ready: true }
    }
    const providers = { deepseek: await readiness('deepseek'), searxng: await readiness('searxng') }
    const reason = providers[provider].reason
    return {
      provider,
      ready: !reason,
      ...(reason ? { reason } : {}),
      providers,
      callsToday: this.db().callsOn(dayIn(await this.deps.timezone(root), this.now()), provider),
      dailyCallLimit: settings.daily_call_limit,
      collecting: this.collecting,
      ...(this.lastCollect ? { lastCollect: this.lastCollect } : {}),
    }
  }

  private async unavailableReason(provider: TechDailyProvider): Promise<string | null> {
    if (provider === 'deepseek') return this.deps.deepSeek.unavailableReason()
    const file = await this.readSearxngFile()
    return file ? null : 'SearXNG 服务地址未配置'
  }

  // ── SearXNG ──

  private async readSearxngFile(): Promise<SearxngFile | null> {
    try {
      const parsed = searxngFileSchema.safeParse(
        JSON.parse(await readFile(this.searxngPath, 'utf8')),
      )
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  private async writeSearxngFile(value: SearxngFile): Promise<void> {
    await mkdir(dirname(this.searxngPath), { recursive: true, mode: 0o700 })
    const temporary = `${this.searxngPath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    await rename(temporary, this.searxngPath)
  }

  async getSearxng(): Promise<SearxngConfigSnapshot> {
    const file = await this.readSearxngFile()
    const credential = this.deps.credentials.resolve(this.deps.credentialId)
    return {
      configured: !!file,
      baseUrl: file?.baseUrl ?? null,
      engines: file?.engines ?? [...SEARXNG_DEFAULT_ENGINES],
      username: credential?.username ?? null,
      hasPassword: !!credential?.password,
      ...(file?.lastTest ? { lastTest: file.lastTest as SearxngTestResult } : {}),
    }
  }

  private connectionFor(input: SearxngConfigInput): SearxngConnection {
    const saved = this.deps.credentials.resolve(this.deps.credentialId)
    const auth =
      input.auth.mode === 'basic'
        ? { username: input.auth.username, password: input.auth.password }
        : input.auth.mode === 'keep' && saved?.username && saved.password
          ? { username: saved.username, password: saved.password }
          : {}
    return { baseUrl: input.baseUrl.trim().replace(/\/+$/, ''), engines: input.engines, ...auth }
  }

  async saveSearxng(input: SearxngConfigInput): Promise<SearxngConfigSnapshot> {
    const previous = await this.readSearxngFile()
    const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
    if (input.auth.mode === 'basic')
      await this.deps.credentials.set(this.deps.credentialId, {
        username: input.auth.username,
        password: input.auth.password,
      })
    else if (input.auth.mode === 'none') await this.deps.credentials.remove(this.deps.credentialId)
    await this.writeSearxngFile({
      version: 1,
      baseUrl,
      engines: input.engines,
      // A test of another address says nothing about this one.
      ...(this.unsavedTest?.baseUrl === baseUrl
        ? { lastTest: this.unsavedTest.result }
        : previous?.lastTest && previous.baseUrl === baseUrl
          ? { lastTest: previous.lastTest }
          : {}),
    })
    return this.getSearxng()
  }

  /** One search, nothing stored except the result summary (when this address is saved). */
  async testSearxng(input: SearxngConfigInput): Promise<SearxngTestResult> {
    const connection = this.connectionFor(input)
    const provider = searxngProvider(connection, {
      fetchImpl: this.deps.fetchImpl,
      sleep: this.deps.sleep,
      delayMs: 0,
    })
    const started = Date.now()
    const testedAt = this.now().toISOString()
    const today = dayIn('UTC', this.now())
    let result: SearxngTestResult
    try {
      const raw = await provider.searchRaw(TEST_QUERY, 'en')
      const items = raw.map(toRawItem)
      const engines: Record<string, number> = {}
      for (const item of items)
        for (const e of item.engines ?? []) engines[e] = (engines[e] ?? 0) + 1
      const allowed = new Set(connection.engines)
      const allowedItems = items.filter((i) => (i.engines ?? []).some((e) => allowed.has(e)))
      const dated = allowedItems.filter(
        (i) => extractUrlDate(i.url, today) ?? extractPublishedDate(i.published, today),
      )
      result = {
        ok: allowedItems.length > 0,
        message: items.length
          ? allowedItems.length
            ? `连接成功：${items.length} 条结果，其中 ${allowedItems.length} 条来自采用的引擎，${dated.length} 条带日期`
            : `连接成功，但 ${items.length} 条结果都不来自采用的引擎；请检查引擎名称或服务端启用的引擎`
          : '连接成功，但没有返回结果：服务端 news 分类可能没有可用引擎',
        testedAt,
        query: TEST_QUERY,
        durationMs: Date.now() - started,
        rawCount: items.length,
        allowedCount: allowedItems.length,
        datedCount: dated.length,
        engines,
        sample: allowedItems.slice(0, 5).map((i) => ({
          title: i.title.slice(0, 120),
          url: i.url,
          date: extractUrlDate(i.url, today) ?? extractPublishedDate(i.published, today),
          engines: (i.engines ?? []).slice(0, 5),
        })),
      }
    } catch (error) {
      result = {
        ok: false,
        message: (error as Error).message || '测试失败',
        testedAt,
        query: TEST_QUERY,
        durationMs: Date.now() - started,
        rawCount: 0,
        allowedCount: 0,
        datedCount: 0,
        engines: {},
        sample: [],
      }
    }
    this.unsavedTest = { baseUrl: connection.baseUrl, result }
    const file = await this.readSearxngFile()
    if (file && file.baseUrl === connection.baseUrl)
      await this.writeSearxngFile({ ...file, lastTest: result })
    return result
  }

  private async providerFor(provider: TechDailyProvider): Promise<SearchProvider> {
    if (provider === 'deepseek') return deepSeekProvider(this.deps.deepSeek)
    const file = await this.readSearxngFile()
    if (!file) throw new Error('SearXNG 服务地址未配置')
    return searxngProvider(
      this.connectionFor({ baseUrl: file.baseUrl, engines: file.engines, auth: { mode: 'keep' } }),
      {
        fetchImpl: this.deps.fetchImpl,
        sleep: this.deps.sleep,
        delayMs: this.deps.searxngDelayMs,
      },
    )
  }

  // ── collection ──

  /**
   * Trial collection: every word-list query once, filters, URL merge, local upsert.
   * No AI and no report file. Stops at the per-run call cap; DeepSeek monthly cap is
   * enforced inside WebSearchService.
   */
  async collect(
    input: { workspacePath: string },
    signal?: AbortSignal,
  ): Promise<TechDailyCollectResult> {
    const root = this.root(input.workspacePath)
    if (this.collecting) throw new Error('已有一轮采集正在进行')
    this.collecting = true
    try {
      const snapshot = await readTechDailySettings(root)
      if (snapshot.status === 'invalid') throw new Error(snapshot.error ?? '设置.yaml 无效')
      const settings = snapshot.settings
      const reason = await this.unavailableReason(settings.search_provider)
      if (reason) throw new Error(reason)
      const provider = await this.providerFor(settings.search_provider)
      const startedAt = this.now()
      const today = dayIn(await this.deps.timezone(root), startedAt)
      const started = Date.now()
      const store = this.db()
      const limit = settings.daily_call_limit
      const runSeen = new Map<string, KeptItem>()
      const result: TechDailyCollectResult = {
        provider: settings.search_provider,
        startedAt: startedAt.toISOString(),
        durationMs: 0,
        requests: 0,
        failedRequests: 0,
        domains: [],
        mergedAcrossDomains: 0,
        articles: 0,
        dated: 0,
        inserted: 0,
        updated: 0,
        samples: [],
      }
      const failures = new Set<string>()
      let stop = false
      for (const domain of settings.domains) {
        if (stop) break
        if (limit > 0 && result.requests >= limit) {
          result.stoppedReason = `达到单次调用上限 ${limit}，其余搜索词未执行`
          break
        }
        const funnel = newFunnel(domain)
        result.domains.push(funnel)
        const seen = new Map<string, KeptItem>()
        const pairs: Array<[string, QueryLanguage]> = [
          ...domain.queries.zh.map((q): [string, QueryLanguage] => [q, 'zh']),
          ...domain.queries.en.map((q): [string, QueryLanguage] => [q, 'en']),
        ]
        for (const [query, lang] of pairs) {
          if (signal?.aborted) {
            result.stoppedReason = '已取消'
            stop = true
            break
          }
          if (limit > 0 && result.requests >= limit) {
            result.stoppedReason = `达到单次调用上限 ${limit}，其余搜索词未执行`
            stop = true
            break
          }
          funnel.requests++
          result.requests++
          store.addCall(today, settings.search_provider)
          let items
          try {
            items = await provider.search(query, lang, settings.results_per_query, signal)
          } catch (error) {
            funnel.failedRequests++
            result.failedRequests++
            const message = (error as Error).message || '搜索失败'
            failures.add(message)
            // Cap or missing key: every further call fails the same way.
            if (/上限|未启用|Key|拒绝访问|无法连接/.test(message)) {
              result.stoppedReason = message
              stop = true
              break
            }
            continue
          }
          filterResults(
            items,
            query,
            lang,
            domain,
            {
              today,
              freshnessDays: settings.freshness_days,
              keepUndated: settings.keep_undated,
              excludeKeywords: settings.exclude_keywords,
              extraDenylist: settings.domain_denylist,
              engineAllowlist: provider.engineAllowlist,
            },
            seen,
            funnel,
            articleKey,
          )
        }
        for (const item of seen.values()) {
          const prior = runSeen.get(item.key)
          if (prior) {
            // Cross-domain merge: the first domain keeps the article.
            result.mergedAcrossDomains++
            for (const q of item.queries) if (!prior.queries.includes(q)) prior.queries.push(q)
            if (!prior.date && item.date) prior.date = item.date
            continue
          }
          runSeen.set(item.key, item)
        }
        funnel.kept = [...seen.values()].filter((i) => runSeen.get(i.key) === i).length
        funnel.undated = [...seen.values()].filter(
          (i) => runSeen.get(i.key) === i && !i.date,
        ).length
      }
      const kept = [...runSeen.values()]
      const saved = store.upsertArticles(kept, settings.search_provider, today)
      store.prune(addDays(today, -ARTICLE_KEEP_DAYS))
      result.articles = kept.length
      result.dated = kept.filter((i) => i.date).length
      result.inserted = saved.inserted
      result.updated = saved.updated
      result.samples = kept
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .slice(0, 30)
        .map((i) => ({
          domain: i.domain,
          title: i.title,
          url: i.url,
          date: i.date,
          queries: i.queries.slice(0, 3),
        }))
      if (
        !result.stoppedReason &&
        result.failedRequests &&
        result.failedRequests === result.requests
      )
        result.stoppedReason = [...failures][0] ?? '全部搜索失败'
      result.durationMs = Date.now() - started
      this.lastCollect = result
      return result
    } finally {
      this.collecting = false
    }
  }

  close(): void {
    this.store?.close()
    this.store = null
  }
}
