import { createHash } from 'node:crypto'

/**
 * URL normalisation, article key and URL-embedded dates.
 * Ported from Argus `stocknews/urlnorm.py` (2026-07/09 field-tested rules); keep the
 * pattern order, it is significant.
 */

const STRIP_PARAMS =
  /^(utm_.+|spm|from|share|fr|src|source|ref|chks?|tt_from|igshid|_t|timestamp|pos|refer)$/

export function normalizeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return raw.trim()
  }
  const host = url.hostname.toLowerCase()
  const port = url.port && !['80', '443'].includes(url.port) ? `:${url.port}` : ''
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !STRIP_PARAMS.test(key))
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
  const query = kept.length ? '?' + new URLSearchParams(kept).toString() : ''
  let path = url.pathname || '/'
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '') || '/'
  const scheme = url.protocol.replace(/:$/, '').toLowerCase() || 'https'
  return `${scheme}://${host}${port}${path}${query}`
}

/** Article primary key: first 16 hex chars of SHA-256 over the normalised URL. */
export function articleKey(raw: string): string {
  return createHash('sha256').update(normalizeUrl(raw)).digest('hex').slice(0, 16)
}

const URL_DATE_PATTERNS: RegExp[] = [
  // /2026/07-10/ 、2026-9-3 、2026/7/10
  /\/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?![0-9])/,
  // /2026-0903/
  /\/(20\d{2})-(\d{2})(\d{2})(?![0-9])/,
  // /2026/0903/
  /\/(20\d{2})\/(\d{2})(\d{2})\//,
  // doc-20260703
  /doc-(20\d{2})(\d{2})(\d{2})/,
  // 东财 /a/202609033864222147.html
  /\/a\/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{6,}(?:\.s?html?)?$/,
  // 证券星 /RB2026070800007741.shtml
  /\/(?:RB|RD)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{6,}(?:\.shtml)?$/,
  // fx678 /content/202609040932451234.html
  /\/content\/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{9,}(?:\.html)?$/,
  // 大众网 /t20260904_1234567.html
  /\/t(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])_\d+\.s?html?$/,
  // 腾讯新闻 20260904A0720X00
  /(20\d{2})(\d{2})(\d{2})[A-Z]/,
  // ?pub_date=2026-07-10 / &ptime=20260903
  /[?&](?:pub_date|pubtime|pubDate|date|ptime|publishdate|publishDate)=(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/,
  // 裸 20260903（前后不能是数字/字母）
  /\b(20\d{2})(\d{2})(\d{2})\b(?![0-9A-Za-z])/,
]

const PUBLISHED_PATTERNS: RegExp[] = [/(20\d{2})-(\d{2})-(\d{2})/, /^(20\d{2})(\d{2})(\d{2})$/]

/** Calendar day as YYYY-MM-DD in UTC arithmetic (inputs are already local calendar days). */
function isoDay(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null
  return date.toISOString().slice(0, 10)
}

export function addDays(day: string, delta: number): string {
  const date = new Date(day + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000)
}

function firstValid(text: string, patterns: RegExp[], today: string): string | null {
  const latest = addDays(today, 1)
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (!match) continue
    const day = isoDay(Number(match[1]), Number(match[2]), Number(match[3]))
    if (!day) continue
    if (day > latest) continue // future date = false match
    return day
  }
  return null
}

/** Date embedded in the URL (first, most reliable level). */
export function extractUrlDate(url: string, today: string): string | null {
  return firstValid(url, URL_DATE_PATTERNS, today)
}

/** Date reported by the search result (second level): SearXNG publishedDate / DeepSeek date. */
export function extractPublishedDate(published: string | null | undefined, today: string) {
  if (!published) return null
  return firstValid(published.trim().slice(0, 32), PUBLISHED_PATTERNS, today)
}

/**
 * Two-level freshness gate. `date` is the resolved day or null when neither level has one;
 * undated results are kept (Argus default) unless the caller drops them.
 */
export function freshnessGate(
  url: string,
  published: string | null | undefined,
  freshnessDays: number,
  today: string,
): { keep: boolean; date: string | null } {
  const day = extractUrlDate(url, today) ?? extractPublishedDate(published, today)
  if (!day) return { keep: true, date: null }
  return { keep: daysBetween(day, today) <= freshnessDays, date: day }
}
