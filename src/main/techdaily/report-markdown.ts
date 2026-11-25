/**
 * Report assembly and Markdown, after Argus `_build_report` / `render_markdown`.
 * URLs, dates and source counts come from candidates; the AI only writes words, and any
 * slot the AI invents is dropped.
 */

export interface PickedItem {
  slot: string
  domain: string
  url: string
  date: string | null
  title: string
  sources: number
  reason: string
  reportedBefore: string | null
}

export interface RenderedSection {
  slot: string
  title: string
  summary: string
  comment: string
}

export interface ReportItem extends PickedItem {
  summary: string
  comment: string
}

export interface QuickItem {
  kind: 'open_source' | 'paper'
  title: string
  summary: string
  url: string
}

export interface DailyReport {
  day: string
  runId: string
  headline: { slot: string; title: string; analysis: string } | null
  sections: Array<{ domain: string; name: string; items: ReportItem[] }>
  quick: QuickItem[]
  trend: string
  funnel: { raw: number; kept: number; candidates: number; selected: number }
  notes: string[]
}

export function buildReport(input: {
  day: string
  runId: string
  picked: PickedItem[]
  rendered: {
    headline?: { slot?: unknown; title?: unknown; analysis?: unknown }
    sections?: unknown
    trend?: unknown
  }
  domainOrder: Array<{ id: string; name: string }>
  quick: QuickItem[]
  trendHint: string
  funnel: DailyReport['funnel']
  notes: string[]
}): DailyReport {
  const bySlot = new Map(input.picked.map((p) => [p.slot, p]))
  const sections = new Map<string, ReportItem[]>()
  const rendered = Array.isArray(input.rendered.sections) ? input.rendered.sections : []
  for (const raw of rendered) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const pick = bySlot.get(String(s.slot ?? ''))
    if (!pick) continue // invented slot
    const item: ReportItem = {
      ...pick,
      title: String(s.title || pick.title).trim(),
      summary: String(s.summary ?? '').trim(),
      comment: String(s.comment ?? '').trim(),
    }
    const list = sections.get(pick.domain) ?? []
    if (!list.some((i) => i.slot === item.slot)) list.push(item)
    sections.set(pick.domain, list)
  }
  const h = input.rendered.headline
  const headlineSlot = String(h?.slot ?? '')
  const headline =
    h && bySlot.has(headlineSlot) && String(h.title ?? '').trim()
      ? {
          slot: headlineSlot,
          title: String(h.title)
            .replace(/^(今日)?头条[:：]\s*/, '')
            .trim(),
          analysis: String(h.analysis ?? '').trim(),
        }
      : null
  const names = new Map(input.domainOrder.map((d) => [d.id, d.name]))
  const order = [...input.domainOrder.map((d) => d.id), ...sections.keys()]
  const ordered = [...new Set(order)]
    .filter((id) => sections.has(id))
    .map((id) => ({ domain: id, name: names.get(id) ?? id, items: sections.get(id)! }))
  const selected = ordered.reduce((n, s) => n + s.items.length, 0)
  return {
    day: input.day,
    runId: input.runId,
    headline,
    sections: ordered,
    quick: input.quick,
    trend: String(input.rendered.trend || input.trendHint || '').trim(),
    funnel: { ...input.funnel, selected },
    notes: input.notes,
  }
}

const monthDay = (day: string): string => `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`
const sourceNote = (n: number): string => (n > 1 ? `（${n} 个来源）` : '')

export function renderMarkdown(report: DailyReport): string {
  const lines = [`# 科技日报 | ${monthDay(report.day)}`, '']
  const headlineItem = report.headline
    ? report.sections.flatMap((s) => s.items).find((i) => i.slot === report.headline!.slot)
    : undefined
  if (report.headline) {
    lines.push(`## ${report.headline.title}`, '', report.headline.analysis)
    if (headlineItem)
      lines.push('', `[原文](${headlineItem.url})${sourceNote(headlineItem.sources)}`)
    lines.push('')
  }
  for (const section of report.sections) {
    const shown = section.items.filter((i) => i.slot !== report.headline?.slot)
    if (!shown.length) continue
    lines.push(`## ${section.name}`, '')
    for (const item of shown) {
      lines.push(`**${item.title}**`, '')
      if (item.reportedBefore && item.reportedBefore !== report.day)
        lines.push(`*⬆ 前情：${item.reportedBefore} 已报道本事件，今日为后续进展*`, '')
      if (item.summary) lines.push(item.summary, '')
      if (item.comment) lines.push(`> 点评：${item.comment}`, '')
      lines.push(`[原文](${item.url})${sourceNote(item.sources)} · ${item.date ?? '日期未知'}`, '')
    }
  }
  for (const [kind, name] of [
    ['open_source', '开源热点'],
    ['paper', '论文前沿'],
  ] as const) {
    const items = report.quick.filter((q) => q.kind === kind)
    if (!items.length) continue
    lines.push(`## ${name}`, '')
    for (const q of items) lines.push(`- **${q.title}** · ${q.summary} [→](${q.url})`)
    lines.push('')
  }
  if (report.trend) lines.push('---', '', `**今日趋势**：${report.trend}`, '')
  const f = report.funnel
  lines.push(
    '---',
    '',
    `*数据口径：原始 ${f.raw} → 过滤后 ${f.kept} → 候选 ${f.candidates} → 精选 ${f.selected}（run ${report.runId}）${
      report.notes.length ? '；' + report.notes.join('；') : ''
    }*`,
    '',
  )
  return lines.join('\n')
}

export function renderEmptyMarkdown(day: string, runId: string, reason: string): string {
  return `# 科技日报 | ${monthDay(day)}\n\n今日无日报产出：${reason}。\n\n*（run ${runId}；搜索结果已存入本机库）*\n`
}
