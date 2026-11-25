/**
 * Free official APIs for the 开源热点 / 论文前沿 quick lists. Ported from Argus `trending.py`.
 * Every failure returns an empty list: these sections never block the report.
 */

export interface FrontierItem {
  kind: 'open_source' | 'paper'
  title: string
  url: string
  date: string
  /** Stars for repos; 0 for papers. */
  stars: number
  /** Description or abstract, ≤ 300 chars. */
  raw: string
}

const UA = 'CCLinkStudio-TechDaily/1.0'
const NOISE = ['awesome', 'curated list', '学习路线', '教程', 'interview']

export async function fetchGithubTrending(
  fetchImpl: typeof fetch,
  today: string,
  options: { days?: number; minStars?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<FrontierItem[]> {
  const since = new Date(Date.parse(today + 'T00:00:00Z') - (options.days ?? 14) * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const merged = new Map<string, FrontierItem>()
  // REST search does not support OR groups: one simple query per topic (Argus 2026-09-21).
  for (const topic of ['llm', 'agents', 'robotics']) {
    try {
      const url = new URL('https://api.github.com/search/repositories')
      url.searchParams.set('q', `topic:${topic} created:>${since}`)
      url.searchParams.set('sort', 'stars')
      url.searchParams.set('order', 'desc')
      url.searchParams.set('per_page', '10')
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': UA },
        signal: options.signal ?? AbortSignal.timeout(15_000),
      })
      if (!response.ok) continue
      const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
      for (const item of body.items ?? []) {
        const name = String(item.full_name ?? '')
        const desc = String(item.description ?? '')
        const link = String(item.html_url ?? '')
        if (!name || !link.startsWith('https://github.com/')) continue
        if (NOISE.some((k) => (name + ' ' + desc).toLowerCase().includes(k))) continue
        if (!merged.has(link))
          merged.set(link, {
            kind: 'open_source',
            title: name,
            url: link,
            date: String(item.created_at ?? '').slice(0, 10),
            stars: Number(item.stargazers_count ?? 0),
            raw: desc.slice(0, 200),
          })
      }
    } catch {
      // Skip this topic; the others may still answer.
    }
  }
  return [...merged.values()]
    .filter((r) => r.stars >= (options.minStars ?? 80))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, options.limit ?? 3)
}

const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const tag = (entry: string, name: string): string =>
  decode(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(entry)?.[1] ?? '')

export function parseArxivAtom(xml: string, cutoff: string, limit: number): FrontierItem[] {
  const out: FrontierItem[] = []
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1]
    const published = tag(entry, 'published').slice(0, 10)
    const id = tag(entry, 'id')
    if (!published || published < cutoff || !/^https?:\/\//.test(id)) continue
    out.push({
      kind: 'paper',
      title: tag(entry, 'title'),
      url: id.replace(/^http:/, 'https:'),
      date: published,
      stars: 0,
      raw: tag(entry, 'summary').slice(0, 300),
    })
    if (out.length >= limit) break
  }
  return out
}

export async function fetchArxivRecent(
  fetchImpl: typeof fetch,
  today: string,
  options: { days?: number; limit?: number; signal?: AbortSignal } = {},
): Promise<FrontierItem[]> {
  // 5-day window: arXiv does not announce on weekends (Argus).
  const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - (options.days ?? 5) * 86_400_000)
    .toISOString()
    .slice(0, 10)
  try {
    const url = new URL('https://export.arxiv.org/api/query')
    url.searchParams.set('search_query', 'cat:cs.AI OR cat:cs.RO OR cat:q-bio.NC')
    url.searchParams.set('sortBy', 'submittedDate')
    url.searchParams.set('sortOrder', 'descending')
    url.searchParams.set('max_results', '20')
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': UA },
      signal: options.signal ?? AbortSignal.timeout(15_000),
    })
    if (!response.ok) return []
    return parseArxivAtom(await response.text(), cutoff, options.limit ?? 3)
  } catch {
    return []
  }
}
