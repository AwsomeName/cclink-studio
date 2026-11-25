import { lstat, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
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
  type TechDailySettings,
  type TechDailyRun,
  type TechDailyStep,
  type TechDailyStepId,
  type TechDailyMonth,
  TECHDAILY_DIRECTORY,
  TECHDAILY_PROVIDER_LABELS,
  techDailyReportPath,
  techDailyStepIds,
} from '../../shared/techdaily/techdaily-types'
import { callAiJson, type AiText } from './ai-json'
import { fetchArxivRecent, fetchGithubTrending } from './frontier-sources'
import { renderPrompt, selectPrompt, tasteBlock, type QuickEntry } from './prompts'
import {
  buildReport,
  renderEmptyMarkdown,
  renderMarkdown,
  type PickedItem,
  type QuickItem,
} from './report-markdown'
import { filterResults, newFunnel, type KeptItem, type QueryLanguage } from './filters'
import {
  deepSeekProvider,
  searxngProvider,
  toRawItem,
  type DeepSeekSearchPort,
  type SearchProvider,
  type SearxngConnection,
} from './search-providers'
import { countQueries, readTechDailySettings, writeTechDailyOptions } from './settings-file'
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
  /** Text-only local AI (Codex first, Claude Code fallback). Missing = generation unavailable. */
  ai?: AiText
  /** DeepSeek page reading for originals; optional. */
  fetchPage?: (url: string) => Promise<string>
}

const TEST_QUERY = 'AI chip'
const ARTICLE_KEEP_DAYS = 14
const MIN_CANDIDATES = 8
const MIN_ITEMS = 5
const MAX_ITEMS = 10

