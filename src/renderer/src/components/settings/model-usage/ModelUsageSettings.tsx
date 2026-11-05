import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  usageCategories,
  usageCategoryLabels,
  tokenFields,
  type ModelUsageRecord,
  type UsageCategory,
  type UsageGroup,
  type UsageQuery,
  type UsageResult,
  type UsageSnapshot,
} from '@shared/model-usage'
import type { UsageImportResult } from '@shared/ipc/model-usage'
import { UsageActivity, UsageTrend, type UsageSelection } from './UsageCharts'
import { compact, dateAt, midnight, nextDate, total } from './usage-view'
import './model-usage.css'
const api = () => window.cclinkStudio.modelUsage
const number = (value: number | null) => (value === null ? '未提供' : value.toLocaleString())
const time = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const statusLabels = {
  'in-progress': '进行中',
  succeeded: '成功',
  failed: '失败',
  interrupted: '中断',
  unknown: '未知',
}
function unwrap<T>(result: UsageResult<T>): T {
  if (!result.success) throw new Error(`${result.error.message} (${result.error.code})`)
  return result.value
}
export function ModelUsageSettings() {
  const today = dateAt(Date.now())
  const [from, setFrom] = useState(nextDate(today, -29)),
    [to, setTo] = useState(today)
  const [workspace, setWorkspace] = useState(''),
    [model, setModel] = useState(''),
    [category, setCategory] = useState('')
  const [exclude, setExclude] = useState(false),
    [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null)
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<UsageSelection | null>(null),
    [offset, setOffset] = useState(0)
  const [calls, setCalls] = useState<{ total: number; records: ModelUsageRecord[] } | null>(null)
  const [tab, setTab] = useState<'overview' | 'calls'>('overview')
  const [revision, setRevision] = useState(0)
  const generation = useRef(0)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const valid = Number.isFinite(midnight(from)) && Number.isFinite(midnight(to)) && from <= to
  const query = useMemo<UsageQuery | null>(
    () =>
      valid
        ? {
            from: new Date(midnight(from)).toISOString(),
            to: new Date(midnight(nextDate(to))).toISOString(),
            ...(workspace ? { workspace } : {}),
            ...(model ? { model } : {}),
            ...(category ? { category: category as UsageCategory } : {}),
          }
        : null,
    [valid, from, to, workspace, model, category],
  )
  useEffect(() => {
    setSelection(null)
    setOffset(0)
  }, [query, exclude])
  useEffect(() => {
    setSnapshot(null)
  }, [query])
  useEffect(() => {
    if (!query) return
    let alive = true,
      running = false
    const current = ++generation.current
    async function refresh() {
      if (running) return
      running = true
      try {
        const value = unwrap(await api().snapshot(query!))
        if (alive && current === generation.current) {
          setSnapshot(value)
          setError('')
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '统计不可用')
      } finally {
        running = false
      }
    }
    void refresh()
    const timer = setInterval(() => {
      if (!document.hidden && !busyRef.current) void refresh()
    }, 15000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [query, revision])
  const detailQuery = useMemo(
    () =>
      query ? { ...query, ...(selection ? { from: selection.from, to: selection.to } : {}) } : null,
    [query, selection],
  )
  const refreshCalls = useCallback(async () => {
    if (!detailQuery) return null
    return unwrap(await api().calls(detailQuery, offset, exclude))
  }, [detailQuery, offset, exclude])
  useEffect(() => {
    if (tab !== 'calls') return
    let alive = true
    setCalls(null)
    void refreshCalls()
      .then((value) => {
        if (alive) setCalls(value)
      })
      .catch((e) => {
        if (alive) setError(String(e.message ?? e))
      })
    return () => {
      alive = false
    }
  }, [refreshCalls, tab, revision])
  async function action<T>(perform: () => Promise<UsageResult<T>>, describe: (value: T) => string) {
    if (busy) return false
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const value = unwrap(await perform())
      setMessage(describe(value))
      setRevision((n) => n + 1)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
      return false
    } finally {
      setBusy(false)
    }
  }
  async function changeRecording(enabled: boolean) {
    if (!snapshot || busy) return
    const previous = snapshot.enabled
    setSnapshot((current) => (current ? { ...current, enabled } : current))
    const saved = await action(
      () => api().setEnabled(enabled),
      () => '采集设置已保存；在途任务记录到结束，新任务按新设置执行。',
    )
    if (!saved) setSnapshot((current) => (current ? { ...current, enabled: previous } : current))
  }
  function select(value: UsageSelection) {
    setSelection(value)
    setOffset(0)
    setTab('calls')
  }
  function preset(kind: 'today' | 'week' | 'month' | '30') {
    setTo(today)
    setFrom(
      kind === 'today'
        ? today
        : kind === 'month'
          ? `${today.slice(0, 7)}-01`
          : kind === 'week'
            ? nextDate(today, -((new Date(`${today}T12:00:00+08:00`).getUTCDay() + 6) % 7))
            : nextDate(today, -29),
    )
  }
  const scope = snapshot ? (exclude ? snapshot.excludingDevelopment : snapshot.all) : null
  const importMessage = (value: UsageImportResult | null) =>
    value
      ? `新增 ${value.inserted} 条，重复 ${value.replayed} 条；异常行 ${value.invalidLines ?? 0}，待完成行 ${value.pendingLines ?? 0}，无法识别 ${value.unidentifiable ?? 0}。`
      : '已取消'
  return (
    <section className="model-usage-settings" aria-label="模型用量">
      <div className="mu-heading">
        <div>
          <h2>模型用量</h2>
          <p>查看使用频率、消耗趋势，以及用量花在哪些工作上。</p>
        </div>
        <div className="mu-actions">
          <button
            disabled={busy || !query}
            onClick={() =>
              query &&
              void action(
                () => api().exportFile({ query, format: 'csv', excludeDevelopment: exclude }),
                (value) => (value ? `已导出 ${value.calls} 条调用：${value.path}` : '已取消'),
              )
            }
          >
            导出 CSV
          </button>
          <button
            disabled={busy || !query}
            onClick={() =>
              query &&
              void action(
                () => api().exportFile({ query, format: 'json', excludeDevelopment: exclude }),
                (value) => (value ? `已导出 ${value.calls} 条调用：${value.path}` : '已取消'),
              )
            }
          >
            导出 JSON
          </button>
        </div>
      </div>
      <div className="mu-recording">
        <label>
          <input
            type="checkbox"
            checked={snapshot?.enabled ?? false}
            disabled={!snapshot || busy || snapshot.environmentDisabled}
            onChange={(e) => void changeRecording(e.target.checked)}
          />{' '}
          自动记录模型用量
        </label>
        <span>
          {snapshot?.environmentDisabled
            ? '环境变量已关闭采集'
            : snapshot?.enabled
              ? '本机采集已开启'
              : '采集已关闭'}{' '}
          · 只保存元数据
        </span>
      </div>
      <div className="mu-filters">
        <div className="mu-actions">
          <button onClick={() => preset('today')}>今日</button>
          <button onClick={() => preset('week')}>本周</button>
          <button onClick={() => preset('month')}>本月</button>
          <button onClick={() => preset('30')}>近 30 天</button>
        </div>
        <div className="mu-actions">
          <input
            aria-label="开始日期"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />{' '}
          至{' '}
          <input
            aria-label="结束日期（含当天）"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <span>北京时间</span>
        </div>
      </div>
      <div className="mu-filters">
        <div className="mu-actions">
          <button aria-pressed={!exclude} onClick={() => setExclude(false)}>
            全部工作量
          </button>
          <button aria-pressed={exclude} onClick={() => setExclude(true)}>
            排除开发
          </button>
        </div>
        <div className="mu-actions">
          <select
            aria-label="工作空间"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          >
            <option value="">全部工作空间</option>
            {snapshot?.workspaces.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select aria-label="模型筛选" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">全部模型</option>
            {snapshot?.models.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="任务类别筛选"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">全部类别</option>
            {usageCategories.map((value) => (
              <option key={value} value={value}>
                {usageCategoryLabels[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!valid && (
        <p role="alert" className="mu-warning">
          请选择有效日期，结束日期不得早于开始日期。
        </p>
      )}
      {error && (
        <div role="alert" className="mu-warning">
          {error} <button onClick={() => setRevision((n) => n + 1)}>重试</button>
        </div>
      )}
      {message && (
        <p role="status" className="mu-notice">
          {message}
        </p>
      )}
      {busy && <p role="status">正在处理，请稍候…</p>}
      {!snapshot && !error && <p role="status">正在读取本机统计…</p>}
      {snapshot && scope && (
        <>
          <div className="mu-metrics">
            <div>
              <span>输入 Token</span>
              <strong>{number(scope.tokens.input.value)}</strong>
              <small>不含缓存读写 · 缺失 {scope.tokens.input.missingCalls} 次</small>
            </div>
            <div>
              <span>输出 Token</span>
              <strong>{number(scope.tokens.output.value)}</strong>
              <small>包含思考 · 独立思考 {number(scope.tokens.thinking.value)}</small>
            </div>
            <div>
              <span>缓存读取 Token</span>
              <strong>{number(scope.tokens.cacheRead.value)}</strong>
              <small>缓存写入 {number(scope.tokens.cacheWrite.value)}</small>
            </div>
          </div>
          <p className="mu-counts">
            {scope.calls.toLocaleString()} 次调用 · {scope.executions} 次执行 · {scope.tasks}{' '}
            个已知任务 · {scope.failed} 次失败 · {scope.interrupted} 次中断 · {scope.retriedCalls}{' '}
            次已观察重试
          </p>
          <p className="mu-note">
            仅包含 Studio 本机 Claude Code 的可观测调用。
            {exclude && '仅排除显式标为“开发”的记录；未分类仍保留。'}
            一次用户发起或定时触发算一次执行；无执行归属 {
              scope.callsWithoutTask
            } 次，重试情况未知 {scope.callsWithUnknownRetry} 次。
          </p>
          {(scope.coverage.partial > 0 || scope.coverage.none > 0) && (
            <p className="mu-warning">
              完整 usage {scope.coverage.complete} · 部分 usage {scope.coverage.partial} · 无 usage{' '}
              {scope.coverage.none}。缺失项未计入总量；思考未独立返回也会列为部分 usage。
            </p>
          )}
          {snapshot.lastError && (
            <p className="mu-warning" role="alert">
              采集曾发生异常：{snapshot.lastError.code} · {time(snapshot.lastError.timestamp)}
              。请回填日志核对缺口；历史告警不会因一次成功而消失。
            </p>
          )}
          {snapshot.runsWithoutCalls > 0 && (
            <p className="mu-warning">
              该时段有 {snapshot.runsWithoutCalls}{' '}
              次执行没有可识别调用，无法判断是否产生费用；失败执行共 {snapshot.failedRuns} 次。
            </p>
          )}
          <div className="mu-tabs">
            <button aria-pressed={tab === 'overview'} onClick={() => setTab('overview')}>
              用量概览
            </button>
            <button aria-pressed={tab === 'calls'} onClick={() => setTab('calls')}>
              调用明细与分类
            </button>
            <button disabled={busy} onClick={() => setRevision((n) => n + 1)}>
              刷新
            </button>
          </div>
          {tab === 'overview' ? (
            <>
              {!scope.calls && (
                <p className="mu-notice">
                  所选范围没有已记录调用。可调整日期或从下方回填历史日志；这不代表实际消耗为零。
                </p>
              )}
              <UsageActivity snapshot={snapshot} exclude={exclude} onSelect={select} />
              <UsageTrend scope={scope} snapshot={snapshot} onSelect={select} />
              <details className="mu-section">
                <summary>按工作空间、任务类别、模型汇总</summary>
                <GroupTable title="工作空间" rows={scope.byWorkspace} />
                <GroupTable title="任务类别" rows={scope.byCategory} />
                <GroupTable title="模型" rows={scope.byModel} />
              </details>
              <details className="mu-section">
                <summary>高峰窗口与数据覆盖</summary>
                <div className="mu-peak-grid">
                  {[
                    ['滚动 5 小时', scope.peak5Hours],
                    ['滚动 7 天', scope.peak7Days],
                  ].map(([label, raw]) => {
                    const peak = raw as typeof scope.peak5Hours
                    return (
                      <div key={String(label)}>
                        <h4>{String(label)}</h4>
                        <strong>
                          {peak ? `${compact(peak.knownTokens)} 已知 Token` : '无记录'}
                        </strong>
                        <p>{peak && `${time(peak.from)} — ${time(peak.to)}`}</p>
                      </div>
                    )
                  })}
                </div>
                <p className="mu-note">
                  分析窗口不等于套餐刷新窗口，只包含所选范围内的记录。调用时间按首次观测归属；不代表服务商实际计费时刻。
                </p>
                <p>
                  该时段尚未结束运行 {snapshot.unfinishedRuns} · 主调用汇总对账不一致{' '}
                  {snapshot.mismatchedRuns}
                </p>
                <div className="mu-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>字段</th>
                        <th>已知值</th>
                        <th>缺失调用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokenFields.map((field) => (
                        <tr key={field}>
                          <td>
                            {
                              {
                                input: '输入',
                                output: '输出',
                                cacheRead: '缓存读取',
                                cacheWrite: '缓存写入',
                                thinking: '思考',
                              }[field]
                            }
                          </td>
                          <td>{number(scope.tokens[field].value)}</td>
                          <td>{scope.tokens[field].missingCalls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          ) : (
            <section className="mu-section">
              <div className="mu-heading">
                <h3>{selection ? `${selection.label} · 调用明细` : '所选范围的调用明细'}</h3>
                {selection && (
                  <button
                    onClick={() => {
                      setSelection(null)
                      setOffset(0)
                    }}
                  >
                    返回整个范围
                  </button>
                )}
              </div>
              <p className="mu-note">
                每行是一条可识别的模型调用，包含工具后的继续推理。分类优先按本次执行，其次任务、会话；无法判断时保留未分类。
              </p>
              {!calls ? (
                <p role="status">正在读取明细…</p>
              ) : (
                <>
                  <p>
                    共 {calls.total} 条 · 显示 {calls.total ? offset + 1 : 0}—
                    {Math.min(offset + 50, calls.total)}
                  </p>
                  <div className="mu-call-list">
                    {calls.records.map((row) => (
                      <CallRow
                        key={row.id}
                        row={row}
                        busy={busy}
                        onClassify={(target) =>
                          void action(
                            () => api().classify(target),
                            () => '分类已保存，概览和导出同步生效。',
                          )
                        }
                      />
                    ))}
                  </div>
                  <div className="mu-actions">
                    <button
                      disabled={offset === 0}
                      onClick={() => setOffset((n) => Math.max(0, n - 50))}
                    >
                      上一页
                    </button>
                    <button
                      disabled={offset + 50 >= calls.total}
                      onClick={() => setOffset((n) => n + 50)}
                    >
                      下一页
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
          <details className="mu-section">
            <summary>历史数据、采集设置与费用</summary>
            <p>
              可用记录：{snapshot.earliest ? time(snapshot.earliest) : '尚无记录'} —{' '}
              {snapshot.latest ? time(snapshot.latest) : '尚无记录'}。起止日期不证明中间连续覆盖。
            </p>
            <div className="mu-actions">
              <button
                disabled={busy}
                onClick={() => void action(() => api().backfill(false), importMessage)}
              >
                回填 Studio 历史
              </button>
              <button
                disabled={busy}
                onClick={() => void action(() => api().backfill(true), importMessage)}
              >
                选择日志目录
              </button>
              <button
                disabled={busy}
                onClick={() => void action(() => api().importFile(), importMessage)}
              >
                导入其他来源 JSON
              </button>
            </div>
            <p className="mu-note">
              回填包括子代理，重复导入不会重复累计。其他机器使用 JSON 交换；来源保留。CSV
              空值表示缺失，不用于回导。
            </p>
            <p className="mu-path">
              数据位置：{snapshot.database}
              <br />
              本机来源：{snapshot.originId}
            </p>
            <p>
              关闭采集从下一次执行生效，在途任务记录到结束；历史仍可查看和导出。Claude Code
              自身的会话日志不受此开关控制。
            </p>
            <p>
              实际账单：未录入。价格估算：未启用，保留可配置价格接口。不将
              prompts、套餐积分换算为固定 Token。
            </p>
            <p className="mu-note">
              远程 Agent、Codex ACP、外部独立 Claude 和媒体服务尚未接入本统计。SDK
              隐藏调用或未落盘的崩溃请求无法补造；缺失值不代表免费。
            </p>
          </details>
        </>
      )}
    </section>
  )
}
function GroupTable({ title, rows }: { title: string; rows: UsageGroup[] }) {
  return (
    <div className="mu-table-wrap">
      <h4>{title}</h4>
      <table>
        <thead>
          <tr>
            <th>{title}</th>
            <th>调用</th>
            <th>执行</th>
            <th>输入</th>
            <th>输出</th>
            <th>缓存读／写</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.calls}</td>
              <td>{row.executions}</td>
              <td>{compact(row.tokens.input.value)}</td>
              <td>{compact(row.tokens.output.value)}</td>
              <td>
                {compact(row.tokens.cacheRead.value)} / {compact(row.tokens.cacheWrite.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
function CallRow({
  row,
  busy,
  onClassify,
}: {
  row: ModelUsageRecord
  busy: boolean
  onClassify(target: {
    kind: 'run' | 'task' | 'session'
    id: string
    category: UsageCategory
  }): void
}) {
  const [kind, setKind] = useState<'run' | 'task' | 'session'>(
    row.runId ? 'run' : row.taskId ? 'task' : 'session',
  )
  const id = kind === 'run' ? row.runId : kind === 'task' ? row.taskId : row.sessionId
  return (
    <details className="mu-call">
      <summary>
        <span>
          {time(row.timestamp)} · {row.model ?? '未知模型'}
        </span>
        <span>
          {usageCategoryLabels[row.category]} · {statusLabels[row.status]} ·{' '}
          {compact(
            total({
              tokens: Object.fromEntries(
                tokenFields.map((field) => [
                  field,
                  {
                    value: row.normalized[field],
                    missingCalls: row.normalized[field] === null ? 1 : 0,
                  },
                ]),
              ),
            } as UsageGroup),
          )}{' '}
          已知 Token
        </span>
      </summary>
      <div className="mu-actions">
        <label>
          分类范围{' '}
          <select
            aria-label="分类范围"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {row.runId && <option value="run">本次执行</option>}
            {row.taskId && <option value="task">此任务</option>}
            {row.sessionId && <option value="session">此会话</option>}
          </select>
        </label>
        <label>
          任务类别{' '}
          <select
            aria-label="设置任务类别"
            value={row.category}
            disabled={busy || !id}
            onChange={(e) =>
              id && onClassify({ kind, id, category: e.target.value as UsageCategory })
            }
          >
            {usageCategories.map((value) => (
              <option key={value} value={value}>
                {usageCategoryLabels[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        输入 {number(row.normalized.input)} · 输出 {number(row.normalized.output)} · 缓存读{' '}
        {number(row.normalized.cacheRead)} · 缓存写 {number(row.normalized.cacheWrite)} · 思考{' '}
        {number(row.normalized.thinking)}
      </p>
      <p>
        服务商 {row.provider ?? '未确认'} · 用量{' '}
        {row.coverage === 'complete' ? '完整' : row.coverage === 'partial' ? '部分' : '未提供'} ·
        来源 {row.sources.join('、')} · 耗时{' '}
        {row.durationMs === null ? '未提供' : `${row.durationMs} ms（流式观测）`} · 重试序号{' '}
        {row.retryOrdinal ?? '未知'}
      </p>
      <pre>
        {JSON.stringify(
          {
            id: row.id,
            originId: row.originId,
            workspace: row.workspace,
            instanceId: row.instanceId,
            runId: row.runId,
            taskId: row.taskId,
            sessionId: row.sessionId,
            requestId: row.requestId,
            parentToolUseId: row.parentToolUseId,
            rawUsage: row.rawUsage,
            normalized: row.normalized,
            estimated: row.estimated,
            final: row.final,
            missing: row.missing,
            missingMetadata: row.missingMetadata,
          },
          null,
          2,
        )}
      </pre>
    </details>
  )
}
