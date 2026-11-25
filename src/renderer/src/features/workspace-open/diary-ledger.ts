/**
 * 财务 / 健康 pages: the diary's own header lines (今日体重：…, 昨日花销：…) collected by day.
 * The diary files stay the only source of truth; nothing here is stored.
 */
export interface DiaryLedgerField {
  /** Column label, and the field name as written after 今日/昨日 in the diary. */
  label: string
}

export const healthFields: DiaryLedgerField[] = [
  { label: '体重' },
  { label: '睡眠' },
  { label: '运动' },
  { label: '身体情况' },
]
export const financeFields: DiaryLedgerField[] = [{ label: '花销' }, { label: '收入' }]

export interface DiaryLedgerCell {
  value: string
  /** The diary the value was written in (a 昨日 line sits in the next day's file). */
  sourceDate: string
}
export interface DiaryLedgerRow {
  /** YYYY-MM-DD the value describes. */
  date: string
  cells: Record<string, DiaryLedgerCell>
}

/** YYYY-MM-DD shifted by whole days, calendar arithmetic only. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Header-line values of one diary: 今日 lines describe its own day, 昨日 lines the day before. */
export function parseDiaryFields(
  content: string,
  date: string,
  fields: DiaryLedgerField[],
): Array<{ date: string; label: string; value: string }> {
  const found: Array<{ date: string; label: string; value: string }> = []
  const labels = fields.map((field) => field.label)
  for (const line of content.split('\n')) {
    // The fields are the diary's header; the first section ends them.
    if (/^##\s/.test(line)) break
    const match = /^\s*(?:[-*]\s+)?(今日|昨日)?\s*([^：:\s]+)\s*[：:]\s*(.*)$/.exec(line)
    if (!match || !labels.includes(match[2])) continue
    const value = match[3].trim()
    if (!value) continue
    found.push({ date: match[1] === '昨日' ? shiftDate(date, -1) : date, label: match[2], value })
  }
  return found
}

/** Rows newest first; a later diary's line for the same day and field wins. */
export function buildLedger(
  diaries: Array<{ date: string; content: string }>,
  fields: DiaryLedgerField[],
): DiaryLedgerRow[] {
  const rows = new Map<string, DiaryLedgerRow>()
  for (const diary of [...diaries].sort((a, b) => a.date.localeCompare(b.date)))
    for (const item of parseDiaryFields(diary.content, diary.date, fields)) {
      const row = rows.get(item.date) ?? { date: item.date, cells: {} }
      row.cells[item.label] = { value: item.value, sourceDate: diary.date }
      rows.set(item.date, row)
    }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date))
}
