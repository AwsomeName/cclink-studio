import type { TechDailyDomain, TechDailyDomainFunnel } from '../../shared/techdaily/techdaily-types'
import { freshnessGate, normalizeUrl } from './url-rules'

/**
 * Pre-storage filters (not deduplication): drop results that are not news, too old or off
 * topic. Ported from Argus `techdaily/collector/searxng.py`; lists are copied verbatim.
 */

export const DOMAIN_DENYLIST = new Set([
  'www.tripadvisor.com',
  'cn.tripadvisor.com',
  'baike.baidu.com',
  'zh.wikipedia.org',
  'en.wikipedia.org',
  'www.zdic.net',
  'www.hanyuguoxue.com',
  'zh.wiktionary.org',
  'dict.revised.moe.edu.tw',
  'zidian.gushici.net',
  'edu.baidu.com',
  'www.imooc.com',
  'class.imooc.com',
  'deepseek.com',
  'www.deepseek.com',
  'download.deepseek.com',
  'github.com',
  'anthropic.com',
  'www.anthropic.com',
  'antohropic.com',
  'openai.com',
  'www.openai.com',
  'gemini.google.com',
  'ai-bot.cn',
  'chatgpt.com',
  'kimi.com',
  'www.kimi.com',
])

const GUARD_STOP_ZH = new Set([
  '发布',
  '动态',
  '新闻',
  '资讯',
  '落地',
  '应用',
  '公司',
  '行业',
  '集团',
  '最新',
  'ai',
])
const GUARD_STOP_EN = new Set([
  'news',
  'release',
  'launch',
  'announcement',
  'update',
  'latest',
  'ai',
])

const BRAND_TOKENS = new Set([
  'deepseek',
  'kimi',
  'minimax',
  '智谱',
  '月之暗面',
  '混元',
  '豆包',
  '千问',
  '文心',
  '阶跃',
  'figure',
  '宇树',
  '智元',
  '优必选',
  '特斯拉',
  'optimus',
  'mistral',
  'xai',
  'grok',
  'groq',
  'cerebras',
  '寒武纪',
  '壁仞',
  '摩尔线程',
  '沐曦',
  'pico',
  'rokid',
  'xreal',
  '雷鸟',
  '英伟达',
  'nvidia',
])

export type QueryLanguage = 'zh' | 'en'

export function guardTerms(query: string, lang: QueryLanguage, domain: TechDailyDomain): string[] {
  const stop = lang === 'zh' ? GUARD_STOP_ZH : GUARD_STOP_EN
  return [
    ...query.split(/\s+/).filter((term) => term && !stop.has(term.toLowerCase())),
    ...domain.match,
  ]
}

function onlyBrandHit(query: string, title: string, domain: TechDailyDomain): boolean {
  const lower = title.toLowerCase()
  const brands = new Set([...BRAND_TOKENS, ...domain.match.map((m) => m.toLowerCase())])
  // Stop words are not filtered here: "发布" in the title is evidence that it is news.
  const hits = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
    .filter((t) => lower.includes(t))
  return hits.length > 0 && hits.every((hit) => brands.has(hit))
}

/** Title guard: title hit passes unless undated and brand-only; content hit needs a date. */
export function guardPass(
  title: string,
  content: string,
  date: string | null,
  query: string,
  lang: QueryLanguage,
  domain: TechDailyDomain,
): boolean {
  const terms = guardTerms(query, lang, domain).map((t) => t.toLowerCase())
  const lower = title.toLowerCase()
  if (terms.some((t) => lower.includes(t)))
    return !(date === null && onlyBrandHit(query, title, domain))
  const head = (content || '').slice(0, 300).toLowerCase()
  if (terms.some((t) => head.includes(t))) return date !== null
  return false
}

export interface RawSearchItem {
  title: string
  url: string
  content: string
  /** SearXNG publishedDate or DeepSeek date. */
  published: string | null
  /** Engines that returned the item; null when the provider has no engine concept. */
  engines: string[] | null
}

export interface KeptItem {
  key: string
  url: string
  normalizedUrl: string
  title: string
  content: string
  date: string | null
  lang: QueryLanguage
  domain: string
  queries: string[]
  engines: string[]
}

export interface FilterOptions {
  today: string
  freshnessDays: number
  keepUndated: boolean
  excludeKeywords: string[]
  extraDenylist: string[]
  /** null = provider without engines (DeepSeek); otherwise only these engines count. */
  engineAllowlist: string[] | null
}

export function newFunnel(domain: TechDailyDomain): TechDailyDomainFunnel {
  return {
    id: domain.id,
    name: domain.name,
    requests: 0,
    failedRequests: 0,
    raw: 0,
    invalid: 0,
    denied: 0,
    engineRejected: 0,
    excluded: 0,
    stale: 0,
    guarded: 0,
    mergedInDomain: 0,
    kept: 0,
    undated: 0,
  }
}

/**
 * Runs one query's results through the gates and merges by normalised URL inside the
 * domain (`seen`). Order follows Argus: validity → denylist → engines → exclude words →
 * freshness → guard.
 */
export function filterResults(
  items: RawSearchItem[],
  query: string,
  lang: QueryLanguage,
  domain: TechDailyDomain,
  options: FilterOptions,
  seen: Map<string, KeptItem>,
  funnel: TechDailyDomainFunnel,
  keyOf: (url: string) => string,
): void {
  const denied = new Set([...DOMAIN_DENYLIST, ...options.extraDenylist.map((d) => d.toLowerCase())])
  const allow = options.engineAllowlist && new Set(options.engineAllowlist)
  for (const item of items) {
    funnel.raw++
    const title = item.title.trim()
    if (!/^https?:\/\//i.test(item.url) || !title) {
      funnel.invalid++
      continue
    }
    let host = ''
    try {
      host = new URL(item.url).hostname.toLowerCase()
    } catch {
      funnel.invalid++
      continue
    }
    if (denied.has(host)) {
      funnel.denied++
      continue
    }
    const engines = allow ? (item.engines ?? []).filter((e) => allow.has(e)) : []
    if (allow && !engines.length) {
      funnel.engineRejected++
      continue
    }
    if (options.excludeKeywords.some((k) => title.includes(k))) {
      funnel.excluded++
      continue
    }
    const gate = freshnessGate(item.url, item.published, options.freshnessDays, options.today)
    if (!gate.keep || (!gate.date && !options.keepUndated)) {
      funnel.stale++
      continue
    }
    if (!guardPass(title, item.content, gate.date, query, lang, domain)) {
      funnel.guarded++
      continue
    }
    const key = keyOf(item.url)
    const prior = seen.get(key)
    if (prior) {
      funnel.mergedInDomain++
      if (!prior.queries.includes(query)) prior.queries.push(query)
      for (const e of engines) if (!prior.engines.includes(e)) prior.engines.push(e)
      if (!prior.date && gate.date) prior.date = gate.date
      continue
    }
    seen.set(key, {
      key,
      url: item.url,
      normalizedUrl: normalizeUrl(item.url),
      title,
      content: item.content.trim().slice(0, 500),
      date: gate.date,
      lang,
      domain: domain.id,
      queries: [query],
      engines,
    })
  }
}
