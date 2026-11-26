/**
 * 模型能力榜 (docs/features/personal-techdaily.md §8), after Argus `leaderboard_sources.py`.
 *
 * Ranks come only from public leaderboard pages read directly over HTTPS (no search service,
 * no AI): each task takes one table, sorts by its score (WER ascending, everything else
 * descending), keeps one model per family and shows the top 5. A page that fails or no longer
 * parses keeps the task's previous rows from `科技日报/榜单.json`, marked with the old date.
 */
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { TECHDAILY_DIRECTORY } from '../../shared/techdaily/techdaily-types'

export const LEADERBOARD_FILE = `${TECHDAILY_DIRECTORY}/榜单.json`
export const LEADERBOARD_TOP = 5
const MIN_ROWS = 3
const USER_AGENT = 'CCLinkStudio-TechDaily/1.0 (+model-leaderboard; one polite fetch per day)'

type Unit = 'pct' | 'score' | 'elo' | 'wer'
type Parser = 'llmstats' | 'aa-elo' | 'aa-wer'

interface TaskSource {
  task: string
  url: string
  site: string
  /** What the score means, shown under the table. */
  label: string
  parser: Parser
  /** Header of the score column. */
  column: string
  unit: Unit
}

/** Order = order in the report. 具身智能 has no readable public leaderboard (Argus 2026-09-28). */
export const TASK_SOURCES: readonly TaskSource[] = [
  {
    task: '代码',
    url: 'https://llm-stats.com/benchmarks/swe-bench-verified',
    site: 'llm-stats.com',
    label: 'SWE-bench Verified 通过率',
    parser: 'llmstats',
    column: 'Score',
    unit: 'pct',
  },
  {
    task: 'Agent',
    url: 'https://llm-stats.com/',
    site: 'llm-stats.com',
    label: 'LLM Stats Agent 分',
    parser: 'llmstats',
    column: 'Agent',
    unit: 'score',
  },
  {
    task: '多模态',
    url: 'https://llm-stats.com/benchmarks/mmmu-pro',
    site: 'llm-stats.com',
    label: 'MMMU-Pro 得分',
    parser: 'llmstats',
    column: 'Score',
    unit: 'pct',
  },
  {
    task: '图片生成',
    url: 'https://artificialanalysis.ai/image/leaderboard/text-to-image',
    site: 'artificialanalysis.ai',
    label: '文生图竞技场 Elo',
    parser: 'aa-elo',
    column: 'Elo',
    unit: 'elo',
  },
  {
    task: '视频生成',
    url: 'https://artificialanalysis.ai/video/leaderboard/text-to-video',
    site: 'artificialanalysis.ai',
    label: '文生视频竞技场 Elo',
    parser: 'aa-elo',
    column: 'Elo',
    unit: 'elo',
  },
  {
    task: 'ASR',
    url: 'https://artificialanalysis.ai/speech-to-text/non-streaming',
    site: 'artificialanalysis.ai',
    label: '语音转写词错率 WER（越低越好）',
    parser: 'aa-wer',
    column: 'Word Error Rate %',
    unit: 'wer',
  },
]

const rowSchema = z.object({
  model: z.string().min(1).max(120),
  org: z.string().max(80),
  score: z.number().finite(),
  scoreText: z.string().max(40),
})
const taskSchema = z.object({
  label: z.string().max(80),
  site: z.string().max(80),
  url: z.string().max(300),
  /** Day the rows were read from the site, YYYY-MM-DD. */
  fetchedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z.array(rowSchema).max(20),
})
const fileSchema = z.object({
  version: z.literal(1),
  updatedOn: z.string(),
  tasks: z.record(z.string(), taskSchema),
})
export type LeaderboardRow = z.infer<typeof rowSchema>
export type LeaderboardTask = z.infer<typeof taskSchema>
export type LeaderboardFile = z.infer<typeof fileSchema>

/** One table in today's report. */
export interface LeaderboardSection {
  task: string
  label: string
  site: string
  url: string
  fetchedOn: string
  /** True when today's fetch failed and these are the previous rows. */
  stale: boolean
  rows: Array<LeaderboardRow & { change: string }>
}

// ── HTML parsing ──

const decode = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
const text = (html: string): string =>
  decode(html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** First `<table>` as header names and raw cell HTML per row. */
export function readTable(html: string): { heads: string[]; rows: string[][] } | null {
  const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0]
  if (!table) return null
  const heads = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]))
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]))
    .filter((cells) => cells.length)
  return { heads, rows }
}

