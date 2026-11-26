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
  fields: ['体重', '睡眠', '运动', '身体情况', '大便'],
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
  let headerRow = -1
  let lastRow = -1
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim().startsWith('|')) continue
    const cells = splitCells(lines[index])
    if (cells[0] === '日期' && cells.slice(1).every((name) => kind.fields.includes(name))) {
      header = cells
      headerRow = index
    }
    if (header) lastRow = index
  }
  const row = (columns: string[]): string =>
    `| ${[date, ...columns.slice(1).map((name) => cellText(values[name]?.trim() ?? ''))].join(' | ')} |`
  if (header && lastRow >= 0) {
    // A field added to the page later (大便) gets its column at the table's end, so its value is
    // not dropped; the table's other cells stay as written.
    const columns = header
    const missing = kind.fields.filter((name) => !columns.includes(name) && values[name]?.trim())
    if (missing.length) {
      for (let index = headerRow; index <= lastRow; index++) {
        const line = lines[index].replace(/\s+$/, '')
        if (!line.trim().startsWith('|')) continue
        const separator = splitCells(line).every((cell) => /^:?-{3,}:?$/.test(cell))
        const added = missing
          .map((name) => ` ${index === headerRow ? name : separator ? '---' : ''} |`)
          .join('')
        lines[index] = (line.endsWith('|') ? line : `${line} |`) + added
      }
      header = [...header, ...missing]
    }
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

const chineseNumbers: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
}
const toNumber = (text: string): number =>
  /^\d/.test(text) ? Number(text) : (chineseNumbers[text] ?? NaN)

type Period = 'night' | 'morning' | 'noon' | 'afternoon' | 'evening' | null
const periodOf = (word: string | undefined): Period =>
  !word
    ? null
    : /凌晨|半夜|夜里/.test(word)
      ? 'night'
      : /早|上午|清晨/.test(word)
        ? 'morning'
        : /中午/.test(word)
          ? 'noon'
          : /下午/.test(word)
            ? 'afternoon'
            : 'evening'

interface ClockMention {
  /** Hour on the 12-hour face as written, plus minutes as a fraction. */
  hour: number
  minutes: number
  /** 24-hour form when the text says so (13:20, 下午 3 点); null when only the face is known. */
  fixed: number | null
  period: Period
  /** Where the mention starts and ends in the text. */
  start: number
  end: number
}

const HOUR = '(\\d{1,2}|十[一二]?|[零一二两三四五六七八九十])'
const clockPattern = new RegExp(
  `(凌晨|半夜|夜里|早上|早晨|清晨|上午|中午|下午|傍晚|晚上)?\\s*(?:${HOUR}\\s*[:：]\\s*(\\d{2})|${HOUR}\\s*点\\s*(半|\\d{1,2}\\s*分?|[一三]刻)?)`,
  'g',
)

