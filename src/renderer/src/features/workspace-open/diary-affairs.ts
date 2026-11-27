/**
 * 事务 page (docs/design/my-space-affairs-2026-11-27/mockup-v2.html): the diary's own
 * 「## 项目进度与计划」 section is the only source of truth. Each `###` is a group, each table row
 * an item (事项 / 进展记录 / 计划). The page lines the same row up across days to show when it
 * really changed, and writes back only to that row's cells in today's diary.
 */

export const AFFAIRS_SECTION = '项目进度与计划'
/** Days without a 进展 change before an item in progress is marked as stalled. */
export const AFFAIR_STALE_DAYS = 7
/** Sections of the same diary searched for other mentions of an item. */
export const MENTION_SECTIONS = ['今日打卡', '今日待做', '昨日总结'] as const

export interface DiaryAffairRow {
  group: string
  name: string
  progress: string
  plan: string
}

export interface DiaryAffairsSection {
  rows: DiaryAffairRow[]
  /** `### group` titles in the order the diary lists them. */
  groups: string[]
}

const splitCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'))
const isSeparator = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
const headingOf = (line: string): { level: number; text: string } | null => {
  const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
  return match ? { level: match[1].length, text: match[2].trim() } : null
}

/** Line range [start, end) of a `## title` section; null when the diary has none. */
export function sectionRange(lines: string[], title: string): [number, number] | null {
  const start = lines.findIndex((line) => {
    const heading = headingOf(line)
    return heading?.level === 2 && heading.text === title
  })
  if (start < 0) return null
  let end = start + 1
  while (end < lines.length) {
    const heading = headingOf(lines[end])
    if (heading && heading.level <= 2) break
    end++
  }
  return [start, end]
}

interface TableAt {
  group: string
  header: number
  /** Last line of the table. */
  last: number
  nameColumn: number
  progressColumn: number
  planColumn: number
}

/** Item tables of the section: a header whose first column is 事项 and that has 进展 and 计划. */
function tablesIn(lines: string[], range: [number, number]): TableAt[] {
  const tables: TableAt[] = []
  let group = ''
  for (let index = range[0] + 1; index < range[1]; index++) {
    const heading = headingOf(lines[index])
    if (heading) {
      group = heading.text
      continue
    }
    if (!lines[index].trim().startsWith('|')) continue
    const cells = splitCells(lines[index])
    const progressColumn = cells.findIndex((cell) => cell.startsWith('进展'))
    const planColumn = cells.findIndex((cell) => cell === '计划')
    let last = index
    while (last + 1 < range[1] && lines[last + 1].trim().startsWith('|')) last++
    if (cells[0] === '事项' && progressColumn > 0 && planColumn > 0)
      tables.push({ group, header: index, last, nameColumn: 0, progressColumn, planColumn })
    index = last
  }
  return tables
}

/** The 「项目进度与计划」 section of one diary; null when the diary does not have it. */
export function parseAffairsSection(content: string): DiaryAffairsSection | null {
  const lines = content.split('\n')
  const range = sectionRange(lines, AFFAIRS_SECTION)
  if (!range) return null
  const rows: DiaryAffairRow[] = []
  const groups: string[] = []
  for (const table of tablesIn(lines, range)) {
    if (!groups.includes(table.group)) groups.push(table.group)
    for (let index = table.header + 1; index <= table.last; index++) {
      const cells = splitCells(lines[index])
      if (isSeparator(cells)) continue
      const name = cells[table.nameColumn] ?? ''
      if (!name) continue
      rows.push({
        group: table.group,
        name,
        progress: cells[table.progressColumn] ?? '',
        plan: cells[table.planColumn] ?? '',
      })
    }
  }
  return { rows, groups }
}

/** Same item across days: same group and name, ignoring spaces, case and -／— variants. */
export function affairKey(group: string, name: string): string {
  const norm = (text: string): string =>
    text
      .replace(/\*\*/g, '')
      .replace(/[\s ]+/g, '')
      .replace(/[-—–－_~～]+/g, '-')
      .toLowerCase()
  return `${norm(group)}\u0000${norm(name)}`
}