const altOrg = (cell: string): string =>
  decode(/<img[^>]*\balt="([^"]*)"/.exec(cell)?.[1] ?? '')
    .replace(/\s*logo$/i, '')
    .trim()

function modelCell(parser: Parser, cell: string): { model: string; org: string } {
  if (parser === 'llmstats') {
    const model = /<a[^>]*href="\/models\/[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(cell)?.[1]
    return { model: model ? text(model) : text(cell), org: altOrg(cell) }
  }
  if (parser === 'aa-elo') {
    const model = /<span[^>]*>([\s\S]*?)<\/span>/.exec(cell)?.[1]
    return { model: model ? text(model) : text(cell), org: altOrg(cell) }
  }
  return { model: text(cell), org: '' }
}

function scoreOf(unit: Unit, cell: string): number | null {
  const match = /-?\d+(?:\.\d+)?/.exec(text(cell).replace(/,/g, ''))
  if (!match) return null
  const value = Number(match[0])
  if (!Number.isFinite(value)) return null
  // llm-stats benchmark pages print 0.950 for 95.0%.
  return unit === 'pct' && value <= 1 ? value * 100 : value
}

export const scoreText = (unit: Unit, score: number): string =>
  unit === 'pct' || unit === 'wer'
    ? `${score.toFixed(unit === 'wer' ? 2 : 1)}%`
    : unit === 'elo'
      ? String(Math.round(score))
      : score.toFixed(1)

/** Name tokens without version numbers, sizes, "preview" and variants in parentheses. */
export function familyTokens(model: string): string[] {
  const tokens = model
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s\-_/,]+/)
    .filter((t) => t && !/\d/.test(t) && t !== 'preview')
  return tokens.length ? tokens : [model.toLowerCase()]
}

/**
 * Same family = same maker and one name is the other's prefix once versions are dropped:
 * "Claude Opus 4.8" / "Claude Opus 5.5", "GPT Image 2 (high)" / "GPT Image 2.6 Sunburst".
 * Only the better-ranked member is shown, so a board is not five versions of one model.
 */
export function sameFamily(
  a: Pick<LeaderboardRow, 'model' | 'org'>,
  b: Pick<LeaderboardRow, 'model' | 'org'>,
): boolean {
  if (a.org && b.org && a.org !== b.org) return false
  const [x, y] = [familyTokens(a.model), familyTokens(b.model)]
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.every((t, i) => long[i] === t)
}

/** Rows ranked by the task's score, one per family, top N. Throws when the page no longer fits. */
export function parseTask(
  source: TaskSource,
  html: string,
  top = LEADERBOARD_TOP,
): LeaderboardRow[] {
  const table = readTable(html)
  if (!table) throw new Error('页面里没有表格')
  const scoreAt = table.heads.findIndex((h) => h === source.column)
  const modelAt = table.heads.findIndex((h) => h === 'Model')
  const providerAt = table.heads.findIndex((h) => h === 'Provider')
  if (scoreAt < 0 || modelAt < 0) throw new Error(`表头里没有 ${source.column} / Model 列`)
  const rows: LeaderboardRow[] = []
  for (const cells of table.rows) {
    if (cells.length <= Math.max(scoreAt, modelAt)) continue
    const score = scoreOf(source.unit, cells[scoreAt])
    const { model, org: makerOrg } = modelCell(source.parser, cells[modelAt])
    const org = makerOrg || (providerAt >= 0 && cells[providerAt] ? text(cells[providerAt]) : '')
    if (score === null || !model || model.length > 120) continue
    rows.push({ model, org: org.slice(0, 80), score, scoreText: scoreText(source.unit, score) })
  }
  rows.sort((a, b) => (source.unit === 'wer' ? a.score - b.score : b.score - a.score))
  const kept: LeaderboardRow[] = []
  for (const row of rows) if (!kept.some((k) => sameFamily(k, row))) kept.push(row)
  if (kept.length < MIN_ROWS) throw new Error(`只解析出 ${kept.length} 行，页面结构可能变了`)
  return kept.slice(0, top)
}

/** "↑2" / "↓1" / "—" against the previous ranking; "新上榜" when the model was not in it. */
export function rankChange(model: string, rank: number, previous?: LeaderboardRow[]): string {
  if (!previous?.length) return ''
  const before = previous.findIndex((r) => r.model === model)
  if (before < 0) return '新上榜'
  if (before === rank) return '—'
  return before > rank ? `↑${before - rank}` : `↓${rank - before}`
}