const STEP_LABELS: Record<TechDailyStepId, [string, TechDailyStep['actor']]> = {
  check: ['检查搜索服务与本机 AI', 'Studio'],
  read: ['读取设置与近几日已报道', 'Studio'],
  search: ['按领域搜索并过滤', '搜索服务'],
  frontier: ['开源热点与论文前沿', '公开数据源'],
  merge: ['存入本机库（按网址去重）', 'Studio'],
  candidates: ['整理候选', 'Studio'],
  select: ['AI 精选 5–10 条', 'AI'],
  render: ['读取原文并成稿', 'AI'],
  leaderboard: ['更新模型能力榜', 'Studio'],
  save: ['保存并核对', 'Studio'],
}

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
  private current: { run: TechDailyRun; abort: AbortController } | null = null

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
    if (this.collecting) throw new Error('已有一轮采集或生成正在进行')
    this.collecting = true
    try {
      const snapshot = await readTechDailySettings(root)
      if (snapshot.status === 'invalid') throw new Error(snapshot.error ?? '设置.yaml 无效')
      const settings = snapshot.settings
      const reason = await this.unavailableReason(settings.search_provider)
      if (reason) throw new Error(reason)
      const provider = await this.providerFor(settings.search_provider)
      const today = dayIn(await this.deps.timezone(root), this.now())
      const { result } = await this.searchAll(settings, provider, today, signal)
      this.lastCollect = result
      return result
    } finally {
      this.collecting = false
    }
  }

  private async searchAll(
    settings: TechDailySettings,
    provider: SearchProvider,
    today: string,
    signal?: AbortSignal,
    progress?: (detail: string) => void,
  ): Promise<{ result: TechDailyCollectResult; kept: KeptItem[] }> {
    const startedAt = this.now()
    const started = Date.now()
    const store = this.db()
    const limit = settings.daily_call_limit
    const planned = settings.domains.reduce(
      (n, d) => n + d.queries.zh.length + d.queries.en.length,
      0,
    )
    const total = limit > 0 ? Math.min(limit, planned) : planned
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
          result.stoppedReason = '已停止'
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
        progress?.(
          `${domain.name} · 第 ${result.requests}/${total} 次 · 已留下 ${
            runSeen.size + seen.size
          } 篇${result.failedRequests ? ` · 失败 ${result.failedRequests}` : ''}`,
        )
        let items
        try {
          items = await provider.search(query, lang, settings.results_per_query, signal)
        } catch (error) {
          funnel.failedRequests++
          result.failedRequests++
          const message = (error as Error).message || '搜索失败'
          failures.add(message)
          // Cap or missing key: every further call fails the same way.
          if (signal?.aborted || /上限|未启用|Key|拒绝访问|无法连接/.test(message)) {
            result.stoppedReason = signal?.aborted ? '已停止' : message
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
      funnel.undated = [...seen.values()].filter((i) => runSeen.get(i.key) === i && !i.date).length
    }
    const kept = [...runSeen.values()]
    const saved = store.upsertArticles(kept, settings.search_provider, today)
    store.prune(addDays(today, -ARTICLE_KEEP_DAYS))
    result.articles = kept.length
    result.dated = kept.filter((i) => i.date).length
    result.inserted = saved.inserted
    result.updated = saved.updated
    result.samples = [...kept]
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 30)
      .map((i) => ({
        domain: i.domain,
        title: i.title,
        url: i.url,
        date: i.date,
        queries: i.queries.slice(0, 3),
      }))
    if (!result.stoppedReason && result.failedRequests && result.failedRequests === result.requests)
      result.stoppedReason = [...failures][0] ?? '全部搜索失败'
    result.durationMs = Date.now() - started
    return { result, kept }
  }

  // ── daily report ──

  private runPath(day: string): string {
    return join(this.deps.dataDirectory, 'runs', day, 'run.json')
  }

  private async persistRun(run: TechDailyRun): Promise<void> {
    const file = this.runPath(run.day)
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(run, null, 2) + '\n', { mode: 0o600 })
    await rename(temporary, file)
  }

  async getRun(input: { workspacePath: string; day: string }): Promise<TechDailyRun | null> {
    this.root(input.workspacePath)
    if (this.current?.run.day === input.day) return structuredClone(this.current.run)
    try {
      const run = JSON.parse(await readFile(this.runPath(input.day), 'utf8')) as TechDailyRun
      // A run file left "running" means Studio quit mid-run.
      if (run.status === 'running') return { ...run, status: 'interrupted' }
      return run
    } catch {
      return null
    }
  }

  async listMonth(input: { workspacePath: string; month: string }): Promise<TechDailyMonth> {
    const root = this.root(input.workspacePath)
    const today = dayIn(await this.deps.timezone(root), this.now())
    const [year, month] = input.month.split('-')
    const directory = join(root, TECHDAILY_DIRECTORY, year, month)
    const days: Record<string, string> = {}
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const match = /^(\d{2})(\d{2})\.md$/.exec(entry.name)
        if (!entry.isFile() || !match || match[1] !== month) continue
        days[`${year}-${month}-${match[2]}`] = join(directory, entry.name)
      }
    } catch {
      // No reports that month.
    }
    return { month: input.month, today, days }
  }

  stop(input: { workspacePath: string }): Promise<TechDailyRun | null> {
    this.root(input.workspacePath)
    this.current?.abort.abort()
    return Promise.resolve(this.current ? structuredClone(this.current.run) : null)
  }

  /** Starts today's report in the background; the page follows it with getRun. */
  async generate(input: { workspacePath: string; overwrite: boolean }): Promise<TechDailyRun> {
    const root = this.root(input.workspacePath)
    if (this.collecting) throw new Error('已有一轮采集或生成正在进行')
    const snapshot = await readTechDailySettings(root)
    if (snapshot.status === 'invalid') throw new Error(snapshot.error ?? '设置.yaml 无效')
    // The day is fixed when the run starts; crossing midnight still counts as this day.
    const day = dayIn(await this.deps.timezone(root), this.now())
    const target = join(root, techDailyReportPath(day))
    const exists = await stat(target).then(
      () => true,
      () => false,
    )
    if (exists && !input.overwrite) throw new Error('今天已有科技日报；重新生成会覆盖当天文件')
    this.collecting = true
    const run: TechDailyRun = {
      day,
      runId: `${day.replaceAll('-', '')}-${this.now().toISOString().slice(11, 19).replaceAll(':', '')}`,
      status: 'running',
      startedAt: this.now().toISOString(),
      steps: techDailyStepIds.map((id) => ({
        id,
        label: STEP_LABELS[id][0],
        actor: STEP_LABELS[id][1],
        state: 'pending',
      })),
    }
    const abort = new AbortController()
    this.current = { run, abort }
    await this.persistRun(run)
    void this.pipeline(root, snapshot.settings, run, abort.signal)
      .catch(() => undefined)
      .finally(() => {
        this.collecting = false
        if (this.current?.run === run) this.current = null
      })
    return structuredClone(run)
  }

  private async pipeline(
    root: string,
    settings: TechDailySettings,
    run: TechDailyRun,
    signal: AbortSignal,
  ): Promise<void> {
    const step = (id: TechDailyStepId) => run.steps.find((s) => s.id === id)!
    let writes = Promise.resolve()
    const save = () => {
      const snapshot = structuredClone(run)
      writes = writes.then(() => this.persistRun(snapshot)).catch(() => undefined)
    }
    const begin = (id: TechDailyStepId, detail?: string) => {
      Object.assign(step(id), { state: 'running', startedAt: this.now().toISOString(), detail })
      save()
    }
    const update = (id: TechDailyStepId, detail: string) => {
      step(id).detail = detail
      save()
    }
    const end = (id: TechDailyStepId, state: TechDailyStep['state'], detail?: string) => {
      Object.assign(step(id), {
        state,
        endedAt: this.now().toISOString(),
        ...(detail !== undefined ? { detail } : {}),
      })
      save()
    }
    const finish = async (status: TechDailyRun['status'], error?: string) => {
      for (const s of run.steps)
        if (s.state === 'pending')
          Object.assign(s, { state: 'skipped', detail: s.detail ?? '未执行' })
      Object.assign(run, { status, endedAt: this.now().toISOString(), ...(error ? { error } : {}) })
      save()
      await writes
    }
    const failAt = async (id: TechDailyStepId, message: string) => {
      end(id, 'failed', message)
      await finish(signal.aborted ? 'stopped' : 'failed', message)
    }
    const domainNames = new Map(settings.domains.map((d) => [d.id, d.name]))
    const store = this.db()
    let current: TechDailyStepId = 'check'
    try {
      // 1 check
      begin('check')
      const reason = await this.unavailableReason(settings.search_provider)
      if (reason) return await failAt('check', `搜索服务不可用：${reason}`)
      if (!this.deps.ai)
        return await failAt('check', '本机 AI 不可用（Codex / Claude Code 都未就绪）')
      end(
        'check',
        'done',
        `${TECHDAILY_PROVIDER_LABELS[settings.search_provider]} 可用；本机 AI 已连接`,
      )

      // 2 read
      current = 'read'
      begin('read')
      const recentTitles = store.reportedTitles(addDays(run.day, -5), run.day)
      const queryCount = countQueries(settings)
      end(
        'read',
        'done',
        `设置.yaml：${settings.domains.length} 个领域、${queryCount} 个搜索词；近 5 天已报道 ${recentTitles.length} 条`,
      )

      // 3 search
      current = 'search'
      begin('search', '开始搜索…')
      const provider = await this.providerFor(settings.search_provider)
      const { result: searched } = await this.searchAll(settings, provider, run.day, signal, (d) =>
        update('search', d),
      )
      if (signal.aborted) return await failAt('search', '已停止')
      this.lastCollect = searched
      const raw = searched.domains.reduce((n, d) => n + d.raw, 0)
      const datedPct = searched.articles
        ? Math.round((searched.dated / searched.articles) * 100)
        : 0
      const searchDetail = `${searched.requests} 次搜索${
        searched.failedRequests ? `（失败 ${searched.failedRequests}）` : ''
      } → 原始 ${raw} 条，过滤后留下 ${searched.articles} 篇（带日期 ${datedPct}%）${
        searched.stoppedReason ? `；${searched.stoppedReason}` : ''
      }`
      if (!searched.requests || searched.failedRequests === searched.requests)
        return await failAt('search', searched.stoppedReason ?? '搜索全部失败')
      end('search', 'done', searchDetail)

      // 4 frontier
      current = 'frontier'
      begin('frontier', '读取 GitHub 新星仓库和 arXiv 最新论文…')
      const fetchImpl = this.deps.fetchImpl ?? fetch
      const [repos, papers] = await Promise.all([
        fetchGithubTrending(fetchImpl, run.day),
        fetchArxivRecent(fetchImpl, run.day),
      ])
      end(
        'frontier',
        'done',
        `GitHub ${repos.length} 个、arXiv ${papers.length} 篇${
          repos.length + papers.length ? '' : '（数据源未返回，速览栏目跳过）'
        }；热点补采（HN）尚未接入`,
      )

      // 5 merge
      current = 'merge'
      begin('merge')
      end(
        'merge',
        'done',
        `本机库新增 ${searched.inserted}、再次出现 ${searched.updated}；跨领域同网址合并 ${searched.mergedAcrossDomains}`,
      )

      // 6 candidates
      current = 'candidates'
      begin('candidates')
      const candidates = store.candidates(run.day, addDays(run.day, -1))
      const reportedCount = candidates.filter((c) => c.reportedOn).length
      if (candidates.length < MIN_CANDIDATES) {
        end('candidates', 'done', `候选 ${candidates.length} 条，少于 ${MIN_CANDIDATES} 条`)
        const reasonText = `候选不足（${candidates.length} 条，低于 ${MIN_CANDIDATES} 条门槛）`
        await this.writeReport(root, run.day, renderEmptyMarkdown(run.day, run.runId, reasonText))
        run.filePath = techDailyReportPath(run.day)
        run.itemCount = 0
        end('save', 'done', `已写入 ${run.filePath}（候选不足短报）`)
        return await finish('empty')
      }
      end(
        'candidates',
        'done',
        `候选 ${candidates.length} 条（近两天抓到），其中已报道过 ${reportedCount} 条`,
      )

      // 7 select
      current = 'select'
      begin('select', '本机 AI 正在精选…')
      const taste = tasteBlock(
        settings.taste?.blacklist_brands ?? [],
        settings.taste?.preferences ?? '',
      )
      const { value: selection } = await callAiJson(
        this.deps.ai,
        'techdaily-select',
        selectPrompt({
          candidates: candidates.map((c) => ({
            domainName: domainNames.get(c.domain) ?? c.domain,
            date: c.date,
            title: c.title,
            content: c.content,
            reported: !!c.reportedOn,
          })),
          minItems: MIN_ITEMS,
          maxItems: MAX_ITEMS,
          recentTitles,
          taste,
        }),
        (d) => (Array.isArray(d.items) ? d : null),
      )
      if (signal.aborted) return await failAt('select', '已停止')
      const used = new Set<number>()
      const picked: Array<PickedItem & { key: string; content: string }> = []
      let alsoCount = 0
      for (const raw of (selection.items as unknown[]).slice(0, MAX_ITEMS)) {
        const it = (raw ?? {}) as Record<string, unknown>
        const rep = it.rep
        if (
          typeof rep !== 'number' ||
          !Number.isInteger(rep) ||
          rep < 0 ||
          rep >= candidates.length ||
          used.has(rep)
        )
          continue
        used.add(rep)
        const also = (Array.isArray(it.also) ? it.also : []).filter(
          (a): a is number =>
            typeof a === 'number' &&
            Number.isInteger(a) &&
            a >= 0 &&
            a < candidates.length &&
            !used.has(a),
        )
        for (const a of also) used.add(a)
        alsoCount += also.length
        const c = candidates[rep]
        picked.push({
          slot: `${c.domain}#${picked.length}`,
          domain: c.domain,
          url: c.url,
          date: c.date,
          title: c.title,
          sources: 1 + also.length,
          reason: String(it.reason ?? ''),
          reportedBefore: c.reportedOn,
          key: c.key,
          content: c.content,
        })
      }
      if (!picked.length) return await failAt('select', 'AI 没有选出可用条目（编号都无效）')
      end('select', 'done', `入选 ${picked.length} 条；同事件归并 ${alsoCount} 条`)

      // 8 render
      current = 'render'
      begin('render')
      const texts = new Map<string, string>()
      if (settings.search_provider === 'deepseek' && this.deps.fetchPage) {
        let read = 0
        for (const p of picked.slice(0, MAX_ITEMS)) {
          if (signal.aborted) break
          update('render', `读取原文 ${read + 1}/${picked.length}…`)
          try {
            texts.set(p.slot, (await this.deps.fetchPage(p.url)).slice(0, 1500))
            read++
          } catch {
            // Fall back to the search snippet.
          }
        }
        update('render', `读取原文 ${read}/${picked.length}；本机 AI 正在成稿…`)
      } else update('render', '用搜索摘要成稿（SearXNG 不读取原文）；本机 AI 正在成稿…')
      const quickInput: QuickEntry[] = [
        ...repos.map((r, i) => ({
          id: `os#${i}`,
          kind: 'open_source' as const,
          title: r.title,
          raw: r.raw,
        })),
        ...papers.map((p, i) => ({
          id: `paper#${i}`,
          kind: 'paper' as const,
          title: p.title,
          raw: p.raw,
        })),
      ]
      const { value: rendered } = await callAiJson(
        this.deps.ai,
        'techdaily-render',
        renderPrompt(
          picked.map((p) => ({
            slot: p.slot,
            domainName: domainNames.get(p.domain) ?? p.domain,
            title: p.title,
            text: texts.get(p.slot) || p.content,
            sources: p.sources,
            reason: p.reason,
          })),
          quickInput,
        ),
        (d) => (Array.isArray(d.sections) ? d : null),
      )
      if (signal.aborted) return await failAt('render', '已停止')
      const translations = new Map(
        (Array.isArray(rendered.quick) ? rendered.quick : [])
          .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
          .map((q) => [String(q.id ?? ''), q]),
      )
      const quick: QuickItem[] = [...repos, ...papers].map((item, index) => {
        const id = item.kind === 'open_source' ? `os#${index}` : `paper#${index - repos.length}`
        const t = translations.get(id)
        const desc = String(t?.desc_zh ?? '').trim() || item.raw.slice(0, 160)
        return item.kind === 'paper'
          ? {
              kind: 'paper',
              title: String(t?.title_zh ?? '').trim() || item.title,
              summary: t?.title_zh ? `${desc}（原题：${item.title.slice(0, 80)}）` : desc,
              url: item.url,
            }
          : {
              kind: 'open_source',
              title: item.title,
              summary: `⭐${item.stars} · ${desc}`,
              url: item.url,
            }
      })
      const report = buildReport({
        day: run.day,
        runId: run.runId,
        picked,
        rendered: rendered as never,
        domainOrder: settings.domains.map((d) => ({ id: d.id, name: d.name })),
        quick,
        trendHint: String(selection.trend_hint ?? ''),
        funnel: { raw, kept: searched.articles, candidates: candidates.length, selected: 0 },
        notes: ['模型能力榜尚未接入'],
      })
      if (!report.sections.length) return await failAt('render', 'AI 成稿没有引用任何有效槽位')
      end(
        'render',
        'done',
        `成稿 ${report.funnel.selected} 条${report.headline ? '，含头条解读' : ''}；速览 ${quick.length} 条`,
      )

      // 9 leaderboard
      current = 'leaderboard'
      end('leaderboard', 'skipped', '模型能力榜尚未接入（下一步实现）')

      // 10 save
      current = 'save'
      begin('save')
      const markdown = renderMarkdown(report)
      const missing = report.sections
        .flatMap((s) => s.items)
        .filter((i) => !/^https?:\/\//.test(i.url))
      await this.writeReport(root, run.day, markdown)
      store.markReported(
        run.day,
        report.sections
          .flatMap((s) => s.items)
          .map((i) => ({ key: picked.find((p) => p.slot === i.slot)!.key, title: i.title })),
      )
      run.filePath = techDailyReportPath(run.day)
      run.itemCount = report.funnel.selected
      end(
        'save',
        'done',
        `已写入 ${run.filePath}；${report.funnel.selected} 条均有原文链接${missing.length ? `（缺链接 ${missing.length} 条已标出）` : ''}`,
      )
      await finish('completed')
    } catch (error) {
      await failAt(current, signal.aborted ? '已停止' : (error as Error).message || '生成失败')
    }
  }

  private async writeReport(root: string, day: string, markdown: string): Promise<void> {
    const file = join(root, techDailyReportPath(day))
    const directory = join(root, TECHDAILY_DIRECTORY)
    await mkdir(dirname(file), { recursive: true })
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('科技日报目录不是普通目录')
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, markdown, 'utf8')
    await rename(temporary, file)
  }

  close(): void {
    this.store?.close()
    this.store = null
  }
}
