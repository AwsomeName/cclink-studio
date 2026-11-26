import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LEADERBOARD_FILE,
  TASK_SOURCES,
  parseTask,
  rankChange,
  renderLeaderboardMarkdown,
  sameFamily,
  updateLeaderboard,
} from './leaderboard'

const source = (task: string) => TASK_SOURCES.find((s) => s.task === task)!

// Shapes copied from the live pages (2026-11-26), trimmed to what the parser reads.
const llmStatsBench = (rows: Array<[string, string, string]>) =>
  `<html><table><thead><tr><th>#</th><th>Model</th><th>Score</th><th>Size</th></tr></thead><tbody>${rows
    .map(
      ([model, org, score], i) =>
        `<tr><td>${i + 1}</td><td><div><img alt="${org}" src="/x.svg"/><div><div><a class="x" href="/models/${model.toLowerCase().replace(/ /g, '-')}">${model}</a></div><div>${org}</div></div></div></td><td>${score}</td><td>—</td></tr>`,
    )
    .join('')}</tbody></table></html>`
const aaElo = (rows: Array<[string, string, string]>) =>
  `<table><tr><th></th><th>Range</th><th>Model</th><th>Elo</th></tr>${rows
    .map(
      ([model, org, elo], i) =>
        `<tr><td>${i + 1}</td><td>1</td><td><div><img alt="${org} logo"/><div><span data-state="closed">${model}</span><button><svg><path d="M1"/></svg></button></div></div></td><td>${elo} ±12 95% interval</td></tr>`,
    )
    .join('')}</table>`
const aaWer = (rows: Array<[string, string, string]>) =>
  `<table><tr><th>Model</th><th>Provider</th><th>Whisper Version</th><th>Word Error Rate %</th></tr>${rows
    .map(([m, p, w]) => `<tr><td><div>${m}</div></td><td>${p}</td><td></td><td>${w}</td></tr>`)
    .join('')}</table>`

describe('leaderboard parsing', () => {
  it('reads llm-stats benchmark pages as percentages and keeps one model per family', () => {
    const rows = parseTask(
      source('代码'),
      llmStatsBench([
        ['Claude Fable 5', 'Anthropic', '0.950'],
        ['Claude Opus 5.5', 'Anthropic', '0.900'],
        ['Claude Opus 4.8', 'Anthropic', '0.886'],
        ['GPT-6.1 Sol', 'OpenAI', '0.880'],
        ['Kimi K3 &amp; Tools', 'Moonshot AI', '0.700'],
      ]),
    )
    expect(rows.map((r) => [r.model, r.org, r.scoreText])).toEqual([
      ['Claude Fable 5', 'Anthropic', '95.0%'],
      ['Claude Opus 5.5', 'Anthropic', '90.0%'],
      ['GPT-6.1 Sol', 'OpenAI', '88.0%'],
      ['Kimi K3 & Tools', 'Moonshot AI', '70.0%'],
    ])
  })

  it('ranks Elo descending and WER ascending, with the maker from the logo or Provider column', () => {
    const image = parseTask(
      source('图片生成'),
      aaElo([
        ['GPT Image 2 (high)', 'OpenAI', '1196'],
        ['GPT Image 2.6 Sunburst (max)', 'OpenAI', '1,264'],
        ['MAI-Image-2.7', 'Microsoft AI', '1216'],
        ['Kling Image 4.0', 'KlingAI', '1181'],
      ]),
    )
    expect(image.map((r) => `${r.model}|${r.org}|${r.scoreText}`)).toEqual([
      'GPT Image 2.6 Sunburst (max)|OpenAI|1264',
      'MAI-Image-2.7|Microsoft AI|1216',
      'Kling Image 4.0|KlingAI|1181',
    ])
    const asr = parseTask(
      source('ASR'),
      aaWer([
        ['Nova 2 Pro', 'Amazon Bedrock', '4.86%'],
        ['Scribe v3, ElevenLabs', 'ElevenLabs', '1.95%'],
        ['Qwen3.5 Omni Flash', 'Alibaba Cloud', '13.52%'],
      ]),
    )
    expect(asr.map((r) => `${r.model}|${r.org}|${r.scoreText}`)).toEqual([
      'Scribe v3, ElevenLabs|ElevenLabs|1.95%',
      'Nova 2 Pro|Amazon Bedrock|4.86%',
      'Qwen3.5 Omni Flash|Alibaba Cloud|13.52%',
    ])
  })

  it('refuses a page whose table no longer fits instead of ranking garbage', () => {
    expect(() => parseTask(source('代码'), '<html>no table</html>')).toThrow(/没有表格/)
    expect(() =>
      parseTask(source('代码'), '<table><tr><th>Name</th><th>Value</th></tr></table>'),
    ).toThrow(/表头里没有/)
    expect(() => parseTask(source('代码'), llmStatsBench([['Only One', 'X', '0.5']]))).toThrow(
      /只解析出 1 行/,
    )
  })

  it('families need the same maker and a shared name prefix', () => {
    expect(
      sameFamily(
        { model: 'Claude Opus 4.8', org: 'Anthropic' },
        { model: 'Claude Opus 5.5', org: 'Anthropic' },
      ),
    ).toBe(true)
    expect(
      sameFamily(
        { model: 'Claude Fable 5', org: 'Anthropic' },
        { model: 'Claude Mythos Preview', org: 'Anthropic' },
      ),
    ).toBe(false)
    expect(
      sameFamily({ model: 'Wan 3.0', org: 'Alibaba' }, { model: 'Wan 2.5', org: 'Other' }),
    ).toBe(false)
  })

  it('reports rank change against the previous board', () => {
    const before = [
      { model: 'A', org: '', score: 3, scoreText: '3' },
      { model: 'B', org: '', score: 2, scoreText: '2' },
    ]
    expect(rankChange('B', 0, before)).toBe('↑1')
    expect(rankChange('A', 1, before)).toBe('↓1')
    expect(rankChange('A', 0, before)).toBe('—')
    expect(rankChange('C', 2, before)).toBe('新上榜')
    expect(rankChange('C', 2, undefined)).toBe('')
  })
})

