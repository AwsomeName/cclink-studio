import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callAiJson, parseAiJson } from './ai-json'
import { parseArxivAtom } from './frontier-sources'
import { buildReport, renderMarkdown } from './report-markdown'
import { TechDailyService } from './techdaily-service'
import type { TechDailyRun } from '../../shared/techdaily/techdaily-types'

describe('parseAiJson / callAiJson', () => {
  it('strips fences, repairs bare quotes between CJK and finds the outer object', () => {
    expect(parseAiJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(parseAiJson('{"t": "发布"新品"上线"}')).toEqual({ t: '发布「新品「上线' })
    expect(parseAiJson('好的：{"items": []} 以上')).toEqual({ items: [] })
    expect(parseAiJson('不是 JSON')).toBeNull()
  })

  it('retries once with the correction hint, then fails loudly', async () => {
    const ai = vi.fn().mockResolvedValueOnce('oops').mockResolvedValueOnce('{"items": [1]}')
    const { value, calls } = await callAiJson(ai, 'p', 'prompt', (d) =>
      Array.isArray(d.items) ? d : null,
    )
    expect(value.items).toEqual([1])
    expect(calls).toBe(2)
    expect(ai.mock.calls[1][1]).toContain('中文引号')
    await expect(
      callAiJson(
        vi.fn(async () => 'x'),
        'p',
        'q',
        () => null,
      ),
    ).rejects.toThrow(/JSON/)
  })
})

describe('parseArxivAtom', () => {
  it('reads entries inside the window', () => {
    const xml = `<feed><entry><id>http://arxiv.org/abs/2611.1</id><published>2026-11-24T00:00:00Z</published>
      <title>  A   New
      Robot Policy </title><summary>We &amp; they</summary></entry>
      <entry><id>http://arxiv.org/abs/2611.0</id><published>2026-11-01T00:00:00Z</published><title>Old</title><summary>x</summary></entry></feed>`
    expect(parseArxivAtom(xml, '2026-11-20', 3)).toEqual([
      {
        kind: 'paper',
        title: 'A New Robot Policy',
        url: 'https://arxiv.org/abs/2611.1',
        date: '2026-11-24',
        stars: 0,
        raw: 'We & they',
      },
    ])
  })
})

describe('report markdown', () => {
  const picked = [
    {
      slot: 'model_cap#0',
      domain: 'model_cap',
      url: 'https://a.com/1',
      date: '2026-11-25',
      title: 'A',
      sources: 3,
      reason: 'r',
      reportedBefore: null,
    },
    {
      slot: 'corp#1',
      domain: 'corp',
      url: 'https://b.com/2',
      date: null,
      title: 'B',
      sources: 1,
      reason: 'r',
      reportedBefore: '2026-11-23',
    },
  ]
  it('keeps only real slots, strips 头条 wording, dedupes the headline and keeps links', () => {
    const report = buildReport({
      day: '2026-11-25',
      runId: '20261125-061000',
      picked,
      rendered: {
        headline: { slot: 'model_cap#0', title: '今日头条：模型 A 发布', analysis: '解读。' },
        sections: [
          { slot: 'model_cap#0', title: '模型 A 发布', summary: '摘要 A', comment: '点评 A' },
          { slot: 'corp#1', title: '公司 B 新进展', summary: '摘要 B', comment: '' },
          { slot: 'made#9', title: '编造', summary: 'x', comment: 'x' },
        ],
        trend: '趋势一句话',
      },
      domainOrder: [
        { id: 'model_cap', name: '模型能力' },
        { id: 'corp', name: '科技巨头动态' },
      ],
      quick: [
        {
          kind: 'paper',
          title: '中文译题',
          summary: '贡献（原题：X）',
          url: 'https://arxiv.org/abs/1',
        },
      ],
      trendHint: '',
      funnel: { raw: 100, kept: 40, candidates: 30, selected: 0 },
      notes: ['模型能力榜尚未接入'],
    })
    expect(report.funnel.selected).toBe(2)
    const md = renderMarkdown(report)
    expect(md).toContain('# 科技日报 | 11月25日')
    expect(md).toContain('## 模型 A 发布\n\n解读。\n\n[原文](https://a.com/1)（3 个来源）')
    expect(md).not.toContain('今日头条')
    expect(md).not.toContain('编造')
    expect(md).not.toContain('## 模型能力\n')
    expect(md).toContain('## 科技巨头动态')
    expect(md).toContain('*⬆ 前情：2026-11-23 已报道本事件，今日为后续进展*')
    expect(md).toContain('[原文](https://b.com/2) · 日期未知')
    expect(md).toContain(
      '## 论文前沿\n\n- **中文译题** · 贡献（原题：X） [→](https://arxiv.org/abs/1)',
    )
    expect(md).toContain('**今日趋势**：趋势一句话')
    expect(md).toContain(
      '原始 100 → 过滤后 40 → 候选 30 → 精选 2（run 20261125-061000）；模型能力榜尚未接入',
    )
  })
})

describe('TechDailyService.generate', () => {
  let root: string
  let data: string
  let service: TechDailyService | null = null
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'techdaily-gen-space-'))
    data = await mkdtemp(join(tmpdir(), 'techdaily-gen-data-'))
    await mkdir(join(root, '科技日报'))
    await writeFile(
      join(root, '科技日报/设置.yaml'),
      `domains:
  - id: model_cap
    name: 模型能力
    queries: {zh: ["大模型 发布"], en: ["LLM release"]}
taste:
  blacklist_brands: ["华为"]
  preferences: "- 只要产品"
`,
    )
  })
  afterEach(async () => {
    service?.close()
    service = null
    await rm(root, { recursive: true, force: true })
    await rm(data, { recursive: true, force: true })
  })

  const make = (ai: (purpose: string, prompt: string) => Promise<string>, hits = 6) => {
    service = new TechDailyService({
      dataDirectory: data,
      personalRoot: () => root,
      deepSeek: {
        search: async ({ query }) =>
          Array.from({ length: hits }, (_, i) => ({
            title: `${query} 第${i}条`,
            url: `https://n.com/2026/11-25/${encodeURIComponent(query)}-${i}.html`,
            snippet: '摘要',
            summary: '',
            date: null,
          })),
        unavailableReason: () => null,
      },
      credentials: { resolve: () => null, set: async () => {}, remove: async () => {} },
      credentialId: 'extension:searxng:default',
      timezone: async () => 'Asia/Shanghai',
      now: () => new Date('2026-11-25T02:00:00Z'),
      // GitHub/arXiv unreachable: the quick lists are skipped, the report is not blocked.
      fetchImpl: (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
      fetchPage: async () => '原文正文',
      ai,
    })
    return service
  }
  const settle = async (s: TechDailyService): Promise<TechDailyRun> => {
    for (let i = 0; i < 200; i++) {
      const run = await s.getRun({ workspacePath: root, day: '2026-11-25' })
      if (run && run.status !== 'running') return run
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('run did not finish')
  }

  it('runs the 10 steps from real events and writes 科技日报/2026/11/1125.md', async () => {
    const ai = vi.fn(async (purpose: string, prompt: string) => {
      if (purpose === 'techdaily-select') {
        expect(prompt).toContain('一律不选（黑名单品牌')
        expect(prompt).toContain('- 只要产品')
        return JSON.stringify({
          items: [
            { rep: 0, also: [1, 2], reason: '重要' },
            { rep: 3, also: [], reason: '次要' },
            { rep: 99 },
          ],
          trend_hint: '提示',
        })
      }
      expect(prompt).toContain('原文正文')
      const slots = [...prompt.matchAll(/槽位 (\S+#\d+)/g)].map((m) => m[1])
      return JSON.stringify({
        headline: { slot: slots[0], title: '头条：甲', analysis: '解读甲' },
        sections: slots.map((slot, i) => ({
          slot,
          title: `条目${i}`,
          summary: `摘要${i}`,
          comment: `点评${i}`,
        })),
        trend: '今天的趋势',
      })
    })
    const s = make(ai)
    const started = await s.generate({ workspacePath: root, overwrite: false })
    expect(started.status).toBe('running')
    expect(started.steps).toHaveLength(10)
    await expect(s.generate({ workspacePath: root, overwrite: false })).rejects.toThrow(/正在进行/)
    const run = await settle(s)
    expect(run.status).toBe('completed')
    expect(run.steps.map((step) => step.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
      'done',
      'skipped',
      'done',
    ])
    expect(run.steps.find((x) => x.id === 'search')!.detail).toMatch(
      /2 次搜索 → 原始 12 条，过滤后留下 12 篇/,
    )
    expect(run.steps.find((x) => x.id === 'select')!.detail).toBe('入选 2 条；同事件归并 2 条')
    expect(run.steps.find((x) => x.id === 'leaderboard')!.detail).toMatch(/尚未接入/)
    const md = await readFile(join(root, '科技日报/2026/11/1125.md'), 'utf8')
    expect(md).toContain('## 甲\n\n解读甲')
    expect(md).toContain('（3 个来源）')
    expect(md).toContain('**今日趋势**：今天的趋势')
    const month = await s.listMonth({ workspacePath: root, month: '2026-11' })
    expect(Object.keys(month.days)).toEqual(['2026-11-25'])
    expect(month.today).toBe('2026-11-25')

    // Same day again needs explicit overwrite.
    await expect(s.generate({ workspacePath: root, overwrite: false })).rejects.toThrow(
      /已有科技日报/,
    )
  })

  it('writes a short report when candidates are too few and fails visibly when AI JSON is bad', async () => {
    const few = make(async () => '{}', 2)
    await few.generate({ workspacePath: root, overwrite: false })
    const empty = await settle(few)
    expect(empty.status).toBe('empty')
    expect(await readFile(join(root, '科技日报/2026/11/1125.md'), 'utf8')).toContain(
      '候选不足（4 条',
    )
    few.close()

    const bad = make(async () => '这不是 JSON')
    await bad.generate({ workspacePath: root, overwrite: true })
    const failed = await settle(bad)
    expect(failed.status).toBe('failed')
    expect(failed.steps.find((x) => x.id === 'select')).toMatchObject({ state: 'failed' })
    expect(failed.steps.find((x) => x.id === 'render')!.state).toBe('skipped')
    expect(failed.error).toMatch(/JSON/)
  })

  it('marks a run file left running as interrupted', async () => {
    const s = make(async () => '{}')
    await mkdir(join(data, 'runs', '2026-11-24'), { recursive: true })
    await writeFile(
      join(data, 'runs', '2026-11-24', 'run.json'),
      JSON.stringify({
        day: '2026-11-24',
        runId: 'x',
        status: 'running',
        startedAt: '',
        steps: [],
      }),
    )
    expect((await s.getRun({ workspacePath: root, day: '2026-11-24' }))!.status).toBe('interrupted')
  })
})
