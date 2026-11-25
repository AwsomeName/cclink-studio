import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TechDailyService } from './techdaily-service'

let root: string
let data: string
let services: TechDailyService[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'techdaily-space-'))
  data = await mkdtemp(join(tmpdir(), 'techdaily-data-'))
})
afterEach(async () => {
  for (const s of services) s.close()
  services = []
  await rm(root, { recursive: true, force: true })
  await rm(data, { recursive: true, force: true })
})

const WORDS = `enabled: true
search_provider: deepseek
daily_call_limit: 80
domains:
  - id: model_cap
    name: 模型能力
    queries: {zh: ["大模型 发布"], en: ["LLM release"]}
  - id: corp
    name: 科技巨头动态
    match: ["OpenAI"]
    queries: {zh: [], en: ["OpenAI Anthropic Google"]}
`

function make(
  search: (input: { query: string }) => Promise<unknown[]>,
  extra: Partial<ConstructorParameters<typeof TechDailyService>[0]> = {},
) {
  const credentials = new Map<string, Record<string, string>>()
  const service = new TechDailyService({
    dataDirectory: data,
    personalRoot: () => root,
    deepSeek: { search: search as never, unavailableReason: () => null },
    credentials: {
      resolve: (id) => credentials.get(id) ?? null,
      set: async (id, fields) => void credentials.set(id, fields),
      remove: async (id) => void credentials.delete(id),
    },
    credentialId: 'extension:searxng:default',
    timezone: async () => 'Asia/Shanghai',
    now: () => new Date('2026-11-25T02:00:00Z'),
    ...extra,
  })
  services.push(service)
  return { service, credentials }
}

const hit = (title: string, url: string, date: string | null = null) => ({
  title,
  url,
  snippet: '',
  summary: '',
  date,
})

describe('TechDailyService', () => {
  it('only serves My Space', async () => {
    const { service } = make(async () => [])
    await expect(service.getSettings({ workspacePath: '/elsewhere' })).rejects.toThrow(/我的空间/)
  })

  it('collects every query, filters, merges across domains and upserts idempotently', async () => {
    await mkdir(join(root, '科技日报'))
    await writeFile(join(root, '科技日报/设置.yaml'), WORDS)
    const search = vi.fn(async ({ query }: { query: string }) => {
      if (query === '大模型 发布')
        return [
          hit('大模型 发布潮', 'https://a.com/2026/11-24/1.html'),
          hit('百科', 'https://baike.baidu.com/item/x'),
        ]
      if (query === 'LLM release')
        return [hit('New LLM release by OpenAI', 'https://b.com/n?utm_source=x', '2026-11-24')]
      return [
        hit('OpenAI ships', 'https://b.com/n', '2026-11-24'),
        hit('OpenAI undated', 'https://d.com/x'),
        hit('Old OpenAI news', 'https://c.com/2026/10-01/x'),
      ]
    })
    const { service } = make(search)
    const first = await service.collect({ workspacePath: root })
    expect(search).toHaveBeenCalledTimes(3)
    expect(first).toMatchObject({
      requests: 3,
      articles: 2,
      dated: 2,
      inserted: 2,
      updated: 0,
      mergedAcrossDomains: 1,
    })
    expect(first.domains.find((d) => d.id === 'model_cap')).toMatchObject({
      raw: 3,
      denied: 1,
      kept: 2,
    })
    expect(first.domains.find((d) => d.id === 'corp')).toMatchObject({
      stale: 1,
      guarded: 1,
      kept: 0,
    })

    const second = await service.collect({ workspacePath: root })
    expect(second).toMatchObject({ inserted: 0, updated: 2 })
    const status = await service.getStatus({ workspacePath: root })
    expect(status).toMatchObject({
      ready: true,
      callsToday: 6,
      provider: 'deepseek',
      providers: {
        deepseek: { ready: true },
        searxng: { ready: false, reason: 'SearXNG 服务地址未配置' },
      },
    })
  })

  it('stops at the per-run cap and on a provider failure that would repeat', async () => {
    await mkdir(join(root, '科技日报'))
    await writeFile(
      join(root, '科技日报/设置.yaml'),
      WORDS.replace('daily_call_limit: 80', 'daily_call_limit: 2'),
    )
    const capped = await make(async ({ query }: { query: string }) => [
      hit(`${query} 新进展`, `https://a.com/2026/11-24/${encodeURIComponent(query)}`),
    ]).service.collect({ workspacePath: root })
    expect(capped.requests).toBe(2)
    // Results already found in the domain where the cap hit are kept, not dropped.
    expect(capped).toMatchObject({ articles: 2, inserted: 2 })
    expect(capped.domains.map((d) => d.id)).toEqual(['model_cap'])
    expect(capped.stoppedReason).toMatch(/上限 2/)

    const failing = await make(async () => {
      throw new Error('本月已达 2000 次上限，已停止调用')
    }).service.collect({ workspacePath: root })
    expect(failing).toMatchObject({ requests: 1, failedRequests: 1 })
    expect(failing.stoppedReason).toMatch(/上限/)
  })

  it('refuses to collect when the provider is not ready', async () => {
    const { service } = make(async () => [], {
      deepSeek: { search: async () => [], unavailableReason: () => '联网搜索未启用' },
    })
    await expect(service.collect({ workspacePath: root })).rejects.toThrow('联网搜索未启用')
  })

  it('stores SearXNG address on this machine and the password only in credentials', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              { title: 'AI chip news', url: 'https://a.com/2026/11-24/x', engines: ['bing'] },
              { title: 'AI chip other', url: 'https://b.com/x', engines: ['google'] },
            ],
          }),
        ),
    )
    const { service, credentials } = make(async () => [], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const input = {
      baseUrl: 'https://searx.example.com/',
      engines: ['bing'],
      auth: { mode: 'basic' as const, username: 'me', password: 'secret' },
    }
    expect((await service.testSearxng(input)).ok).toBe(true)
    const saved = await service.saveSearxng(input)
    // A test run before saving is kept once the same address is saved.
    expect(saved.lastTest?.allowedCount).toBe(1)
    expect(saved).toMatchObject({
      configured: true,
      baseUrl: 'https://searx.example.com',
      username: 'me',
      hasPassword: true,
    })
    expect(JSON.stringify(saved)).not.toContain('secret')
    const file = await readFile(join(data, 'searxng.json'), 'utf8')
    expect(file).not.toContain('secret')
    expect(credentials.get('extension:searxng:default')).toEqual({
      username: 'me',
      password: 'secret',
    })

    const test = await service.testSearxng({ ...input, auth: { mode: 'keep' } })
    expect(test).toMatchObject({
      ok: true,
      rawCount: 2,
      allowedCount: 1,
      datedCount: 1,
      engines: { bing: 1, google: 1 },
    })
    expect((await service.getSearxng()).lastTest?.allowedCount).toBe(1)

    await service.saveSearxng({ ...input, auth: { mode: 'none' } })
    expect(credentials.has('extension:searxng:default')).toBe(false)
  })
})
