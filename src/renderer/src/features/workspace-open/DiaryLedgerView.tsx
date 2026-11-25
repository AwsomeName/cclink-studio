import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDiaryCalendar } from './diary-calendar-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import {
  appendRecord,
  mergeRows,
  parseAmount,
  parseDiaryRows,
  parseRecordFile,
  parseWeight,
  shiftDate,
  type DiaryLedgerKind,
  type DiaryLedgerRow,
} from './diary-ledger'

/** Most recent diaries read for the page; older days stay in the diaries themselves. */
const LEDGER_DIARY_LIMIT = 120
const WEIGHT_DAYS = 90
const MONEY_DAYS = 30
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const short = (date: string): string => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
const dayLabel = (date: string): string =>
  `${short(date)} ${weekdays[new Date(date + 'T00:00:00Z').getUTCDay()]}`
const sourceLabel = (row: DiaryLedgerRow): string =>
  row.source.kind === 'own' ? '手记' : `日记 ${row.source.diaryDate.slice(5).replace('-', '')}`

/** The record file's text; a file that does not exist yet reads as empty. */
async function readRecordFile(workspacePath: string, name: string): Promise<string> {
  const entries = await window.cclinkStudio.fs.readDir(workspacePath)
  const entry = entries.find((item) => item.name === name && item.type === 'file')
  if (!entry) return ''
  const result = await window.cclinkStudio.fs.readFile(entry.path)
  return result.encoding === 'utf-8' ? result.content : ''
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

const CHART_HEIGHT = 170
const PAD = { left: 44, right: 12, top: 10, bottom: 26 }

interface Tip {
  x: number
  y: number
  title: string
  detail: string
}

function ChartTip({ tip, width }: { tip: Tip | null; width: number }): React.ReactElement | null {
  if (!tip) return null
  const right = tip.x > width / 2
  return (
    <div
      className="diary-ledger-tip"
      role="status"
      style={{
        top: Math.max(0, tip.y - 44),
        ...(right ? { right: width - tip.x + 12 } : { left: tip.x + 12 }),
      }}
    >
      <b>{tip.title}</b>
      <span>{tip.detail}</span>
    </div>
  )
}

/** Gridline values covering [lo, hi]: about four steps of 1, 2 or 5 × 10ⁿ. */
function niceTicks(lo: number, hi: number): number[] {
  const raw = (hi - lo) / 4 || 1
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = Math.floor(lo / step) * step; ; v += step) {
    ticks.push(Math.round(v * 100) / 100)
    if (v >= hi - 1e-9) break
  }
  return ticks
}

function dateTicks(days: number, every: number): number[] {
  const ticks: number[] = []
  for (let i = days - 1; i >= 0; i -= every) ticks.unshift(i)
  return ticks.filter((i, index) => index === ticks.length - 1 || days - 1 - i >= every / 2)
}