const blankProgress = /^(?:[-—–]+|无|待启动|待重启|待定|未启动|暂无)?[。.]?$/
/** 进展 that says the item has not started: empty, —, 待启动, 待重启 … */
export function notStarted(progress: string): boolean {
  const text = plainText(progress)
  return blankProgress.test(text) || /^(待启动|待重启)/.test(text)
}

/** Cell text without Markdown emphasis or <br>. */
export function plainText(cell: string): string {
  return cell
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\*\*|__|`/g, '')
    .trim()
}

export interface AffairDiaryInput {
  /** YYYY-MM-DD. */
  date: string
  path: string
  content: string
}

export type AffairStatus = 'active' | 'idle' | 'removed'

export interface AffairVersion {
  date: string
  path: string
  progress: string
  plan: string
  /** First day the row appears (or reappears after it was gone). */
  appeared: boolean
  progressChanged: boolean
  planChanged: boolean
  /** The version this one is compared with; null for the first appearance. */
  previous: { progress: string; plan: string } | null
}

export interface DiaryAffair {
  key: string
  group: string
  name: string
  status: AffairStatus
  /** The row in the newest diary that has the section, or the last one seen when removed. */
  latest: AffairVersion
  firstSeen: string
  /** Last day 进展 changed (first appearance counts). */
  lastChange: string
  /** Versions in date order; one per diary that has the row. */
  versions: AffairVersion[]
  /** Diaries with the section but without this row, after it first appeared. */
  missingDates: string[]
}

export interface DiaryAffairsSummary {
  /** Newest diary that has the section; null when none does. */
  latest: AffairDiaryInput | null
  /** Diaries read that have the section. */
  diariesWithSection: number
  groups: string[]
  affairs: DiaryAffair[]
}

/**
 * Lines every diary's section up by item. Diaries without the section are skipped, so a day
 * without one never makes an item look removed.
 */
export function summarizeAffairs(diaries: AffairDiaryInput[]): DiaryAffairsSummary {
  const parsed = [...diaries]
    .sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path))
    .map((diary) => ({ diary, section: parseAffairsSection(diary.content) }))
    .filter((item): item is { diary: AffairDiaryInput; section: DiaryAffairsSection } =>
      Boolean(item.section),
    )
  const byKey = new Map<string, DiaryAffair>()
  const lastPresent = new Map<string, boolean>()
  for (const { diary, section } of parsed) {
    const seen = new Set<string>()
    for (const row of section.rows) {
      const key = affairKey(row.group, row.name)
      if (seen.has(key)) continue
      seen.add(key)
      const affair = byKey.get(key)
      const before = affair?.versions.at(-1)
      const appeared = !affair || lastPresent.get(key) === false
      const version: AffairVersion = {
        date: diary.date,
        path: diary.path,
        progress: row.progress,
        plan: row.plan,
        appeared,
        progressChanged: !before || plainText(before.progress) !== plainText(row.progress),
        planChanged: !before || plainText(before.plan) !== plainText(row.plan),
        previous: before ? { progress: before.progress, plan: before.plan } : null,
      }
      if (!affair) {
        byKey.set(key, {
          key,
          group: row.group,
          name: row.name,
          status: 'active',
          latest: version,
          firstSeen: diary.date,
          lastChange: diary.date,
          versions: [version],
          missingDates: [],
        })
      } else {
        affair.group = row.group
        affair.name = row.name
        affair.latest = version
        affair.versions.push(version)
        if (version.progressChanged) affair.lastChange = diary.date
      }
    }
    for (const [key, affair] of byKey) {
      const present = seen.has(key)
      if (!present) affair.missingDates.push(diary.date)
      lastPresent.set(key, present)
    }
  }
  const newest = parsed.at(-1) ?? null
  const groups = [...(newest?.section.groups ?? [])]
  const order = new Map<string, number>()
  newest?.section.rows.forEach((row, index) => order.set(affairKey(row.group, row.name), index))
  const affairs = [...byKey.values()].map((affair) => ({
    ...affair,
    status: (!order.has(affair.key)
      ? 'removed'
      : notStarted(affair.latest.progress)
        ? 'idle'
        : 'active') as AffairStatus,
  }))
  for (const affair of affairs) if (!groups.includes(affair.group)) groups.push(affair.group)
  // Newest diary's order first; removed items after, most recently seen first.
  affairs.sort(
    (a, b) =>
      (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity) ||
      b.latest.date.localeCompare(a.latest.date),
  )
  return {
    latest: newest?.diary ?? null,
    diariesWithSection: parsed.length,
    groups,
    affairs,
  }
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
}

export function isStale(affair: DiaryAffair, today: string): boolean {
  return affair.status === 'active' && daysBetween(affair.lastChange, today) > AFFAIR_STALE_DAYS
}

export type DiffPart = { kind: 'same' | 'add' | 'del'; text: string }

/** Clauses ending at Chinese or ASCII punctuation, so a diff marks whole phrases. */
const clauses = (text: string): string[] =>
  text.match(/[^。；;，,！!？?、\n]+[。；;，,！!？?、\n]*/g) ?? []

/** What changed from one cell text to the next, by clause. */
export function diffText(before: string, after: string): DiffPart[] {
  const a = clauses(plainText(before))
  const b = clauses(plainText(after))
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string): void => {
    const last = parts.at(-1)
    if (last?.kind === kind) last.text += text
    else parts.push({ kind, text })
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (j < b.length && (i >= a.length || table[i][j + 1] >= table[i + 1][j])) {
      push('add', b[j++])
    } else {
      push('del', a[i++])
    }
  }
  return parts
}

const genericWords = new Set(['硬件', '软件', '项目', '产品', '整体', '其他', '方向', '管理'])

/** Words of an item name used to find it elsewhere in the diary: 「硬件—喇叭」 → 喇叭. */
export function affairKeywords(name: string): string[] {
  const words = plainText(name)
    .split(/[\s\-—–－_/／、与和及()（）·.]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
  const specific = words.filter((word) => !genericWords.has(word))
  return specific.length ? specific : words
}

export interface AffairMention {
  section: (typeof MENTION_SECTIONS)[number]
  /** The line or paragraph, shortened around the first match. */
  text: string
}

const MENTION_LENGTH = 160

/** Paragraphs and list items of 今日打卡 / 今日待做 / 昨日总结 that mention one of the words. */
export function findMentions(content: string, words: string[]): AffairMention[] {
  if (!words.length) return []
  const lines = content.split('\n')
  const found: AffairMention[] = []
  const lower = words.map((word) => word.toLowerCase())
  for (const section of MENTION_SECTIONS) {
    const range = sectionRange(lines, section)
    if (!range) continue
    const blocks: string[] = []
    let current: string[] = []
    const flush = (): void => {
      if (current.length) blocks.push(current.join(' '))
      current = []
    }
    for (let index = range[0] + 1; index < range[1]; index++) {
      const line = lines[index].trim()
      if (!line || headingOf(line) || line.startsWith('|') || line === '&nbsp;') {
        flush()
        continue
      }
      if (/^([-*+]|\d+[.、)])\s/.test(line)) flush()
      current.push(line)
    }
    flush()
    for (const block of blocks) {
      const text = plainText(block).replace(/^[-*+]\s+(\[[ xX]\]\s*)?/, (m) =>
        /\[[xX]\]/.test(m) ? '☑ ' : /\[ \]/.test(m) ? '☐ ' : '',
      )
      const at = lower
        .map((word) => text.toLowerCase().indexOf(word))
        .filter((index) => index >= 0)
        .sort((x, y) => x - y)[0]
      if (at === undefined) continue
      const start = Math.max(0, Math.min(at - 40, text.length - MENTION_LENGTH))
      const piece = text.slice(start, start + MENTION_LENGTH)
      found.push({
        section,
        text: (start > 0 ? '…' : '') + piece + (start + MENTION_LENGTH < text.length ? '…' : ''),
      })
    }
  }
  return found
}

/** Today's 待做 in one group: the task list items under `### group` of 「今日待做」. */
export function groupTodos(content: string, group: string): { done: number; total: number } {
  const lines = content.split('\n')
  const range = sectionRange(lines, '今日待做')
  let done = 0
  let total = 0
  if (!range) return { done, total }
  let inGroup = false
  for (let index = range[0] + 1; index < range[1]; index++) {
    const heading = headingOf(lines[index])
    if (heading) {
      inGroup = affairKey(heading.text, '') === affairKey(group, '')
      continue
    }
    const box = /^\s*[-*+]\s+\[([ xX])\]/.exec(lines[index])
    if (inGroup && box) {
      total++
      if (box[1] !== ' ') done++
    }
  }
  return { done, total }
}

const cellText = (value: string): string =>
  value
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()

export interface AffairEdit {
  group: string
  name: string
  progress: string
  plan: string
}

export interface AffairWrite {
  content: string
  /** The row as it was, or null when it is added. */
  before: string | null
  after: string
  /** 1-based line of the row after writing. */
  line: number
}

/**
 * Today's diary with one item's 进展 and 计划 cells set. Only that row changes; other cells and
 * rows stay as written. A missing row is added at the end of its group's table, a missing group
 * gets its own `###` table at the end of the section, and a diary without the section gets the
 * section at its end.
 */
export function writeAffair(content: string, edit: AffairEdit): AffairWrite {
  const lines = content.split('\n')
  const key = affairKey(edit.group, edit.name)
  const range = sectionRange(lines, AFFAIRS_SECTION)
  if (range) {
    const tables = tablesIn(lines, range)
    for (const table of tables) {
      for (let index = table.header + 1; index <= table.last; index++) {
        const cells = splitCells(lines[index])
        if (isSeparator(cells) || affairKey(table.group, cells[table.nameColumn] ?? '') !== key)
          continue
        const width = Math.max(cells.length, table.progressColumn + 1, table.planColumn + 1)
        const next = Array.from({ length: width }, (_, i) => cells[i] ?? '')
        next[table.progressColumn] = cellText(edit.progress)
        next[table.planColumn] = cellText(edit.plan)
        const before = lines[index]
        const escape = (cell: string, i: number): string =>
          i === table.progressColumn || i === table.planColumn ? cell : cell.replace(/\|/g, '\\|')
        lines[index] = `| ${next.map(escape).join(' | ')} |`
        return { content: lines.join('\n'), before, after: lines[index], line: index + 1 }
      }
    }
    const table = tables.find((item) => affairKey(item.group, '') === affairKey(edit.group, ''))
    if (table) {
      const width = splitCells(lines[table.header]).length
      const next = Array.from({ length: width }, () => '')
      next[table.nameColumn] = cellText(edit.name)
      next[table.progressColumn] = cellText(edit.progress)
      next[table.planColumn] = cellText(edit.plan)
      const row = `| ${next.join(' | ')} |`
      lines.splice(table.last + 1, 0, row)
      return { content: lines.join('\n'), before: null, after: row, line: table.last + 2 }
    }
    let end = range[1]
    while (end > range[0] + 1 && !lines[end - 1].trim()) end--
    const row = `| ${cellText(edit.name)} | ${cellText(edit.progress)} | ${cellText(edit.plan)} |`
    const block = [
      '',
      ...(edit.group ? [`### ${edit.group}`, ''] : []),
      '| 事项 | 进展记录 | 计划 |',
      '| --- | --- | --- |',
      row,
    ]
    lines.splice(end, 0, ...block, ...(end < lines.length ? [''] : []))
    return {
      content: lines.join('\n'),
      before: null,
      after: row,
      line: end + block.length,
    }
  }
  const head = content.replace(/\s+$/, '')
  const row = `| ${cellText(edit.name)} | ${cellText(edit.progress)} | ${cellText(edit.plan)} |`
  const block = [
    `## ${AFFAIRS_SECTION}`,
    '',
    ...(edit.group ? [`### ${edit.group}`, ''] : []),
    '| 事项 | 进展记录 | 计划 |',
    '| --- | --- | --- |',
    row,
  ]
  const prefix = head ? head.split('\n').length + 1 : 0
  return {
    content: (head ? head + '\n\n' : '') + block.join('\n') + '\n',
    before: null,
    after: row,
    line: prefix + block.length,
  }
}