describe('updateLeaderboard', () => {
  let root = ''
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'techdaily-board-'))
    await mkdir(join(root, '科技日报'))
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  const pages: Record<string, string> = {
    'https://llm-stats.com/benchmarks/swe-bench-verified': llmStatsBench([
      ['Model B', 'Org B', '0.91'],
      ['Model A', 'Org A', '0.90'],
      ['Model C', 'Org C', '0.80'],
    ]),
  }
  const fetchImpl = (async (url: string) =>
    pages[url]
      ? new Response(pages[url], { status: 200 })
      : new Response('', { status: 503 })) as unknown as typeof fetch

  it('writes 榜单.json, shows rank changes and keeps old rows for a site that fails', async () => {
    await writeFile(
      join(root, LEADERBOARD_FILE),
      JSON.stringify({
        version: 1,
        updatedOn: '2026-11-25',
        tasks: {
          代码: {
            label: 'x',
            site: 'llm-stats.com',
            url: 'u',
            fetchedOn: '2026-11-25',
            rows: [
              { model: 'Model A', org: 'Org A', score: 90, scoreText: '90.0%' },
              { model: 'Model B', org: 'Org B', score: 89, scoreText: '89.0%' },
            ],
          },
          ASR: {
            label: 'WER',
            site: 'artificialanalysis.ai',
            url: 'u2',
            fetchedOn: '2026-11-20',
            rows: [{ model: 'Old ASR', org: 'X', score: 3, scoreText: '3.00%' }],
          },
          手工榜: { label: 'm', site: 's', url: 'u3', fetchedOn: '2026-11-01', rows: [] },
        },
      }),
    )
    const slept: number[] = []
    const result = await updateLeaderboard({
      root,
      day: '2026-11-26',
      fetchImpl,
      sleep: async (ms) => void slept.push(ms),
    })
    expect(slept).toEqual([1200, 1200, 1200, 1200, 1200])
    expect(result.fresh).toBe(1)
    expect(result.stale).toBe(1)
    expect(result.failures).toHaveLength(5)
    const code = result.sections.find((s) => s.task === '代码')!
    expect(code.rows.map((r) => `${r.model}:${r.change}`)).toEqual([
      'Model B:↑1',
      'Model A:↓1',
      'Model C:新上榜',
    ])
    const asr = result.sections.find((s) => s.task === 'ASR')!
    expect(asr).toMatchObject({ stale: true, fetchedOn: '2026-11-20' })
    const saved = JSON.parse(await readFile(join(root, LEADERBOARD_FILE), 'utf8'))
    expect(saved.updatedOn).toBe('2026-11-26')
    expect(saved.tasks['代码'].rows[0].model).toBe('Model B')
    expect(saved.tasks['ASR'].fetchedOn).toBe('2026-11-20')
    expect(saved.tasks['手工榜']).toBeTruthy()
    const md = renderLeaderboardMarkdown(result.sections).join('\n')
    expect(md).toContain('## 模型能力榜')
    expect(md).toContain('| 1 | Model B | Org B | 91.0% | ↑1 |')
    expect(md).toContain('2026-11-20 抓取，今日读取失败，沿用旧数据')
  })

  it('leaves an unreadable 榜单.json untouched', async () => {
    await writeFile(join(root, LEADERBOARD_FILE), '{ 手改坏了')
    const result = await updateLeaderboard({
      root,
      day: '2026-11-26',
      fetchImpl,
      sleep: async () => {},
    })
    expect(result.fileError).toMatch(/本次不覆盖/)
    expect(result.fresh).toBe(1)
    expect(await readFile(join(root, LEADERBOARD_FILE), 'utf8')).toBe('{ 手改坏了')
  })
})