function WeightChart({
  rows,
  today,
}: {
  rows: DiaryLedgerRow[]
  today: string
}): React.ReactElement {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const start = shiftDate(today, -(WEIGHT_DAYS - 1))
  // One point per day: the newest row with a readable weight (own records sort first).
  const byDay = new Map<string, { kg: number; row: DiaryLedgerRow }>()
  for (const row of rows) {
    if (row.date < start || row.date > today || byDay.has(row.date)) continue
    const kg = parseWeight(row.cells['体重'] ?? '')
    if (kg !== null) byDay.set(row.date, { kg, row })
  }
  const points = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, ...value }))
  const plotWidth = Math.max(0, width - PAD.left - PAD.right)
  const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom
  const index = (date: string): number =>
    Math.round((Date.parse(date) - Date.parse(start)) / 86400000)
  const x = (date: string): number => PAD.left + (plotWidth * index(date)) / (WEIGHT_DAYS - 1)
  const values = points.map((point) => point.kg)
  const lo = Math.floor((Math.min(...values) - 0.5) * 2) / 2
  const hi = Math.ceil((Math.max(...values) + 0.5) * 2) / 2
  const ticks = points.length ? niceTicks(lo, hi).filter((v) => v >= lo && v <= hi) : []
  const y = (kg: number): number => PAD.top + (plotHeight * (hi - kg)) / (hi - lo || 1)
  const active = hover === null ? null : points[hover]
  const tip: Tip | null = active
    ? {
        x: x(active.date),
        y: y(active.kg),
        title: `${dayLabel(active.date)} · ${active.kg} kg`,
        detail: `${sourceLabel(active.row)}「${active.row.cells['体重']}」`,
      }
    : null
  return (
    <figure className="diary-ledger-chart" aria-label={`体重，近 ${WEIGHT_DAYS} 天`}>
      <figcaption>
        <b>体重</b>
        <span>近 {WEIGHT_DAYS} 天 · kg</span>
        <span className="gap" />
        <span>没称、没写的日子不画点，线直接连到下一次</span>
      </figcaption>
      <div ref={ref} className="diary-ledger-chart-plot">
        {!points.length ? (
          <p className="muted">近 {WEIGHT_DAYS} 天还没有能读出数字的体重记录。</p>
        ) : (
          width > 0 && (
            <svg
              width={width}
              height={CHART_HEIGHT}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(event) => {
                const left = event.clientX - event.currentTarget.getBoundingClientRect().left
                let best = 0
                points.forEach((point, i) => {
                  if (Math.abs(x(point.date) - left) < Math.abs(x(points[best].date) - left))
                    best = i
                })
                setHover(best)
              }}
            >
              {ticks.map((v) => (
                <g key={v}>
                  <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
                  <text className="axis" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
                    {v}
                  </text>
                </g>
              ))}
              <line
                className="baseline"
                x1={PAD.left}
                x2={width - PAD.right}
                y1={PAD.top + plotHeight}
                y2={PAD.top + plotHeight}
              />
              {dateTicks(WEIGHT_DAYS, 15).map((i) => {
                const date = shiftDate(start, i)
                return (
                  <text
                    key={i}
                    className="axis"
                    x={x(date)}
                    y={CHART_HEIGHT - 8}
                    textAnchor="middle"
                  >
                    {short(date)}
                  </text>
                )
              })}
              {active && (
                <line
                  className="crosshair"
                  x1={x(active.date)}
                  x2={x(active.date)}
                  y1={PAD.top}
                  y2={PAD.top + plotHeight}
                />
              )}
              <polyline
                className="series-1 line"
                points={points.map((point) => `${x(point.date)},${y(point.kg)}`).join(' ')}
              />
              {points.map((point, i) => (
                <circle
                  key={point.date}
                  className="series-1 dot"
                  cx={x(point.date)}
                  cy={y(point.kg)}
                  r={hover === i ? 5 : 3}
                />
              ))}
            </svg>
          )
        )}
        <ChartTip tip={tip} width={width} />
      </div>
    </figure>
  )
}

interface MoneyDay {
  date: string
  spend: number
  income: number
  /** Written down, but no amount could be read. */
  unknown: boolean
  texts: string[]
}