/** Clock times written in the text: 23:30, 12点, 11点半, 凌晨1点, 下午3点20. */
function clockMentions(text: string): ClockMention[] {
  const found: ClockMention[] = []
  for (const match of text.matchAll(clockPattern)) {
    const hour = toNumber(match[2] ?? match[4])
    const extra = match[5] ?? ''
    const minutes = match[3]
      ? Number(match[3])
      : extra === '半'
        ? 30
        : extra === '一刻'
          ? 15
          : extra === '三刻'
            ? 45
            : extra
              ? parseInt(extra, 10)
              : 0
    if (!(hour >= 0 && hour <= 24) || !(minutes >= 0 && minutes < 60)) continue
    const period = periodOf(match[1])
    let fixed: number | null = hour > 12 ? hour : null
    if (fixed === null && period === 'night') fixed = hour === 12 ? 0 : hour
    if (fixed === null && (period === 'afternoon' || period === 'evening'))
      fixed = hour < 12 ? hour + 12 : hour
    if (fixed === null && period === 'noon') fixed = hour < 6 ? hour + 12 : hour
    if (fixed === null && period === 'morning') fixed = hour === 12 ? 0 : hour
    found.push({
      hour,
      minutes: minutes / 60,
      fixed: fixed === null ? null : fixed % 24,
      period,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return found
}

/** Clock hour 0–24 of a time someone went to bed: 7–11 o'clock is evening, 12 is midnight. */
const bedHour = (time: ClockMention): number =>
  (time.fixed ?? (time.hour === 12 ? 0 : time.hour >= 7 ? time.hour + 12 : time.hour)) +
  time.minutes
/** Clock hour of a time someone woke or got up: the morning face unless the text says otherwise. */
const morningHour = (time: ClockMention): number =>
  (time.fixed ?? (time.hour === 12 ? 12 : time.hour)) + time.minutes

export interface SleepNight {
  /** Clock hours 0–24. */
  bed: number
  wake: number
  /** Got up later than waking (醒了又躺着); null when the text does not say. */
  up: number | null
  /** Hours asleep, bed to wake. */
  hours: number
}

/**
 * The night in a 睡眠 value: the first time is going to sleep, a time followed by 醒 is waking and
 * one followed by 起 is getting up (起 alone means woke and got up). Fewer than two times, or a
 * night shorter than 2 or longer than 14 hours, cannot be drawn and returns null.
 */
export function parseSleep(value: string): SleepNight | null {
  const times = clockMentions(value)
  if (times.length < 2) return null
  const after = (index: number): string =>
    value.slice(times[index].end, times[index + 1]?.start ?? value.length)
  const wakeIndex = times.findIndex((_, i) => i > 0 && after(i).includes('醒'))
  const upIndex = times.findIndex(
    (_, i) => i > 0 && i !== wakeIndex && /起/.test(after(i)) && !after(i).includes('醒'),
  )
  const bed = bedHour(times[0])
  let wake: number
  let up: number | null = null
  if (wakeIndex > 0) {
    wake = morningHour(times[wakeIndex])
    if (upIndex > wakeIndex) up = morningHour(times[upIndex])
  } else {
    wake = morningHour(times[upIndex > 0 ? upIndex : 1])
  }
  const span = (from: number, to: number): number => (to - from + 24) % 24
  const hours = Math.round(span(bed, wake) * 100) / 100
  if (hours < 2 || hours > 14) return null
  if (up !== null && (span(bed, up) <= hours || span(bed, up) > 16)) up = null
  return { bed, wake, up, hours }
}

export interface ExerciseSession {
  /** Clock hour it started; null when the text gives no time of day. */
  start: number | null
  minutes: number
  /** Start and length both come from the text; otherwise drawn as an estimate. */
  exact: boolean
  /** The part of the text this session was read from. */
  text: string
}

const periodStart: Record<Exclude<Period, null>, number> = {
  night: 0,
  morning: 7,
  noon: 12,
  afternoon: 15,
  evening: 20,
}
const periodWord = /(凌晨|半夜|夜里|早上|早晨|清晨|上午|中午|下午|傍晚|晚上|晚饭后|夜跑)/
const durationPattern = /(\d+(?:\.\d+)?|半)\s*(个)?\s*(小时|钟头|h|分钟|分|min)/i
/** Exercise length assumed when the text does not say. */
export const EXERCISE_DEFAULT_MINUTES = 30

/**
 * Sessions in a 运动 value, one per clause (split at ，；。). A clause with a time range, a clock
 * time, a time-of-day word or a length is a session; 「5 公里」 is not converted to time. Text that
 * says something but none of that is one session at an unknown time. 没/无/休息 means none.
 */
export function parseExercise(value: string): ExerciseSession[] {
  const text = value.trim()
  if (!text || /^(没|无|未|休息|不运动|0$)/.test(text)) return []
  const sessions: ExerciseSession[] = []
  for (const clause of text.split(/[，,；;。\n]/)) {
    const part = clause.trim()
    if (!part) continue
    const times = clockMentions(part)
    const duration = durationPattern.exec(part)
    const minutes = duration
      ? (duration[1] === '半' ? 0.5 : Number(duration[1])) * (/分|min/i.test(duration[3]) ? 1 : 60)
      : null
    const hourOf = (time: ClockMention): number =>
      (time.fixed ?? (time.hour < 6 ? time.hour + 12 : time.hour)) + time.minutes
    if (times.length >= 2 && /[-~～到至]/.test(part.slice(times[0].end, times[1].start))) {
      const start = hourOf(times[0])
      const length = ((hourOf(times[1]) - start + 24) % 24) * 60
      if (length > 0 && length <= 600) {
        sessions.push({ start, minutes: length, exact: true, text: part })
        continue
      }
    }
    if (times.length) {
      sessions.push({
        start: hourOf(times[0]),
        minutes: minutes ?? EXERCISE_DEFAULT_MINUTES,
        exact: minutes !== null,
        text: part,
      })
      continue
    }
    const period = periodWord.exec(part)?.[1]
    if (period) {
      sessions.push({
        start: periodStart[periodOf(period) ?? 'evening'],
        minutes: minutes ?? EXERCISE_DEFAULT_MINUTES,
        exact: false,
        text: part,
      })
    } else if (minutes !== null) {
      sessions.push({ start: null, minutes, exact: false, text: part })
    }
  }
  if (!sessions.length) sessions.push({ start: null, minutes: 0, exact: false, text })
  return sessions
}

const countPattern = /(\d+|[一二两三四五六七八九十])\s*次/g
/**
 * Times in a 大便 value: the sum of its 「N 次」 (早上一次，下午一次 = 2); 没有/无/0 is 0; anything
 * else written down (正常, 偏稀) counts as once. Empty text returns null.
 */
export function parseBowel(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  let total = 0
  let found = false
  for (const match of text.matchAll(countPattern)) {
    const n = toNumber(match[1])
    if (Number.isFinite(n)) {
      total += n
      found = true
    }
  }
  if (found) return total
  if (/^(没|无|未|0$|零)/.test(text) || /没(有|拉|大便)/.test(text)) return 0
  return 1
}
