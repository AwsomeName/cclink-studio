import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDiaryCalendar } from './diary-calendar-store'
import { useDiaryNavigation } from './personal-diary-navigation'
import {
  appendRecord,
  mergeRows,
  parseAmount,
  parseBowel,
  parseDiaryRows,
  parseExercise,
  parseRecordFile,
  parseSleep,
  parseWeight,
  shiftDate,
  EXERCISE_DEFAULT_MINUTES,
  type DiaryLedgerKind,
  type DiaryLedgerRow,
} from './diary-ledger'

/** Most recent diaries read for the page; older days stay in the diaries themselves. */
const LEDGER_DIARY_LIMIT = 120
const WEIGHT_DAYS = 90
const MONEY_DAYS = 30
const CLOCK_DAYS = 30
/** About the 120 diaries the page reads. */
const BOWEL_WEEKS = 18
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

const clock = (hours: number): string => {
  const total = Math.round((((hours % 24) + 24) % 24) * 60)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
const length = (hours: number): string => {
  const total = Math.round(hours * 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h} 小时${m ? ` ${m} 分` : ''}` : `${m} 分钟`
}

interface ClockBar {
  /** Positions on the chart's own vertical scale. */
  from: number
  to: number
  className: string
}
interface ClockDay {
  date: string
  bars: ClockBar[]
  /** Something happened that day but its time is unknown: a dot on the bottom lane. */
  dot: boolean
  /** Written down, but no time could be read. */
  unknown: boolean
  title: string
  detail: string
}

/**
 * One column per day, time running down the vertical axis; each bar spans from–to on that scale
 * (睡眠: bed to wake; 运动: start to end).
 */
function ClockChart({
  label,
  caption,
  keys,
  days,
  lo,
  hi,
  ticks,
  tickLabel,
  lane,
  empty,
}: {
  label: string
  caption: string
  keys: React.ReactNode
  days: ClockDay[]
  lo: number
  hi: number
  ticks: number[]
  tickLabel: (value: number) => string
  /** Label of the bottom lane for days with no time; omitted when the chart has none. */
  lane?: string
  empty: string
}): React.ReactElement {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const height = lane ? 260 : 200
  const plotBottom = height - PAD.bottom - (lane ? 26 : 0)
  const laneY = plotBottom + 16
  const plotWidth = Math.max(0, width - PAD.left - PAD.right)
  const band = plotWidth / days.length
  const barWidth = Math.max(3, Math.min(18, band - 8))
  const y = (v: number): number =>
    PAD.top + ((plotBottom - PAD.top) * (Math.min(hi, Math.max(lo, v)) - lo)) / (hi - lo)
  const active = hover === null ? null : days[hover]
  const tip: Tip | null =
    active && (active.bars.length || active.dot || active.unknown)
      ? { x: PAD.left + band * (hover! + 0.5), y: 54, title: active.title, detail: active.detail }
      : null
  const anything = days.some((day) => day.bars.length || day.dot || day.unknown)
  return (
    <figure className="diary-ledger-chart" aria-label={label}>
      <figcaption>
        <b>{label.split('，')[0]}</b>
        <span>{caption}</span>
        <span className="gap" />
        {keys}
      </figcaption>
      <div ref={ref} className="diary-ledger-chart-plot">
        {!anything ? (
          <p className="muted">{empty}</p>
        ) : (
          width > 0 && (
            <svg width={width} height={height} onMouseLeave={() => setHover(null)}>
              {ticks.map((v) => (
                <g key={v}>
                  <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
                  <text className="axis" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
                    {tickLabel(v)}
                  </text>
                </g>
              ))}
              {lane && (
                <>
                  <line
                    className="grid lane"
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={laneY}
                    y2={laneY}
                  />
                  <text className="axis" x={PAD.left - 8} y={laneY + 4} textAnchor="end">
                    {lane}
                  </text>
                </>
              )}
              {days.map((day, i) => {
                const left = PAD.left + band * i
                const center = left + band / 2
                return (
                  <g key={day.date} onMouseEnter={() => setHover(i)}>
                    {hover === i && (day.bars.length > 0 || day.dot || day.unknown) && (
                      <rect
                        className="hover-band"
                        x={left + 1}
                        y={PAD.top}
                        width={band - 2}
                        height={(lane ? laneY + 8 : plotBottom) - PAD.top}
                        rx={3}
                      />
                    )}
                    {day.bars.map((bar, index) => (
                      <rect
                        key={index}
                        className={bar.className}
                        x={center - barWidth / 2}
                        y={y(bar.from)}
                        width={barWidth}
                        height={Math.max(3, y(bar.to) - y(bar.from))}
                        rx={2}
                      />
                    ))}
                    {day.dot && lane && (
                      <circle className="series-1 dot" cx={center} cy={laneY} r={4} />
                    )}
                    {day.unknown && !day.bars.length && (
                      <text
                        className="axis"
                        x={center}
                        y={y((lo + hi) / 2) + 4}
                        textAnchor="middle"
                      >
                        ?
                      </text>
                    )}
                    <rect
                      className="hit"
                      x={left}
                      y={PAD.top}
                      width={band}
                      height={(lane ? laneY + 8 : plotBottom) - PAD.top}
                    />
                  </g>
                )
              })}
              {dateTicks(days.length, 5).map((i) => (
                <text
                  key={i}
                  className="axis"
                  x={PAD.left + band * (i + 0.5)}
                  y={height - 8}
                  textAnchor="middle"
                >
                  {short(days[i].date)}
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

const lastDays = (today: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => shiftDate(today, i - count + 1))
/** Rows by day; rows arrive newest source first, so the first one is the newest. */
function byDay(rows: DiaryLedgerRow[], field: string): Map<string, DiaryLedgerRow[]> {
  const days = new Map<string, DiaryLedgerRow[]>()
  for (const row of rows) {
    if (!row.cells[field]) continue
    days.set(row.date, [...(days.get(row.date) ?? []), row])
  }
  return days
}

/** Noon-based hours, so a night reads 12 (noon) … 24 (midnight) … 36 (next noon) without a jump. */
const fromNoon = (hours: number): number => ((hours - 12 + 24) % 24) + 12

function SleepChart({
  rows,
  today,
}: {
  rows: DiaryLedgerRow[]
  today: string
}): React.ReactElement {
  const written = byDay(rows, '睡眠')
  const days: ClockDay[] = lastDays(today, CLOCK_DAYS).map((date) => {
    const row = written.get(date)?.[0]
    const text = row?.cells['睡眠'] ?? ''
    const night = text ? parseSleep(text) : null
    const bars: ClockBar[] = []
    if (night) {
      const bed = fromNoon(night.bed)
      const wake = bed + night.hours
      bars.push({ from: bed, to: wake, className: 'series-1' })
      if (night.up !== null)
        bars.push({
          from: wake,
          to: wake + ((night.up - night.wake + 24) % 24),
          className: 'series-1 estimate',
        })
    }
    return {
      date,
      bars,
      dot: false,
      unknown: Boolean(text) && !night,
      title: night
        ? `${dayLabel(date)} · ${clock(night.bed)} 睡 → ${clock(night.wake)} 醒，睡了 ${length(night.hours)}${night.up !== null ? `，${clock(night.up)} 起` : ''}`
        : `${dayLabel(date)} · 没认出几点睡、几点醒`,
      detail: row ? `${sourceLabel(row)}「${text}」` : '',
    }
  })
  // 22:00–10:00 unless a night reaches further.
  const reach = days.flatMap((day) => day.bars.flatMap((bar) => [bar.from, bar.to]))
  const lo = Math.floor(Math.min(...reach, 22) / 2) * 2
  const hi = Math.ceil(Math.max(...reach, 34) / 2) * 2
  const ticks: number[] = []
  for (let v = lo; v <= hi; v += 2) ticks.push(v)
  return (
    <ClockChart
      label={`睡眠，近 ${CLOCK_DAYS} 晚`}
      caption={`近 ${CLOCK_DAYS} 晚 · 几点睡到几点醒`}
      keys={
        <>
          <span className="key">
            <i className="series-1" />
            睡着
          </span>
          <span className="key">
            <i className="series-1 estimate" />
            醒了还没起
          </span>
          <span>？= 写了但没认出时间</span>
        </>
      }
      days={days}
      lo={lo}
      hi={hi}
      ticks={ticks}
      tickLabel={(v) => clock(v)}
      empty={`近 ${CLOCK_DAYS} 晚还没有睡眠记录。`}
    />
  )
}

function ExerciseChart({
  rows,
  today,
}: {
  rows: DiaryLedgerRow[]
  today: string
}): React.ReactElement {
  const written = byDay(rows, '运动')
  const days: ClockDay[] = lastDays(today, CLOCK_DAYS).map((date) => {
    const dayRows = written.get(date) ?? []
    const sessions = dayRows.flatMap((row) => parseExercise(row.cells['运动']))
    const bars = sessions.flatMap((session) =>
      session.start === null
        ? []
        : [
            {
              from: session.start,
              to: session.start + session.minutes / 60,
              className: session.exact ? 'series-1' : 'series-1 estimate',
            },
          ],
    )
    const described = sessions.map((session) =>
      session.start === null
        ? `没写几点${session.minutes ? `，${length(session.minutes / 60)}` : ''}`
        : session.exact
          ? `${clock(session.start)} 起 ${length(session.minutes / 60)}`
          : `约 ${clock(session.start)}${session.minutes === EXERCISE_DEFAULT_MINUTES && !/分|小时|钟头|min|h/i.test(session.text) ? '，时长没写，按 30 分钟画' : `，${length(session.minutes / 60)}`}`,
    )
    return {
      date,
      bars,
      dot: sessions.some((session) => session.start === null),
      unknown: false,
      title: `${dayLabel(date)} · ${described.join('；')}`,
      detail: dayRows.map((row) => `${sourceLabel(row)}「${row.cells['运动']}」`).join('；'),
    }
  })
  return (
    <ClockChart
      label={`运动，近 ${CLOCK_DAYS} 天`}
      caption={`近 ${CLOCK_DAYS} 天 · 几点开始、练了多久`}
      keys={
        <>
          <span className="key">
            <i className="series-1" />
            写了钟点和时长
          </span>
          <span className="key">
            <i className="series-1 estimate" />
            按「早上/晚上」估的
          </span>
          <span className="key">
            <i className="series-1 round" />
            没写几点
          </span>
        </>
      }
      days={days}
      lo={6}
      hi={24}
      ticks={[6, 9, 12, 15, 18, 21, 24]}
      tickLabel={(v) => `${v}:00`}
      lane="没写几点"
      empty={`近 ${CLOCK_DAYS} 天还没有运动记录。`}
    />
  )
}

/** Activity calendar of 大便 counts, one column per week, Monday on top. */
function BowelHeatmap({
  rows,
  today,
}: {
  rows: DiaryLedgerRow[]
  today: string
}): React.ReactElement {
  const [hover, setHover] = useState<{ date: string; x: number; y: number } | null>(null)
  const [ref, width] = useWidth()
  const written = byDay(rows, '大便')
  const todayIndex = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7
  const count = (BOWEL_WEEKS - 1) * 7 + todayIndex + 1
  const first = shiftDate(today, -(count - 1))
  const cells = Array.from({ length: count }, (_, i) => {
    const date = shiftDate(first, i)
    const dayRows = written.get(date) ?? []
    const counts = dayRows.map((row) => parseBowel(row.cells['大便']) ?? 0)
    return { date, rows: dayRows, count: dayRows.length ? Math.max(...counts) : null }
  })
  const recorded = cells.filter((cell) => cell.count !== null).length
  const months = cells.flatMap((cell, i) =>
    cell.date.endsWith('-01') || (i === 0 && Number(cell.date.slice(8)) <= 7)
      ? [{ column: Math.floor(i / 7), label: `${Number(cell.date.slice(5, 7))}月` }]
      : [],
  )
  const active = hover ? cells.find((cell) => cell.date === hover.date) : undefined
  const tip: Tip | null =
    active && hover
      ? {
          x: hover.x,
          y: hover.y + 30,
          title: `${dayLabel(active.date)} · ${active.count === null ? '没写' : `${active.count} 次`}`,
          detail: active.rows
            .map((row) => `${sourceLabel(row)}「${row.cells['大便']}」`)
            .join('；'),
        }
      : null
  return (
    <figure className="diary-ledger-chart" aria-label={`大便，近 ${BOWEL_WEEKS} 周`}>
      <figcaption>
        <b>大便</b>
        <span>
          近 {BOWEL_WEEKS} 周 · 每天几次 · 记了 {recorded} 天
        </span>
        <span className="gap" />
      </figcaption>
      <div ref={ref} className="diary-ledger-chart-plot diary-ledger-heat">
        <div className="weekday" aria-hidden="true">
          {['一', '', '三', '', '五', '', '日'].map((name, i) => (
            <span key={i}>{name}</span>
          ))}
        </div>
        <div>
          <div
            className="months"
            aria-hidden="true"
            style={{ gridTemplateColumns: `repeat(${BOWEL_WEEKS}, 14px)` }}
          >
            {months.map((month) => (
              <span key={month.column} style={{ gridColumn: `${month.column + 1} / span 3` }}>
                {month.label}
              </span>
            ))}
          </div>
          <div
            className="cells"
            style={{ gridTemplateColumns: `repeat(${BOWEL_WEEKS}, 14px)` }}
            onMouseLeave={() => setHover(null)}
          >
            {cells.map((cell, i) => (
              <i
                key={cell.date}
                role="img"
                aria-label={`${cell.date} ${cell.count === null ? '没写' : `${cell.count} 次`}`}
                className={`heat ${cell.count === null ? 'none' : `level-${Math.min(4, cell.count)}`}${hover?.date === cell.date ? ' on' : ''}`}
                style={{ gridColumn: Math.floor(i / 7) + 1, gridRow: (i % 7) + 1 }}
                onMouseEnter={(event) => {
                  const box = event.currentTarget.getBoundingClientRect()
                  const plot = ref.current?.getBoundingClientRect()
                  if (plot)
                    setHover({ date: cell.date, x: box.right - plot.left, y: box.top - plot.top })
                }}
              />
            ))}
          </div>
        </div>
        <ChartTip tip={tip} width={width} />
      </div>
      <div className="diary-ledger-heat-legend">
        0 次
        {[0, 1, 2, 3, 4].map((level) => (
          <i key={level} className={`heat level-${level}`} />
        ))}
        4 次及以上
        <i className="heat none" />
        没写
      </div>
    </figure>
  )
}

/**
 * 财务 / 健康 (mockup v3, v5 for the folded details and the 健康 charts): the diary's header lines for these fields read live, plus the page's own
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
  /** Oldest day the details show; null while they are folded. Resets when the page is left. */
  const [shownFrom, setShownFrom] = useState<string | null>(null)
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
      // Unfold far enough, in whole weeks back from today, to show the new row.
      if (!shownFrom || date < shownFrom) {
        const back = Math.max(0, Math.round((Date.parse(today) - Date.parse(date)) / 86400000))
        setShownFrom(shiftDate(today, -(Math.floor(back / 7) * 7 + 6)))
      }
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
  /** One more week of details; weeks with nothing in them are skipped. */
  const nextWeek = (from: string | null): string => {
    let next = shiftDate(from ?? shiftDate(today, 1), -7)
    while (
      rows &&
      !rows.some((row) => row.date >= next && (!from || row.date < from)) &&
      rows.some((row) => row.date < next)
    )
      next = shiftDate(next, -7)
    return next
  }
  const shown = rows && shownFrom ? rows.filter((row) => row.date >= shownFrom) : []
  const more = Boolean(rows && shownFrom && rows.some((row) => row.date < shownFrom))
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
            className={field === '体重' || field === '大便' ? 'narrow' : undefined}
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
          <>
            <WeightChart rows={rows} today={today} />
            <SleepChart rows={rows} today={today} />
            <ExerciseChart rows={rows} today={today} />
            <BowelHeatmap rows={rows} today={today} />
          </>
        ) : (
          <MoneyChart rows={rows} today={today} />
        ))}
      {rows && !rows.length && (
        <p className="muted">
          还没有{kind.fields.join('、')}记录。在上面记一条，或在日记开头对应的行里填写。
        </p>
      )}
      {rows && rows.length > 0 && !shownFrom && (
        <div className="diary-ledger-fold">
          <button type="button" onClick={() => setShownFrom(nextWeek(null))}>
            ▸ 明细 · 共 {rows.length} 条，展开最近一周
          </button>
        </div>
      )}
      {rows && shownFrom && (
        <table className="diary-ledger-table" aria-label="明细">
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
            {shown.map((row, index) => (
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
      {rows && shownFrom && (
        <div className="diary-ledger-fold">
          {more && (
            <button type="button" onClick={() => setShownFrom(nextWeek(shownFrom))}>
              ▾ 再展开一周（到 {short(nextWeek(shownFrom))}）
            </button>
          )}
          <button type="button" className="quiet" onClick={() => setShownFrom(null)}>
            收起
          </button>
          <span className="muted">
            已显示 {short(shownFrom)} 以来 · {shown.length} 条 / 共 {rows.length} 条
          </span>
        </div>
      )}
    </div>
  )
}
