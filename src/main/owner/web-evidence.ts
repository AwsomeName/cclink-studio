import { createHash } from 'node:crypto'
import {
  ownerWebIpc,
  type OwnerWebMoreOutcome,
  type OwnerWebPage,
  type OwnerWebSearchResult,
  type OwnerWebStatus,
} from '../../shared/ipc/owner-web'
import {
  registerTrustedIpcContract,
  type TrustedRendererGuard,
} from '../ipc/trusted-renderer-guard'
import type { WebSearchService } from '../web-search/web-search-service'
import { sourceWindow } from './source-window'

type Service = Pick<WebSearchService, 'isAvailableFor' | 'getStatus' | 'search' | 'fetchPage'>
export type AskMoreWeb = (req: {
  conversationId: string
  used: number
  limit: number
}) => Promise<OwnerWebMoreOutcome>

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function webStatus(service: Service | null): OwnerWebStatus {
  if (!service) return { ready: false, reason: '联网搜索服务未就绪' }
  if (service.isAvailableFor('owner')) return { ready: true }
  const status = service.getStatus()
  return {
    ready: false,
    reason:
      status.state === 'ready'
        ? '联网搜索已启用，但没有对 Owner 开放；可在 Studio 设置的联网搜索里打开'
        : (status.reason ?? '联网搜索未启用；可在 Studio 设置里配置 DeepSeek 联网搜索'),
  }
}

export async function searchWeb(
  service: Service | null,
  query: string,
): Promise<OwnerWebSearchResult> {
  const status = webStatus(service)
  if (!status.ready) return { ok: false, error: status.reason! }
  try {
    const results = await service!.search({ query, count: 10 }, { source: 'owner' })
    const hits = results
      .filter((r) => /^https?:\/\//i.test(r.url))
      .slice(0, 10)
      .map((r) => ({
        url: r.url,
        title: r.title.slice(0, 200),
        snippet: (r.snippet || r.summary).slice(0, 300),
      }))
    return { ok: true, hits }
  } catch (e) {
    return { ok: false, error: '联网搜索失败：' + message(e) }
  }
}

export async function fetchWeb(
  service: Service | null,
  url: string,
  anchor: string,
  now = Date.now,
): Promise<OwnerWebPage> {
  const status = webStatus(service)
  if (!status.ready) return { ok: false, error: status.reason! }
  try {
    const page = await service!.fetchPage({ url }, { source: 'owner' })
    const content = page.content.replace(/\r\n?/g, '\n')
    if (!content.trim()) return { ok: false, error: '网页没有可读取的正文：' + url }
    const window = sourceWindow(content, anchor)
    return {
      ok: true,
      repo: 'web',
      url: page.url,
      title: (page.title || new URL(page.url).hostname).slice(0, 200),
      sha: createHash('sha256').update(content).digest('hex'),
      text: window.text,
      startLine: window.startLine,
      chars: content.length,
      truncated: page.truncated,
      ...(window.matchedAnchor !== undefined ? { matchedAnchor: window.matchedAnchor } : {}),
      ...(window.locations ? { locations: window.locations } : {}),
      at: now(),
    }
  } catch (e) {
    return { ok: false, error: '网页读取失败：' + message(e) }
  }
}

export function registerOwnerWeb(
  guard: TrustedRendererGuard,
  service: () => Service | null,
  ask: AskMoreWeb,
) {
  registerTrustedIpcContract(ownerWebIpc.status, guard, () => webStatus(service()))
  registerTrustedIpcContract(ownerWebIpc.search, guard, (_e, _id, query) =>
    searchWeb(service(), query),
  )
  registerTrustedIpcContract(ownerWebIpc.fetch, guard, (_e, _id, url, anchor) =>
    fetchWeb(service(), url, anchor),
  )
  registerTrustedIpcContract(ownerWebIpc.more, guard, (_e, _id, conversationId, used, limit) =>
    ask({ conversationId, used, limit }),
  )
}
