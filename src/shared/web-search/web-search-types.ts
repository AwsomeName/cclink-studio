/** Who made a web search call; used for the per-source usage breakdown. */
export type WebSearchSource = 'codex' | 'claude-code' | 'owner' | 'decision' | 'verify'

export const WEB_SEARCH_SOURCE_LABELS: Record<WebSearchSource, string> = {
  codex: 'Codex 会话',
  'claude-code': 'Claude Code 会话',
  owner: 'Owner 调研',
  decision: '公司 · 帮我想清楚',
  verify: '设置 · 验证',
}

/** Which agents may see web_search / web_fetch once the service is enabled. */
export interface WebSearchBackendAccess {
  codex: boolean
  claudeCode: boolean
  owner: boolean
}

export type WebSearchKeySource = 'agent' | 'own'

export const WEB_SEARCH_OWN_CREDENTIAL_ID = 'extension:deepseek-search:default'
/** DeepSeek list price: $0.75 per 1,000 successful Search or Fetch requests. */
export const WEB_SEARCH_PRICE_PER_CALL_USD = 0.00075
export const WEB_SEARCH_RESULT_COUNTS = [5, 10, 20] as const

export interface WebSearchMonthUsage {
  month: string
  search: number
  fetch: number
  failed: number
  bySource: Partial<Record<WebSearchSource, { search: number; fetch: number }>>
}

export type WebSearchState =
  /** Enabled and a DeepSeek key is available. */
  | 'ready'
  /** The user has not enabled web search. */
  | 'disabled'
  /** Enabled, but no DeepSeek key can be resolved. */
  | 'missing-key'
  /** Monthly cap reached; calls are refused until next month or a higher cap. */
  | 'limit-reached'

export interface WebSearchStatus {
  state: WebSearchState
  reason?: string
  enabled: boolean
  keySource: WebSearchKeySource
  /** A DeepSeek key is saved for Claude Code (provider = deepseek). */
  agentKeyAvailable: boolean
  ownKeyConfigured: boolean
  monthlyLimit: number
  resultCount: number
  backends: WebSearchBackendAccess
  usage: WebSearchMonthUsage
  lastVerifiedAt?: string
}

export interface WebSearchSettingsInput {
  enabled: boolean
  keySource: WebSearchKeySource
  /** 0 means no cap. */
  monthlyLimit: number
  resultCount: number
  backends: WebSearchBackendAccess
}

export interface WebSearchResultItem {
  title: string
  url: string
  snippet: string
  summary: string
  content?: string
  siteName: string | null
  date: string | null
}

export interface WebSearchVerifyResult {
  success: boolean
  message: string
  search?: { query: string; resultCount: number; durationMs: number }
  fetch?: { url: string; title: string; characters: number; durationMs: number }
}

export type WebSearchResult<T> = { success: true; data: T } | { success: false; error: string }