function MoneyChart({
  rows,
  today,
}: {
  rows: DiaryLedgerRow[]
  today: string
}): React.ReactElement {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const start = shiftDate(today, -(MONEY_DAYS - 1))
  const days: MoneyDay[] = Array.from({ length: MONEY_DAYS }, (_, i) => ({
    date: shiftDate(start, i),
    spend: 0,
    income: 0,
    unknown: false,
    texts: [],
  }))
  for (const row of rows) {
    const day = days.find((item) => item.date === row.date)
    if (!day) continue
    for (const [field, key] of [
      ['花销', 'spend'],
      ['收入', 'income'],
    ] as const) {
      const text = row.cells[field]
      if (!text) continue
      const amount = parseAmount(text)
      if (amount === null) day.unknown = true
      else day[key] += amount
      day.texts.push(`${sourceLabel(row)} ${field}「${text}」`)
    }
  }
  const plotWidth = Math.max(0, width - PAD.left - PAD.right)
  const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom
  const max = Math.max(0, ...days.map((day) => Math.max(day.spend, day.income)))
  const ticks = max ? niceTicks(0, max) : [0]
  const top = ticks[ticks.length - 1] || 1
  const y = (v: number): number => PAD.top + (plotHeight * (top - v)) / top
  const band = plotWidth / MONEY_DAYS
  const barWidth = Math.max(2, (band - 6) / 2 - 1)
  const bar = (left: number, value: number, className: string): React.ReactElement | null => {
    if (!value) return null
    const h = PAD.top + plotHeight - y(value)
    const r = Math.min(4, h, barWidth / 2)
    const base = PAD.top + plotHeight
    return (
      <path
        className={className}
        d={`M${left},${base} v${-(h - r)} q0,${-r} ${r},${-r} h${barWidth - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
      />
    )
  }
  const active = hover === null ? null : days[hover]
  const tip: Tip | null =
    active && active.texts.length
      ? {
          x: PAD.left + band * (hover! + 0.5),
          y: 54,
          title: [
            dayLabel(active.date),
            active.spend ? `花销 ${active.spend} 元` : '',
            active.income ? `收入 ${active.income} 元` : '',
            active.unknown ? '有一条没认出金额' : '',
          ]
            .filter(Boolean)
            .join(' · '),
          detail: active.texts.join('；'),
        }
      : null
  const anything = days.some((day) => day.texts.length)
  return (
    <figure className="diary-ledger-chart" aria-label={`每天花销和收入，近 ${MONEY_DAYS} 天`}>
      <figcaption>
        <b>每天花销 / 收入</b>
        <span>近 {MONEY_DAYS} 天 · 元</span>
        <span className="gap" />
        <span className="key">
          <i className="series-1" />
          花销
        </span>
        <span className="key">
          <i className="series-2" />
          收入
        </span>
        <span>？= 写了但没认出金额</span>
      </figcaption>
      <div ref={ref} className="diary-ledger-chart-plot">
        {!anything ? (
          <p className="muted">近 {MONEY_DAYS} 天还没有花销或收入记录。</p>
        ) : (
          width > 0 && (
            <svg width={width} height={CHART_HEIGHT} onMouseLeave={() => setHover(null)}>
              {ticks.map((v) => (
                <g key={v}>
                  <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
                  <text className="axis" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
                    {v}
                  </text>
                </g>
              ))}
              <line
                className="baseline"
                x1={PAD.left}
                x2={width - PAD.right}
                y1={PAD.top + plotHeight}
                y2={PAD.top + plotHeight}
              />
              {days.map((day, i) => {
                const left = PAD.left + band * i
                return (
                  <g key={day.date} onMouseEnter={() => setHover(i)}>
                    {hover === i && day.texts.length > 0 && (
                      <rect
                        className="hover-band"
                        x={left + 1}
                        y={PAD.top}
                        width={band - 2}
                        height={plotHeight}
                        rx={3}
                      />
                    )}
                    {bar(left + 3, day.spend, 'series-1')}
                    {bar(left + 3 + barWidth + 2, day.income, 'series-2')}
                    {day.unknown && (
                      <text
                        className="axis"
                        x={left + band / 2}
                        y={PAD.top + plotHeight - 5}
                        textAnchor="middle"
                      >
                        ?
                      </text>
                    )}
                    <rect className="hit" x={left} y={PAD.top} width={band} height={plotHeight} />
                  </g>
                )
              })}
              {dateTicks(MONEY_DAYS, 5).map((i) => (
                <text
                  key={i}
                  className="axis"
                  x={PAD.left + band * (i + 0.5)}
                  y={CHART_HEIGHT - 8}
                  textAnchor="middle"
                >
                  {short(shiftDate(start, i))}
                </text>
              ))}
            </svg>
          )
        )}
        <ChartTip tip={tip} width={width} />
      </div>
    </figure>
  )
}

/**
 * 财务 / 健康 (mockup v3): the diary's header lines for these fields read live, plus the page's own
 * record file in My Space's root. 记一条 only appends to that file; changing or removing a record
 * happens in the file, and changing a diary value happens in the diary.
 */
export function DiaryLedgerView({
  kind,
  workspacePath,
  diaries,
  today,
  revision,
  openFile,
}: {
  kind: DiaryLedgerKind
  workspacePath: string
  diaries: Array<{ path: string; year: string; month: string; day: string }>
  /** YYYY-MM-DD in the diary's timezone. */
  today: string
  revision: number
  openFile: (file: { path: string; name: string }) => void
}): React.ReactElement {
  const [diaryRows, setDiaryRows] = useState<DiaryLedgerRow[] | null>(null)
  const [own, setOwn] = useState<{ rows: DiaryLedgerRow[]; unreadable: number } | null>(null)
  const [error, setError] = useState('')
  const [ownRevision, setOwnRevision] = useState(0)
  const [date, setDate] = useState(today)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [fresh, setFresh] = useState('')
  const recordPath = `${workspacePath}/${kind.file}`
  const recent = diaries.slice(0, LEDGER_DIARY_LIMIT)
  const key = recent.map((file) => file.path).join('\n')
  useEffect(() => setDate(today), [today])
  useEffect(() => {
    let alive = true
    void Promise.all(
      recent.map(async (file) => {
        const result = await window.cclinkStudio.fs.readFile(file.path)
        return parseDiaryRows(
          result.encoding === 'utf-8' ? result.content : '',
          `${file.year}-${file.month}-${file.day}`,
          kind.fields,
        )
      }),
    )
      .then((items) => {
        if (alive) setDiaryRows(items.flat())
      })
      .catch((e) => {
        if (alive) setError(String(e))
      })
    return () => {
      alive = false
    }
    // `key` stands for the diary list.
  }, [key, revision, kind])
  useEffect(() => {
    let alive = true
    void readRecordFile(workspacePath, kind.file)
      .then((content) => {
        if (alive) setOwn(parseRecordFile(content, kind.fields))
      })
      .catch((e) => {
        if (alive) setError(String(e))
      })
    return () => {
      alive = false
    }
  }, [workspacePath, revision, ownRevision, kind])
  useEffect(() => {
    if (!fresh) return
    const timer = window.setTimeout(() => setFresh(''), 2000)
    return () => window.clearTimeout(timer)
  }, [fresh])
  const add = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      // Read again right before writing: the file may have changed since the page loaded.
      const content = await readRecordFile(workspacePath, kind.file)
      await window.cclinkStudio.fs.writeFile(recordPath, appendRecord(content, kind, date, draft))
      setDraft({})
      setFresh(date)
      setOwnRevision((value) => value + 1)
    } catch (e) {
      setError(`没记上：${String(e)}`)
    } finally {
      setSaving(false)
    }
  }
  const openDay = (diaryDate: string): void => {
    useDiaryCalendar.getState().select(diaryDate)
    useDiaryNavigation.getState().setPage('日记')
  }
  const openRecords = (): void =>
    void (async () => {
      // Opening the record file before the first record creates it with an empty table.
      const entries = await window.cclinkStudio.fs.readDir(workspacePath)
      if (!entries.some((item) => item.name === kind.file && item.type === 'file')) {
        const columns = ['日期', ...kind.fields]
        await window.cclinkStudio.fs.writeFile(
          recordPath,
          `# ${kind.title}\n\n| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`,
        )
        setOwnRevision((value) => value + 1)
      }
      openFile({ path: recordPath, name: kind.file })
    })().catch((e) => setError(String(e)))
  const rows = diaryRows && own ? mergeRows(diaryRows, own.rows) : null
  const canAdd =
    /^\d{4}-\d{2}-\d{2}$/.test(date) && kind.fields.some((field) => draft[field]?.trim())
  return (
    <div className="diary-ledger" aria-label={kind.title}>
      <header className="diary-ledger-head">
        <h2>{kind.title}</h2>
        <span className="muted">日记开头的{kind.fields.join('、')} + 自己记的</span>
        <span className="gap" />
        <button type="button" className="diary-link" onClick={openRecords}>
          打开记录文件 {kind.file} ›
        </button>
      </header>
      <form
        className="diary-ledger-add"
        aria-label="记一条"
        onSubmit={(event) => {
          event.preventDefault()
          if (canAdd && !saving) void add()
        }}
      >
        <input
          type="date"
          aria-label="日期"
          value={date}
          max={today}
          onChange={(event) => setDate(event.target.value)}
        />
        {kind.fields.map((field) => (
          <input
            key={field}
            aria-label={field}
            placeholder={field}
            className={field === '体重' ? 'narrow' : undefined}
            value={draft[field] ?? ''}
            onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
          />
        ))}
        <button type="submit" className="primary" disabled={!canAdd || saving}>
          {saving ? '正在记…' : '记一条'}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {own && own.unreadable > 0 && (
        <p role="status" className="muted">
          {kind.file} 有 {own.unreadable} 行没读出来，
          <button type="button" className="diary-link" onClick={openRecords}>
            打开文件查看
          </button>
        </p>
      )}
      {!rows && !error && (
        <p className="muted" role="status">
          正在读取…
        </p>
      )}
      {rows &&
        (kind.title === '健康' ? (
          <WeightChart rows={rows} today={today} />
        ) : (
          <MoneyChart rows={rows} today={today} />
        ))}
      {rows && !rows.length && (
        <p className="muted">
          还没有{kind.fields.join('、')}记录。在上面记一条，或在日记开头对应的行里填写。
        </p>
      )}
      {rows && rows.length > 0 && (
        <table className="diary-ledger-table">
          <thead>
            <tr>
              <th scope="col">日期</th>
              {kind.fields.map((field) => (
                <th key={field} scope="col">
                  {field}
                </th>
              ))}
              <th scope="col">来源</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.date}:${sourceLabel(row)}:${index}`}
                className={row.source.kind === 'own' && row.date === fresh ? 'fresh' : undefined}
              >
                <th scope="row">{dayLabel(row.date)}</th>
                {kind.fields.map((field) => (
                  <td key={field} className={row.cells[field] ? undefined : 'empty'}>
                    {row.cells[field] ?? '—'}
                  </td>
                ))}
                <td className="source">
                  <button
                    type="button"
                    className={`diary-ledger-tag ${row.source.kind}`}
                    title={row.source.kind === 'own' ? `打开 ${kind.file}` : '打开这篇日记'}
                    onClick={() =>
                      row.source.kind === 'diary' ? openDay(row.source.diaryDate) : openRecords()
                    }
                  >
                    {sourceLabel(row)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