// ── 榜单.json ──

export async function readLeaderboard(
  root: string,
): Promise<{ file: LeaderboardFile | null; error?: string }> {
  let raw: string
  try {
    raw = await readFile(join(root, LEADERBOARD_FILE), 'utf8')
  } catch {
    return { file: null }
  }
  try {
    return { file: fileSchema.parse(JSON.parse(raw)) }
  } catch {
    return { file: null, error: '榜单.json 无法读取（格式不对），本次不覆盖它' }
  }
}

async function writeLeaderboard(root: string, file: LeaderboardFile): Promise<void> {
  const target = join(root, LEADERBOARD_FILE)
  await mkdir(dirname(target), { recursive: true })
  const info = await lstat(join(root, TECHDAILY_DIRECTORY))
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('科技日报目录不是普通目录')
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(file, null, 2) + '\n', 'utf8')
  await rename(temporary, target)
}

export interface LeaderboardUpdate {
  sections: LeaderboardSection[]
  fresh: number
  stale: number
  failures: string[]
  /** Set when 榜单.json exists but could not be read; it was left untouched. */
  fileError?: string
}

/**
 * Reads every source page (sequential, 1.2 s apart), ranks it, compares with the previous
 * 榜单.json and writes the new one. Never throws for a site problem: that task keeps its old rows.
 */
export async function updateLeaderboard(options: {
  root: string
  day: string
  fetchImpl: typeof fetch
  sleep: (ms: number) => Promise<void>
  signal?: AbortSignal
  progress?: (detail: string) => void
}): Promise<LeaderboardUpdate> {
  const { file: previous, error: fileError } = await readLeaderboard(options.root)
  const sections: LeaderboardSection[] = []
  const failures: string[] = []
  const next: LeaderboardFile = { version: 1, updatedOn: options.day, tasks: {} }
  let index = 0
  for (const source of TASK_SOURCES) {
    if (options.signal?.aborted) break
    if (index++) await options.sleep(1200)
    options.progress?.(`读取 ${source.task} 榜（${index}/${TASK_SOURCES.length}）${source.site}…`)
    const before = previous?.tasks[source.task]
    try {
      const response = await options.fetchImpl(source.url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: options.signal ?? AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const rows = parseTask(source, await response.text())
      next.tasks[source.task] = {
        label: source.label,
        site: source.site,
        url: source.url,
        fetchedOn: options.day,
        rows,
      }
      sections.push({
        task: source.task,
        label: source.label,
        site: source.site,
        url: source.url,
        fetchedOn: options.day,
        stale: false,
        rows: rows.map((r, rank) => ({ ...r, change: rankChange(r.model, rank, before?.rows) })),
      })
    } catch (error) {
      failures.push(`${source.task}：${(error as Error).message || '读取失败'}`)
      if (before) {
        next.tasks[source.task] = before
        sections.push({
          task: source.task,
          label: before.label,
          site: before.site,
          url: before.url,
          fetchedOn: before.fetchedOn,
          stale: true,
          rows: before.rows.map((r) => ({ ...r, change: '' })),
        })
      }
    }
  }
  // Keep tasks this version does not fetch (e.g. rows a person added by hand).
  for (const [task, value] of Object.entries(previous?.tasks ?? {}))
    if (!next.tasks[task]) next.tasks[task] = value
  const fresh = sections.filter((s) => !s.stale).length
  if (!fileError && fresh) await writeLeaderboard(options.root, next)
  return { sections, fresh, stale: sections.length - fresh, failures, fileError }
}

export function renderLeaderboardMarkdown(sections: LeaderboardSection[]): string[] {
  if (!sections.length) return []
  const lines = ['## 模型能力榜', '']
  for (const s of sections) {
    lines.push(
      `### ${s.task}`,
      '',
      '| # | 模型 | 机构 | 得分 | 变化 |',
      '| --- | --- | --- | --- | --- |',
    )
    s.rows.forEach((r, i) =>
      lines.push(
        `| ${i + 1} | ${r.model.replace(/\|/g, '/')} | ${r.org.replace(/\|/g, '/') || '—'} | ${r.scoreText} | ${r.change || '—'} |`,
      ),
    )
    lines.push(
      '',
      `*口径：${s.label} · 数据源 [${s.site}](${s.url})（${s.fetchedOn} 抓取${s.stale ? '，今日读取失败，沿用旧数据' : ''}）*`,
      '',
    )
  }
  lines.push('*具身智能暂无可抓取的公开榜单，未列出。*', '')
  return lines
}
