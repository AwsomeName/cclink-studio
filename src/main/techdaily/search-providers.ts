import type { RawSearchItem, QueryLanguage } from './filters'

export interface SearchProvider {
  readonly id: 'deepseek' | 'searxng'
  /** null when the provider returns no engine names (no engine allowlist applies). */
  readonly engineAllowlist: string[] | null
  search(
    query: string,
    lang: QueryLanguage,
    count: number,
    signal?: AbortSignal,
  ): Promise<RawSearchItem[]>
}

// ── DeepSeek (through WebSearchService, so caps and usage stay in one place) ──

export interface DeepSeekSearchPort {
  search(
    input: { query: string; count?: number },
    options: { source: 'techdaily'; signal?: AbortSignal },
  ): Promise<
    Array<{ title: string; url: string; snippet: string; summary: string; date: string | null }>
  >
}

export function deepSeekProvider(port: DeepSeekSearchPort): SearchProvider {
  return {
    id: 'deepseek',
    engineAllowlist: null,
    async search(query, _lang, count, signal) {
      const results = await port.search({ query, count }, { source: 'techdaily', signal })
      return results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.snippet || r.summary,
        published: r.date,
        engines: null,
      }))
    },
  }
}

// ── SearXNG (user-run remote service) ──────────────────────────────────────

export interface SearxngConnection {
  baseUrl: string
  engines: string[]
  username?: string
  password?: string
}

export interface SearxngDependencies {
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Per-host spacing; Argus uses 3.5 s because bing quota is scarce. */
  delayMs?: number
  timeoutMs?: number
}

export class SearxngError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

const LANGUAGE: Record<QueryLanguage, string> = { zh: 'zh-CN', en: 'en' }
const USER_AGENT = 'CCLinkStudio-TechDaily/1.0'

export interface SearxngRawResult {
  title?: unknown
  url?: unknown
  content?: unknown
  publishedDate?: unknown
  engines?: unknown
  engine?: unknown
}

export function searxngSearchUrl(baseUrl: string, query: string, lang: QueryLanguage): string {
  const url = new URL(baseUrl.replace(/\/+$/, '') + '/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  // Iron rules from Argus: news category is mandatory; never send time_range (it empties results).
  url.searchParams.set('categories', 'news')
  url.searchParams.set('language', LANGUAGE[lang])
  return url.href
}

export function toRawItem(r: SearxngRawResult): RawSearchItem {
  const engines = Array.isArray(r.engines)
    ? r.engines.filter((e): e is string => typeof e === 'string')
    : typeof r.engine === 'string'
      ? [r.engine]
      : []
  return {
    title: typeof r.title === 'string' ? r.title : '',
    url: typeof r.url === 'string' ? r.url : '',
    content: typeof r.content === 'string' ? r.content : '',
    published: typeof r.publishedDate === 'string' ? r.publishedDate : null,
    engines,
  }
}

export function searxngProvider(
  connection: SearxngConnection,
  deps: SearxngDependencies = {},
): SearchProvider & {
  searchRaw(query: string, lang: QueryLanguage, signal?: AbortSignal): Promise<SearxngRawResult[]>
} {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const delayMs = deps.delayMs ?? 3500
  const timeoutMs = deps.timeoutMs ?? 25_000
  let lastHit = -Infinity
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': USER_AGENT }
  if (connection.username && connection.password)
    headers.Authorization =
      'Basic ' + Buffer.from(`${connection.username}:${connection.password}`).toString('base64')

  const searchRaw = async (query: string, lang: QueryLanguage, signal?: AbortSignal) => {
    const url = searxngSearchUrl(connection.baseUrl, query, lang)
    let backoff = 3000
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = lastHit + delayMs - now()
      if (wait > 0) await sleep(wait)
      lastHit = now()
      const timeout = AbortSignal.timeout(timeoutMs)
      let response: Response
      try {
        response = await fetchImpl(url, {
          headers,
          redirect: 'error',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        })
      } catch (error) {
        if (signal?.aborted) throw error
        if (attempt < 2) {
          await sleep(backoff)
          backoff *= 2
          continue
        }
        throw new SearxngError(`无法连接 SearXNG：${(error as Error).message || '网络错误'}`)
      }
      if (response.status === 429 && attempt < 2) {
        await sleep(backoff)
        backoff *= 2
        continue
      }
      if (response.status === 401 || response.status === 403)
        throw new SearxngError('SearXNG 拒绝访问：请检查访问凭证', response.status)
      if (!response.ok)
        throw new SearxngError(`SearXNG 返回 HTTP ${response.status}`, response.status)
      const text = await response.text()
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        throw new SearxngError(
          'SearXNG 没有返回 JSON：请在服务端 settings.yml 的 search.formats 里启用 json',
        )
      }
      const results = (body as { results?: unknown }).results
      return Array.isArray(results) ? (results as SearxngRawResult[]) : []
    }
    throw new SearxngError('SearXNG 限流（HTTP 429），已退避重试两次', 429)
  }

  return {
    id: 'searxng',
    engineAllowlist: connection.engines,
    searchRaw,
    async search(query, lang, count, signal) {
      return (await searchRaw(query, lang, signal)).slice(0, count).map(toRawItem)
    },
  }
}
