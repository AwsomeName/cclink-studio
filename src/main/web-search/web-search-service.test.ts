import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_WEB_SEARCH_SETTINGS, WebSearchService } from './web-search-service'
import { WebSearchToolModule } from '../mcp/modules/web-search'

let dir: string
let agentKey: string | null
let ownKey: string | null
let fetchMock: ReturnType<typeof vi.fn>

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const result = (n: number) => ({
  results: Array.from({ length: n }, (_, i) => ({
    rerank_score: 2,
    title: `结果 ${i}`,
    url: `https://example.com/${i}`,
    snippet: '摘要',
    summary: '较长摘要',
    content: '',
    site_name: 'Example',
    site_icon: null,
    date: null,
    authority: 3,
  })),
})

function create(now = new Date('2026-11-24T10:00:00Z')) {
  return new WebSearchService({
    statePath: join(dir, 'state.json'),
    resolveAgentKey: () => agentKey,
    resolveOwnKey: () => ownKey,
    fetch: fetchMock as unknown as typeof fetch,
    now: () => now,
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'web-search-'))
  agentKey = 'sk-agent'
  ownKey = null
  fetchMock = vi.fn()
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('WebSearchService', () => {
  it('stays disabled by default and refuses calls without contacting DeepSeek', async () => {
    const service = create()
    await service.load()
    expect(service.getStatus()).toMatchObject({ state: 'disabled', agentKeyAvailable: true })
    await expect(service.search({ query: 'x' }, { source: 'codex' })).rejects.toMatchObject({
      code: 'DISABLED',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('verifies with one real search and fetch, then enables and persists', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, result(5)))
      .mockResolvedValueOnce(json(200, { title: 'Docs', content: '# Docs' }))
    const service = create()
    await service.load()
    const verified = await service.verify({ ...DEFAULT_WEB_SEARCH_SETTINGS, enabled: false })
    expect(verified).toMatchObject({ success: true, search: { resultCount: 5 } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/v1/tools/search')
    expect(init.headers.Authorization).toBe('Bearer sk-agent')
    expect(JSON.parse(init.body)).toMatchObject({ query: 'DeepSeek API 文档', count: 5 })
    await service.flush()
    const reloaded = create()
    await reloaded.load()
    expect(reloaded.getStatus()).toMatchObject({
      state: 'ready',
      usage: { search: 1, fetch: 1, bySource: { verify: { search: 1, fetch: 1 } } },
    })
    expect(JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')).settings.enabled).toBe(true)
  })

  it('keeps web search off when verification fails and reports the DeepSeek reason', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { message: 'bad key' } }))
    const service = create()
    await service.load()
    const verified = await service.verify(DEFAULT_WEB_SEARCH_SETTINGS)
    expect(verified.success).toBe(false)
    expect(verified.message).toContain('DeepSeek Key 无效')
    expect(service.getStatus()).toMatchObject({ state: 'disabled', usage: { failed: 1 } })
  })

  it('counts empty results as unbilled and stops at the monthly cap', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/search') ? json(200, result(0)) : json(200, { title: 't', content: 'c' }),
    )
    const service = create()
    await service.load()
    await service.saveSettings({ ...DEFAULT_WEB_SEARCH_SETTINGS, enabled: true, monthlyLimit: 2 })
    expect(await service.search({ query: '无结果' }, { source: 'codex' })).toEqual([])
    await service.fetchPage({ url: 'https://example.com/a' }, { source: 'codex' })
    await service.fetchPage({ url: 'https://example.com/b' }, { source: 'owner' })
    expect(service.getStatus()).toMatchObject({
      state: 'limit-reached',
      usage: { search: 0, fetch: 2, failed: 1 },
    })
    await expect(
      service.fetchPage({ url: 'https://example.com/c' }, { source: 'codex' }),
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('uses the agent key only for DeepSeek and the own key when chosen', async () => {
    agentKey = null
    const service = create()
    await service.load()
    await service.saveSettings({ ...DEFAULT_WEB_SEARCH_SETTINGS, enabled: true })
    expect(service.getStatus()).toMatchObject({ state: 'missing-key' })
    ownKey = 'sk-own'
    await service.saveSettings({ ...DEFAULT_WEB_SEARCH_SETTINGS, enabled: true, keySource: 'own' })
    fetchMock.mockResolvedValueOnce(json(200, result(1)))
    await service.search({ query: 'x' }, { source: 'codex' })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-own')
  })

  it('rejects unsafe fetch URLs and over-long queries locally', async () => {
    const service = create()
    await service.load()
    await service.saveSettings({ ...DEFAULT_WEB_SEARCH_SETTINGS, enabled: true })
    await expect(
      service.fetchPage({ url: 'https://user:pass@example.com' }, { source: 'codex' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      service.fetchPage({ url: 'file:///etc/passwd' }, { source: 'codex' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      service.search({ query: 'x'.repeat(129) }, { source: 'codex' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('WebSearchToolModule visibility', () => {
  it('shows tools only to allowed agents and never in visible-browser tasks', async () => {
    const service = create()
    await service.load()
    const module = new WebSearchToolModule(service)
    expect(module.isVisible({ agentBackend: 'codex' })).toBe(false)
    await service.saveSettings({ ...DEFAULT_WEB_SEARCH_SETTINGS, enabled: true })
    expect(module.isVisible({ agentBackend: 'codex' })).toBe(true)
    expect(module.isVisible({ agentBackend: 'claude-code' })).toBe(false)
    expect(module.isVisible({ agentBackend: 'codex', forceVisibleBrowser: true })).toBe(false)
    expect(module.isVisible({})).toBe(false)
    expect(module.isVisible({ agentBackend: 'codex', webSearchSource: 'owner' })).toBe(false)
    expect(
      module.isVisible({ agentBackend: 'codex', webSearchSource: 'owner', webSearchAllowed: true }),
    ).toBe(true)
    const refused = await module.execute(
      'web_search',
      { query: 'x' },
      { agentBackend: 'claude-code' },
    )
    expect(refused).toMatchObject({ success: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns results with sources for an allowed session', async () => {
    const service = create()
    await service.load()
    await service.saveSettings({ ...DEFAULT_WEB_SEARCH_SETTINGS, enabled: true })
    fetchMock.mockResolvedValueOnce(json(200, result(2)))
    const out = (await new WebSearchToolModule(service).execute(
      'web_search',
      { query: 'AR 眼镜 续航' },
      { agentBackend: 'codex' },
    )) as { success: boolean; resultCount: number; results: Array<{ url: string }> }
    expect(out).toMatchObject({ success: true, resultCount: 2 })
    expect(out.results[0].url).toBe('https://example.com/0')
  })
})
