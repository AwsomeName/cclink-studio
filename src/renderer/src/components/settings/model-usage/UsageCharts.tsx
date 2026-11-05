import { useMemo, useState } from 'react'
import type { UsageScope, UsageSnapshot } from '@shared/model-usage'
import {
  activityStreak,
  compact,
  dateAt,
  dates,
  dayCoverage,
  midnight,
  nextDate,
  periodKey,
  total,
  DAY,
} from './usage-view'
export interface UsageSelection {
  from: string
  to: string
  label: string
}
export function UsageActivity({
  snapshot,
  exclude,
  onSelect,
}: {
  snapshot: UsageSnapshot
  exclude: boolean
  onSelect(selection: UsageSelection): void
}) {
  const [metric, setMetric] = useState<'calls' | 'tokens'>('calls')
  const rows = exclude ? snapshot.activity.excludingDevelopment : snapshot.activity.all
  const end = dateAt(Date.parse(snapshot.activity.to) - 1)
  const calendar = dates(nextDate(end, -364), end)
  const lookup = new Map(rows.map((row) => [row.name, row]))
  const ceiling = Math.max(
    1,
    ...snapshot.activity.all.map((row) => (metric === 'calls' ? row.calls : total(row))),
  )
  const leading = (new Date(midnight(calendar[0]) + 8 * 3600000).getUTCDay() + 6) % 7
  const active = rows.filter((row) => row.calls > 0).length
  const columns = Math.ceil((calendar.length + leading) / 7)
  return (
    <section className="mu-section">
      <div className="mu-heading">
        <div>
          <h3>使用活跃度</h3>
          <p>
            截至 {end} 的近一年 · 已观察到 {active} 个活跃日 · 连续有调用记录{' '}
            {activityStreak(rows, end)} 天
          </p>
        </div>
        <label>
          颜色表示{' '}
          <select
            aria-label="活跃度指标"
            value={metric}
            onChange={(e) => setMetric(e.target.value as 'calls' | 'tokens')}
          >
            <option value="calls">调用次数</option>
            <option value="tokens">已知 Token</option>
          </select>
        </label>
      </div>
      <div
        className="mu-months"
        aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {calendar.flatMap((date, index) =>
          date.endsWith('-01') && Math.floor((index + leading) / 7) < columns - 2 ? (
            <span
              key={date}
              style={{ gridColumn: `${Math.floor((index + leading) / 7) + 1} / span 3` }}
            >
              {Number(date.slice(5, 7))}月
            </span>
          ) : (
            []
          ),
        )}
      </div>
      <div className="mu-calendar" aria-label="按北京时间统计的每日活跃热力图">
        {Array.from({ length: leading }, (_, i) => (
          <span key={`empty-${i}`} />
        ))}
        {calendar.map((date) => {
          const row = lookup.get(date),
            value = metric === 'calls' ? (row?.calls ?? 0) : total(row)
          const coverage = dayCoverage(date, snapshot.periods, snapshot.originId)
          const level = value > 0 ? Math.min(4, 1 + Math.floor((value / ceiling) * 3)) : 0
          const unknown = !row && coverage !== 'observed'
          const description = `${date} · ${row ? `${row.calls} 次调用 · ${compact(total(row))} 已知 Token · 无 usage ${row.coverage.none} 次` : coverage === 'observed' ? '本机已记录，无调用' : coverage === 'partial' ? '采集覆盖不完整，无已知调用' : '未记录'}；${coverage === 'observed' ? '本机全天已观测' : '无法证明全天完整覆盖'}`
          return (
            <button
              type="button"
              key={date}
              className={`mu-day mu-level-${level}${unknown ? ' mu-unrecorded' : ''}`}
              title={description}
              aria-label={description}
              onClick={() =>
                onSelect({
                  from: new Date(midnight(date)).toISOString(),
                  to: new Date(midnight(nextDate(date))).toISOString(),
                  label: date,
                })
              }
            />
          )
        })}
      </div>
      <div className="mu-legend mu-between">
        <span>
          {calendar[0]} — {end} · 点击日期查看明细
        </span>
        <span>
          少{' '}
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className={`mu-day mu-level-${level}`} />
          ))}{' '}
          多 <i className="mu-day mu-unrecorded" /> 未记录／覆盖不完整
        </span>
      </div>
    </section>
  )
}
export function UsageTrend({
  scope,
  snapshot,
  onSelect,
}: {
  scope: UsageScope
  snapshot: UsageSnapshot
  onSelect(selection: UsageSelection): void
}) {
  const [stack, setStack] = useState<'tokens' | 'model'>('tokens')
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>('day')
  const duration = (Date.parse(snapshot.range.to) - Date.parse(snapshot.range.from)) / DAY
  const granularity = duration > 370 ? 'month' : duration > 90 && grain === 'day' ? 'week' : grain
  const modelNames = useMemo(
    () => snapshot.all.byModel.map((row) => row.name).sort(),
    [snapshot.all.byModel],
  )
  const displayedModels = modelNames.slice(0, 5)
  const names =
    stack === 'tokens'
      ? ['输入（不含缓存）', '输出（含思考）', '缓存读写']
      : [...displayedModels, ...(modelNames.length > 5 ? ['其他模型'] : [])]
  const buckets = new Map<string, number[]>()
  const fromDate = dateAt(Date.parse(snapshot.range.from)),
    toDate = dateAt(Date.parse(snapshot.range.to) - 1)
  for (const date of dates(fromDate, toDate))
    buckets.set(periodKey(date, granularity), Array(names.length).fill(0))
  if (stack === 'tokens')
    for (const row of scope.byDay) {
      const values = buckets.get(periodKey(row.name, granularity))
      if (values) {
        values[0] += row.tokens.input.value ?? 0
        values[1] += row.tokens.output.value ?? 0
        values[2] += (row.tokens.cacheRead.value ?? 0) + (row.tokens.cacheWrite.value ?? 0)
      }
    }
  else
    for (const row of scope.byDayModel) {
      const values = buckets.get(periodKey(row.date, granularity)),
        found = displayedModels.indexOf(row.model)
      if (values) values[found >= 0 ? found : 5] += row.knownTokens
    }
  const peak =
    Math.max(1, ...[...buckets.values()].map((values) => values.reduce((a, b) => a + b, 0))) * 1.1
  const entries = [...buckets.entries()]
  return (
    <section className="mu-section">
      <div className="mu-heading">
        <div>
          <h3>用量趋势</h3>
          <p>
            已知合计 {compact(total(scope))} Token · 按
            {granularity === 'day' ? '日' : granularity === 'week' ? '周' : '月'}汇总
          </p>
        </div>
        <div className="mu-actions">
          <select
            aria-label="柱状图粒度"
            value={grain}
            onChange={(e) => setGrain(e.target.value as typeof grain)}
          >
            <option value="day">每日</option>
            <option value="week">每周</option>
            <option value="month">每月</option>
          </select>
          <button aria-pressed={stack === 'tokens'} onClick={() => setStack('tokens')}>
            按 Token 类型
          </button>
          <button aria-pressed={stack === 'model'} onClick={() => setStack('model')}>
            按模型
          </button>
        </div>
      </div>
      <div className="mu-legend">
        {names.map((name, i) => (
          <span key={name}>
            <i style={{ background: `var(--mu-series-${i})` }} />
            {name}
          </span>
        ))}
      </div>
      <div className="mu-chart" role="group" aria-label="已知 Token 用量堆叠柱状图">
        <div className="mu-yaxis">
          <span>{compact(peak)}</span>
          <span>{compact(peak / 2)}</span>
          <span>0</span>
        </div>
        <div className="mu-bars">
          {entries.map(([key, values], index) => {
            const value = values.reduce((a, b) => a + b, 0)
            const first = granularity === 'month' ? `${key}-01` : key
            const next = entries[index + 1]?.[0]
            const endDate = next
              ? granularity === 'month'
                ? `${next}-01`
                : next
              : nextDate(toDate)
            return (
              <div className="mu-bar-column" key={key}>
                <button
                  className="mu-bar-hit"
                  aria-label={`${key} · ${compact(value)} 已知 Token；查看调用`}
                  title={`${key}\n${names.map((name, i) => `${name}：${values[i].toLocaleString()} Token`).join('\n')}\n缺失字段未计入柱高`}
                  onClick={() =>
                    onSelect({
                      from: new Date(
                        Math.max(midnight(first), Date.parse(snapshot.range.from)),
                      ).toISOString(),
                      to: new Date(
                        Math.min(midnight(endDate), Date.parse(snapshot.range.to)),
                      ).toISOString(),
                      label: key,
                    })
                  }
                >
                  {values.map((v, i) => (
                    <span
                      key={names[i]}
                      style={{
                        height: `${(v / peak) * 100}%`,
                        background: `var(--mu-series-${i})`,
                      }}
                    />
                  ))}
                  {value === 0 && <span className="mu-empty-bar">·</span>}
                </button>
                <span className="mu-xlabel">
                  {index % Math.max(1, Math.ceil(entries.length / 7)) === 0 ||
                  index === entries.length - 1
                    ? key.slice(5)
                    : ''}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <p className="mu-note">
        横轴：北京时间日期 · 纵轴：已知
        Token。缓存单列，思考已包含在输出中；没有柱高不代表免费或没有调用。范围较长时自动按周／月汇总。
      </p>
    </section>
  )
}
