import type { ModelUsageRecord, UsageConfig, UsageRun } from '../../shared/model-usage'
import { tokenFields, usageCategoryLabels } from '../../shared/model-usage'
import { normalizeUsage } from './model-usage-normalize'

export const categoryLabels = usageCategoryLabels
const DAY = 86_400_000
const OFFSET = 8 * 3_600_000
export function beijingDate(iso: string): string {
  return new Date(Date.parse(iso) + OFFSET).toISOString().slice(0, 10)
}
export function beijingTime(iso: string): string {
  return new Date(Date.parse(iso) + OFFSET).toISOString().replace('T', ' ').slice(0, 19)
}
export function parseBoundary(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00+08:00`)
    if (Number.isFinite(parsed.getTime()) && beijingDate(parsed.toISOString()) === value)
      return parsed.toISOString()
  } else if (/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString()
  }
  throw new Error('日期须为 YYYY-MM-DD（北京时间）或带时区的 ISO 时间')
}
export function timeRange(options: {
  day?: string
  week?: string
  month?: string
  from?: string
  to?: string
}): { from: string; to: string } {
  let from: string
  let to: string
  if (Object.values(options).filter(Boolean).length === 0)
    options = { month: beijingDate(new Date().toISOString()).slice(0, 7) }
  const periods = [options.day, options.week, options.month, options.from || options.to].filter(
    Boolean,
  )
  if (periods.length !== 1) throw new Error('请选择 day、week、month 或 from/to 中一种范围')
  if (options.day || options.week) {
    from = parseBoundary(options.day ?? options.week!)
    if (options.week) {
      const weekday = new Date(Date.parse(from) + OFFSET).getUTCDay()
      from = new Date(Date.parse(from) - ((weekday + 6) % 7) * DAY).toISOString()
    }
    to = new Date(Date.parse(from) + (options.week ? 7 : 1) * DAY).toISOString()
  } else if (options.month) {
    if (!/^\d{4}-\d{2}$/.test(options.month)) throw new Error('month 须为 YYYY-MM')
    from = parseBoundary(`${options.month}-01`)
    const next = new Date(Date.parse(from) + OFFSET)
    next.setUTCMonth(next.getUTCMonth() + 1)
    to = new Date(next.getTime() - OFFSET).toISOString()
  } else {
    if (!options.from || !options.to) throw new Error('from 与 to 必须同时提供；to 为不包含的上界')
    from = parseBoundary(options.from)
    to = parseBoundary(options.to)
  }
  if (from >= to) throw new Error('时间范围必须满足 from < to')
  return { from, to }
}

export function classified(record: ModelUsageRecord, config: UsageConfig): ModelUsageRecord {
  return {
    ...record,
    category:
      (record.runId ? config.runCategories[record.runId] : undefined) ??
      (record.taskId ? config.taskCategories[record.taskId] : undefined) ??
      (record.sessionId ? config.sessionCategories[record.sessionId] : undefined) ??
      record.category,
  }
}
export function classifyRun(run: UsageRun, config: UsageConfig): UsageRun {
  return {
    ...run,
    category:
      config.runCategories[run.id] ??
      (run.taskId ? config.taskCategories[run.taskId] : undefined) ??
      (run.sessionId ? config.sessionCategories[run.sessionId] : undefined) ??
      run.category,
  }
}
export function summarize(records: ModelUsageRecord[], runs: UsageRun[] = []) {
  const tokens = Object.fromEntries(
    tokenFields.map((field) => {
      const known = records.filter((record) => record.normalized[field] !== null)
      return [
        field,
        {
          value: known.length
            ? known.reduce((sum, record) => sum + record.normalized[field]!, 0)
            : null,
          missingCalls: records.length - known.length,
        },
      ]
    }),
  ) as Record<(typeof tokenFields)[number], { value: number | null; missingCalls: number }>
  return {
    calls: records.length,
    tasks: new Set(
      [...records, ...runs]
        .map((record) => (record.taskId ? `${record.originId}:task:${record.taskId}` : null))
        .filter(Boolean),
    ).size,
    executions: new Set(
      [
        ...records.map((row) => (row.runId ? `${row.originId}:${row.runId}` : null)),
        ...runs.map((row) => `${row.originId}:${row.id}`),
      ].filter(Boolean),
    ).size,
    taskCountBasis:
      'tasks are distinct explicit task definitions; executions are distinct Studio runs (one user turn)',
    callsWithoutTask: records.filter((record) => !record.taskId && !record.runId).length,
    failed: records.filter((record) => record.status === 'failed').length,
    interrupted: records.filter((record) => record.status === 'interrupted').length,
    unknownStatus: records.filter(
      (record) => record.status === 'unknown' || record.status === 'in-progress',
    ).length,
    retriedCalls: records.filter(
      (record) => record.retryOrdinal !== null && record.retryOrdinal > 0,
    ).length,
    callsWithUnknownRetry: records.filter((record) => record.retryOrdinal === null).length,
    coverage: {
      complete: records.filter((record) => record.coverage === 'complete').length,
      partial: records.filter((record) => record.coverage === 'partial').length,
      none: records.filter((record) => record.coverage === 'none').length,
    },
    tokens,
  }
}

function knownTokens(record: ModelUsageRecord): number {
  return (
    (record.normalized.input ?? 0) +
    (record.normalized.output ?? 0) +
    (record.normalized.cacheRead ?? 0) +
    (record.normalized.cacheWrite ?? 0)
  )
}
export function peakWindow(records: ModelUsageRecord[], durationMs: number) {
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  let left = 0
  let sum = 0
  let best: { from: string; to: string; knownTokens: number; calls: number } | null = null
  for (let right = 0; right < sorted.length; right++) {
    const end = Date.parse(sorted[right].timestamp) + 1
    sum += knownTokens(sorted[right])
    while (left <= right && Date.parse(sorted[left].timestamp) < end - durationMs)
      sum -= knownTokens(sorted[left++])
    if (!best || sum > best.knownTokens)
      best = {
        from: new Date(end - durationMs).toISOString(),
        to: new Date(end).toISOString(),
        knownTokens: sum,
        calls: right - left + 1,
      }
  }
  return best
}
function grouped(
  records: ModelUsageRecord[],
  key: (record: ModelUsageRecord) => string,
  runs: UsageRun[] = [],
  runKey?: (run: UsageRun) => string,
) {
  const groups = new Map<string, ModelUsageRecord[]>()
  for (const record of records) {
    const id = key(record)
    const group = groups.get(id) ?? []
    group.push(record)
    groups.set(id, group)
  }
  const runGroups = new Map<string, UsageRun[]>()
  if (runKey)
    for (const run of runs) {
      const name = runKey(run)
      if (!groups.has(name)) groups.set(name, [])
      runGroups.set(name, [...(runGroups.get(name) ?? []), run])
    }
  return [...groups]
    .map(([name, rows]) => ({ name, ...summarize(rows, runGroups.get(name)) }))
    .sort((a, b) => b.calls - a.calls)
}
function scopeReport(records: ModelUsageRecord[], runs: UsageRun[] = []) {
  const dailyModels = new Map<string, { date: string; model: string; knownTokens: number }>()
  for (const row of records) {
    const date = beijingDate(row.timestamp)
    const model = `${row.provider ?? '未知服务商'} / ${row.model ?? '未知模型'}`
    const key = JSON.stringify([date, model])
    const value = dailyModels.get(key) ?? { date, model, knownTokens: 0 }
    value.knownTokens += knownTokens(row)
    dailyModels.set(key, value)
  }
  return {
    ...summarize(records, runs),
    byDay: grouped(
      records,
      (row) => beijingDate(row.timestamp),
      runs,
      (run) => beijingDate(run.startedAt),
    ).sort((a, b) => a.name.localeCompare(b.name)),
    byDayModel: [...dailyModels.values()],
    byWorkspace: grouped(
      records,
      (row) => row.workspace ?? '未知工作空间',
      runs,
      (run) => run.workspace ?? '未知工作空间',
    ),
    byCategory: grouped(
      records,
      (row) => categoryLabels[row.category],
      runs,
      (run) => categoryLabels[run.category],
    ),
    byModel: grouped(
      records,
      (row) => `${row.provider ?? '未知服务商'} / ${row.model ?? '未知模型'}`,
    ),
    peak5Hours: peakWindow(records, 5 * 3_600_000),
    peak7Days: peakWindow(records, 7 * DAY),
  }
}
export function buildReport(
  records: ModelUsageRecord[],
  runs: UsageRun[],
  config: UsageConfig,
  range: { from: string; to: string },
) {
  const selected = records
    .filter((row) => row.timestamp >= range.from && row.timestamp < range.to)
    .map((row) => classified(row, config))
  const selectedRuns = runs
    .filter((run) => run.startedAt >= range.from && run.startedAt < range.to)
    .map((run) => classifyRun(run, config))
  const reconciliation = selectedRuns.map((run) => {
    const calls = records.filter((row) => row.runId === run.id && row.parentToolUseId === null)
    const sum = summarize(calls)
    const resultUsage = normalizeUsage(run.rawUsage)
    return {
      runId: run.id,
      status: run.status,
      observedCalls: calls.length,
      resultUsage,
      sdkEstimatedUsd: run.sdkEstimatedUsd,
      rawModelUsage: run.rawModelUsage,
      scope:
        'usage compares this main-agent turn only; modelUsage is a separate whole-tree snapshot, possibly restored session totals; never added to calls',
      differences: Object.fromEntries(
        tokenFields.map((key) => [
          key,
          resultUsage[key] === null || sum.tokens[key].value === null
            ? null
            : resultUsage[key]! - sum.tokens[key].value!,
        ]),
      ),
    }
  })
  return {
    version: 1,
    timezone: 'Asia/Shanghai',
    range,
    generatedAt: new Date().toISOString(),
    definitions: {
      usage:
        'Provider-reported usage via Claude Code; not an invoice or subscription quota. No text-length estimates.',
      input: 'Anthropic protocol: excludes cache read/write',
      output: 'Includes thinking; do not add thinking again',
      missing:
        'null means unavailable; totals sum observed values only and are lower bounds where fields are missing',
      retries:
        'Only observable attempts; Claude Code may hide retries, failed requests, compaction or background calls',
      windows:
        'Rolling analysis windows of observed calls in the selected range, not plan reset windows',
      excludeDevelopment:
        'Excludes explicitly classified development only; unclassified remains included',
    },
    all: scopeReport(selected, selectedRuns),
    excludingDevelopment: scopeReport(
      selected.filter((row) => row.category !== 'development'),
      selectedRuns.filter((run) => run.category !== 'development'),
    ),
    runCoverage: {
      observedRuns: selectedRuns.length,
      runsWithoutCalls: reconciliation.filter((row) => !row.observedCalls).length,
      unfinishedRuns: selectedRuns.filter((run) => !run.endedAt).length,
      mismatchedRuns: reconciliation.filter((row) =>
        Object.values(row.differences).some((value) => value !== null && value !== 0),
      ).length,
      reconciliation,
    },
    costs: {
      actualBill: null,
      priceEstimate: null,
      configuredPrices: config.prices.length,
      note: 'v1 retains price configuration only; SDK cost is a separate estimate, never the GLM bill; cross-model repricing is reference-only',
    },
  }
}

export function formatReport(report: ReturnType<typeof buildReport>): string {
  const lines = [
    'CCLink Studio · 模型用量（服务返回值，非实际账单）',
    `${beijingTime(report.range.from)} ≤ 时间 < ${beijingTime(report.range.to)} · Asia/Shanghai`,
  ]
  const count = (value: number | null) =>
    value === null ? '未提供' : value.toLocaleString('en-US')
  for (const [name, summary] of [
    ['全部工作量', report.all],
    ['排除开发后的工作量（含未分类）', report.excludingDevelopment],
  ] as const) {
    lines.push(
      '',
      name,
      `调用 ${summary.calls} · 已知任务 ${summary.tasks} · 执行 ${summary.executions} · 无任务归属调用 ${summary.callsWithoutTask}`,
      `失败 ${summary.failed} · 中断 ${summary.interrupted} · 未知/进行中 ${summary.unknownStatus} · 已观察重试调用 ${summary.retriedCalls} · 重试未知 ${summary.callsWithUnknownRetry}`,
      `usage：完整 ${summary.coverage.complete} / 部分 ${summary.coverage.partial} / 无 ${summary.coverage.none}`,
    )
    for (const [key, label] of [
      ['input', '输入（不含缓存）'],
      ['output', '输出（包含思考）'],
      ['cacheRead', '缓存读取'],
      ['cacheWrite', '缓存写入'],
      ['thinking', '思考（仅分项）'],
    ] as const) {
      const field = summary.tokens[key]
      lines.push(`  ${label}: ${count(field.value)} Token；缺失 ${field.missingCalls} 次`)
    }
    for (const [label, groups] of [
      ['按日', summary.byDay],
      ['按项目', summary.byWorkspace],
      ['按类别', summary.byCategory],
      ['按模型', summary.byModel],
    ] as const) {
      lines.push(`  ${label}（调用 | 输入 | 输出 | 缓存读 | 缓存写 | 思考）`)
      for (const group of groups)
        lines.push(
          `    ${group.name}: ${group.calls} | ${tokenFields.map((key) => count(group.tokens[key].value)).join(' | ')}`,
        )
    }
    for (const [label, peak] of [
      ['5 小时', summary.peak5Hours],
      ['7 天', summary.peak7Days],
    ] as const) {
      lines.push(
        peak
          ? `  滚动 ${label}峰值: ${count(peak.knownTokens)} 已知 Token · ${beijingTime(peak.from)} — ${beijingTime(peak.to)}`
          : `  滚动 ${label}峰值: 无记录`,
      )
    }
  }
  lines.push(
    '',
    `运行缺口：无可识别调用 ${report.runCoverage.runsWithoutCalls}；未结束 ${report.runCoverage.unfinishedRuns}；汇总与明细不一致 ${report.runCoverage.mismatchedRuns}`,
    '滚动窗口仅作分析，不等于套餐刷新窗口。缺失项不是零消耗；隐藏重试可能漏记。',
    '实际账单：未录入。价格测算：未启用（已提供价格配置接口）。不换算 prompts / 套餐积分。',
  )
  return lines.join('\n')
}

export function exportCsv(records: ModelUsageRecord[]): string {
  const fields = [
    'id',
    'originId',
    'timestamp',
    'beijingTime',
    'provider',
    'model',
    'workspace',
    'instanceId',
    'sessionId',
    'conversationId',
    'runId',
    'taskId',
    'category',
    'messageId',
    'requestId',
    'parentToolUseId',
    'retryOrdinal',
    'status',
    'durationMs',
    'timingBasis',
    'sources',
    'estimated',
    'final',
    'outputEvidence',
    'thinkingEvidence',
    'coverage',
    'missing',
    'missingMetadata',
    ...tokenFields,
    'inputIncludesCache',
    'outputIncludesThinking',
    'rawUsage',
  ]
  const escape = (value: unknown) => {
    let text =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value)
    if (/^[=+@\-\t\r\n]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return (
    [
      fields.map(escape).join(','),
      ...records.map((record) => {
        const row: Record<string, unknown> = {
          ...record,
          ...record.normalized,
          beijingTime: beijingTime(record.timestamp),
        }
        return fields.map((key) => escape(row[key])).join(',')
      }),
    ].join('\r\n') + '\r\n'
  )
}
