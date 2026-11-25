import { describe, expect, it, vi } from 'vitest'
import { deepSeekProvider, searxngProvider, searxngSearchUrl } from './search-providers'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('SearXNG provider', () => {
  it('always asks the news category, maps language and never sends time_range', () => {
    const url = new URL(searxngSearchUrl('https://searx.example.com/base/', 'AI 芯片', 'zh'))
    expect(url.pathname).toBe('/base/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'AI 芯片',
      format: 'json',
      categories: 'news',
      language: 'zh-CN',
    })
  })

  it('sends Basic auth, spaces calls per host and returns engines', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        results: [
          { title: 'T', url: 'https://a.com/x', engines: ['bing'], publishedDate: '2026-11-24' },
        ],
      }),
    )
    const sleep = vi.fn(async () => {})
    let clock = 0
    const provider = searxngProvider(
      { baseUrl: 'https://s.example', engines: ['bing'], username: 'u', password: 'p' },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep, now: () => clock, delayMs: 3500 },
    )
    const first = await provider.search('a', 'en', 15)
    clock = 1000
    await provider.search('b', 'en', 15)
    expect(first).toEqual([
      {
        title: 'T',
        url: 'https://a.com/x',
        content: '',
        published: '2026-11-24',
        engines: ['bing'],
      },
    ])
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Basic ' + Buffer.from('u:p').toString('base64'),
    )
    expect(sleep).toHaveBeenCalledWith(2500)
    expect(provider.engineAllowlist).toEqual(['bing'])
  })

  it('backs off on 429 and explains non-JSON and auth failures', async () => {
    const sleep = vi.fn(async () => {})
    const limited = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(json({ results: [] }))
    await expect(
      searxngProvider(
        { baseUrl: 'https://s', engines: ['bing'] },
        { fetchImpl: limited, sleep, delayMs: 0 },
      ).search('q', 'en', 5),
    ).resolves.toEqual([])
    expect(sleep).toHaveBeenCalledWith(3000)

    const html = vi.fn(async () => new Response('<html>', { status: 200 }))
    await expect(
      searxngProvider(
        { baseUrl: 'https://s', engines: ['bing'] },
        { fetchImpl: html, sleep, delayMs: 0 },
      ).search('q', 'en', 5),
    ).rejects.toThrow(/search\.formats/)

    const denied = vi.fn(async () => new Response('', { status: 401 }))
    await expect(
      searxngProvider(
        { baseUrl: 'https://s', engines: ['bing'] },
        { fetchImpl: denied, sleep, delayMs: 0 },
      ).search('q', 'en', 5),
    ).rejects.toThrow(/访问凭证/)
  })
})

describe('DeepSeek provider', () => {
  it('goes through the web search port with source techdaily', async () => {
    const search = vi.fn(async () => [
      { title: 'T', url: 'https://a.com', snippet: '', summary: 'S', date: '2026-11-24' },
    ])
    const items = await deepSeekProvider({ search }).search('LLM release', 'en', 15)
    expect(search).toHaveBeenCalledWith(
      { query: 'LLM release', count: 15 },
      { source: 'techdaily', signal: undefined },
    )
    expect(items[0]).toEqual({
      title: 'T',
      url: 'https://a.com',
      content: 'S',
      published: '2026-11-24',
      engines: null,
    })
  })
})
