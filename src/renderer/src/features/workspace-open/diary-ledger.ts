/**
 * 财务 / 健康 pages (docs/design/my-space-finance-health-2026-11-25/mockup-v3.html): the diary's
 * own header lines (今日体重：…, 昨日花销：…) read live, plus the page's own record file
 * (财务.md / 健康.md, a plain Markdown table). The diaries and that file are the only sources of
 * truth; nothing here is stored elsewhere.
 */
export interface DiaryLedgerKind {
  title: '财务' | '健康'
  /** Record file in My Space's root. */
  file: string
  /** Column labels; also the field names written after 今日/昨日 in the diary. */
  fields: string[]
}

export const healthLedger: DiaryLedgerKind = {
  title: '健康',
  file: '健康.md',
  fields: ['体重', '睡眠', '运动', '身体情况'],
}
export const financeLedger: DiaryLedgerKind = {
  title: '财务',
  file: '财务.md',
  fields: ['花销', '收入'],
}

export type DiaryLedgerSource = { kind: 'diary'; diaryDate: string } | { kind: 'own' }
export interface DiaryLedgerRow {
  /** YYYY-MM-DD the values describe. */
  date: string
  source: DiaryLedgerSource
  cells: Record<string, string>
}

/** YYYY-MM-DD shifted by whole days, calendar arithmetic only. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * Header-line values of one diary, one row per day they describe: 今日 lines describe the diary's
 * own day, 昨日 lines the day before. Only lines before the first `##` section count.
 */
export function parseDiaryRows(
  content: string,
  diaryDate: string,
  fields: string[],
): DiaryLedgerRow[] {
  const rows = new Map<string, DiaryLedgerRow>()
  for (const line of content.split('\n')) {
    if (/^##\s/.test(line)) break
    const match = /^\s*(?:[-*]\s+)?(今日|昨日)?\s*([^：:\s]+)\s*[：:]\s*(.*)$/.exec(line)
    if (!match || !fields.includes(match[2])) continue
    const value = match[3].trim()
    if (!value) continue
    const date = match[1] === '昨日' ? shiftDate(diaryDate, -1) : diaryDate
    const row = rows.get(date) ?? { date, source: { kind: 'diary', diaryDate }, cells: {} }
    row.cells[match[2]] = value
    rows.set(date, row)
  }
  return [...rows.values()]
}

const splitCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'))

/** The record file's table. Lines that look like rows but cannot be read are counted, not shown. */
export function parseRecordFile(
  content: string,
  fields: string[],
): { rows: DiaryLedgerRow[]; unreadable: number } {
  const rows: DiaryLedgerRow[] = []
  let unreadable = 0
  let columns: string[] | null = null
  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('|')) {
      columns = null
      continue
    }
    const cells = splitCells(line)
    if (!columns) {
      if (cells[0] === '日期') columns = cells
      else unreadable++
      continue
    }
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    const date = /^\d{4}-\d{2}-\d{2}$/.test(cells[0]) ? cells[0] : null
    if (!date) {
      unreadable++
      continue
    }
    const row: DiaryLedgerRow = { date, source: { kind: 'own' }, cells: {} }
    columns.forEach((name, index) => {
      if (index && fields.includes(name) && cells[index]) row.cells[name] = cells[index]
    })
    if (Object.keys(row.cells).length) rows.push(row)
  }
  return { rows, unreadable }
}

const cellText = (value: string): string => value.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')

/** The record file with one more row: appended to its table, or a new table when it has none. */
export function appendRecord(
  content: string,
  kind: DiaryLedgerKind,
  date: string,
  values: Record<string, string>,
): string {
  const lines = content.replace(/\s+$/, '').split('\n')
  let header: string[] | null = null
  let lastRow = -1
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim().startsWith('|')) continue
    const cells = splitCells(lines[index])
    if (cells[0] === '日期' && cells.slice(1).every((name) => kind.fields.includes(name)))
      header = cells
    if (header) lastRow = index
  }
  const row = (columns: string[]): string =>
    `| ${[date, ...columns.slice(1).map((name) => cellText(values[name]?.trim() ?? ''))].join(' | ')} |`
  if (header && lastRow >= 0) {
    lines.splice(lastRow + 1, 0, row(header))
    return lines.join('\n') + '\n'
  }
  const columns = ['日期', ...kind.fields]
  const table = [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    row(columns),
  ].join('\n')
  const head = content.trim() ? content.replace(/\s+$/, '') + '\n\n' : `# ${kind.title}\n\n`
  return head + table + '\n'
}

/** Diary rows and record rows together, newest first; the same day keeps one row per source. */
export function mergeRows(
  diaryRows: DiaryLedgerRow[],
  ownRows: DiaryLedgerRow[],
): DiaryLedgerRow[] {
  return [...ownRows, ...diaryRows].sort((a, b) => b.date.localeCompare(a.date))
}

/** Kilograms from a 体重 value: its first number, 斤 halved; implausible values are dropped. */
export function parseWeight(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*(斤|kg|公斤|千克)?/i.exec(value)
  if (!match) return null
  const kg = match[2] === '斤' ? Number(match[1]) / 2 : Number(match[1])
  return kg >= 30 && kg <= 200 ? Math.round(kg * 10) / 10 : null
}

/**
 * Yuan in a free-text 花销 / 收入 value: the sum of its amounts. Dates, times, percentages and
 * numbers with other units (公里, 分钟, 次 …) are not money; text with no amount returns null.
 */
export function parseAmount(value: string): number | null {
  const text = value
    .replace(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g, ' ')
    .replace(/\d{1,2}\s*[:：]\s*\d{2}/g, ' ')
    .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, ' ')
  let total = 0
  let found = false
  const pattern =
    /(\d+(?:\.\d+)?)\s*(元|块钱|块|rmb|%|％|日|号|月|年|点|时|小时|分钟|分|秒|公里|km|米|斤|kg|公斤|次|个|天|周|岁|人|件|份|杯|瓶|张|本|期|楼|层|折)?/gi
  for (const match of text.matchAll(pattern)) {
    const unit = match[2]?.toLowerCase()
    const before = text[match.index - 1]
    if (unit && !['元', '块钱', '块', 'rmb'].includes(unit)) continue
    // Part of a name or version (iPhone15, A4), not an amount.
    if (before && /[A-Za-z]/.test(before)) continue
    total += Number(match[1])
    found = true
  }
  return found ? Math.round(total * 100) / 100 : null
}
