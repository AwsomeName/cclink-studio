import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { fetchWeb, searchWeb, webStatus } from './web-evidence'

const service = (patch: Record<string, unknown> = {}) =>
  ({
    isAvailableFor: () => true,
    getStatus: () => ({ state: 'ready' }),
    search: vi.fn(async () => [
      {
        title: 'Pulse',
        url: 'https://github.com/lowRISC/ibex/pulse',
        snippet: '活跃',
        summary: '',
      },
      { title: 'bad', url: 'ftp://example.org/x', snippet: '', summary: '' },
    ]),
    fetchPage: vi.fn(async () => ({
      url: 'https://github.com/lowRISC/ibex/pulse',
      title: 'Pulse',
      content: '标题\r\n本月合并了 23 个拉取请求。\r\n结尾',
      truncated: false,
    })),
    ...patch,
  }) as never

describe('Owner web evidence channel', () => {
  it('explains why the web is closed for Owner', () => {
    expect(webStatus(null).ready).toBe(false)
    const closed = webStatus(
      service({ isAvailableFor: () => false, getStatus: () => ({ state: 'ready' }) }),
    )
    expect(closed.reason).toMatch(/没有对 Owner 开放/)
    const off = webStatus(
      service({ isAvailableFor: () => false, getStatus: () => ({ state: 'disabled' }) }),
    )
    expect(off.reason).toMatch(/联网搜索未启用/)
  })

  it('searches as Owner and keeps only http(s) hits', async () => {
    const s = service()
    const result = await searchWeb(s, 'Ibex maintenance')
    expect(result).toEqual({
      ok: true,
      hits: [{ url: 'https://github.com/lowRISC/ibex/pulse', title: 'Pulse', snippet: '活跃' }],
    })
    expect((s as { search: ReturnType<typeof vi.fn> }).search).toHaveBeenCalledWith(
      { query: 'Ibex maintenance', count: 10 },
      { source: 'owner' },
    )
  })

  it('hashes the whole page and returns the window around the anchor', async () => {
    const page = await fetchWeb(service(), 'https://github.com/lowRISC/ibex/pulse', '合并', () => 7)
    const whole = '标题\n本月合并了 23 个拉取请求。\n结尾'
    expect(page).toMatchObject({
      ok: true,
      repo: 'web',
      sha: createHash('sha256').update(whole).digest('hex'),
      startLine: 1,
      chars: whole.length,
      matchedAnchor: true,
      at: 7,
    })
    expect(page.ok && page.text).toContain('本月合并了 23 个拉取请求。')
  })

  it('reports failures instead of throwing', async () => {
    const s = service({
      fetchPage: vi.fn(async () => {
        throw new Error('超时')
      }),
    })
    expect(await fetchWeb(s, 'https://example.org', '')).toEqual({
      ok: false,
      error: '网页读取失败：超时',
    })
  })
})
