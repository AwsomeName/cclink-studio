import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { ModelUsageStore } from './model-usage-store'
import { ModelUsageCollector } from './model-usage-collector'
import { importTranscripts, transcriptFiles } from './model-usage-import'
import {
  buildReport,
  classified,
  classifyRun,
  exportCsv,
  beijingDate,
  parseBoundary,
} from './model-usage-report'
import {
  modelUsageRecordSchema,
  usageRunSchema,
  type ModelUsageContext,
  type UsagePeriod,
  type UsageQuery,
  type UsageSnapshot,
  type UsageCategory,
} from '../../shared/model-usage'

type Watch = { context: ModelUsageContext; from: string; to: string | null }
export class ModelUsageEngine {
  readonly store: ModelUsageStore
  private collectors = new Map<string, ModelUsageCollector>()
  private watches: Watch[]
  private period: UsagePeriod
  private lastError: { timestamp: string; code: string } | null
  private observedAt: string | null = null
  setObservationTime(at: string) {
    this.observedAt = at
  }
  private observationTime() {
    return this.observedAt ? new Date(this.observedAt) : new Date()
  }
  constructor(
    readonly directory: string,
    private instanceId: string,
    readonly environmentDisabled = false,
  ) {
    this.store = new ModelUsageStore(join(directory, 'usage.sqlite'))
    this.watches = this.store.getMeta<Watch[]>('watched-runs', [])
    const errorFile = join(directory, 'last-error.json')
    this.lastError = existsSync(errorFile) ? JSON.parse(readFileSync(errorFile, 'utf8')) : null
    const now = new Date().toISOString()
    // Close previous-process observation windows; never absorb future unobserved runs.
    for (const watch of this.watches) if (!watch.to) watch.to = now
    this.store.setMeta('watched-runs', this.watches)
    this.period = {
      id: randomUUID(),
      originId: this.store.originId,
      from: now,
      to: now,
      state: this.recording() ? 'recording' : 'disabled',
    }
    this.store.putPeriod(this.period)
  }
  private recording() {
    return this.store.config().enabled && !this.environmentDisabled
  }
  heartbeat() {
    const state = this.recording() ? 'recording' : 'disabled'
    if (this.period.state !== state && this.period.state !== 'degraded') this.transition(state)
    this.period.to = new Date().toISOString()
    this.store.putPeriod(this.period)
  }
  private transition(state: UsagePeriod['state']) {
    this.heartbeatEnd()
    this.period = { ...this.period, id: randomUUID(), from: this.period.to, state }
    this.store.putPeriod(this.period)
  }
  private heartbeatEnd() {
    this.period.to = new Date().toISOString()
    this.store.putPeriod(this.period)
  }
  failure(error: unknown) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'USAGE_RECORD_FAILED'
    this.lastError = {
      timestamp: new Date().toISOString(),
      code: /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'USAGE_RECORD_FAILED',
    }
    try {
      this.transition('degraded')
      writeFileSync(join(this.directory, 'last-error.json'), JSON.stringify(this.lastError), {
        mode: 0o600,
      })
    } catch {
      /* parent also exposes failure */
    }
  }
  start(context: ModelUsageContext) {
    if (!this.recording()) return
    const config = this.store.config()
    const runId = context.runId!
    const resolved = {
      ...context,
      instanceId: this.instanceId,
      category:
        context.category ??
        config.runCategories[runId] ??
        (context.taskId ? config.taskCategories[context.taskId] : undefined) ??
        (context.sessionId ? config.sessionCategories[context.sessionId] : undefined) ??
        ('unclassified' as const),
    }
    this.collectors.set(
      runId,
      new ModelUsageCollector(this.store, resolved, () => this.observationTime()),
    )
    this.watches.push({ context: resolved, from: this.observationTime().toISOString(), to: null })
    this.store.setMeta('watched-runs', this.watches)
  }
  observe(runId: string, event: unknown) {
    this.collectors.get(runId)?.observe(event)
    const sessionId = (event as { session_id?: string }).session_id
    const watch = this.watches.find((row) => row.context.runId === runId)
    if (watch && sessionId && watch.context.sessionId !== sessionId) {
      watch.context.sessionId = sessionId
      this.store.setMeta('watched-runs', this.watches)
    }
  }
  finish(runId: string, status: 'succeeded' | 'failed' | 'interrupted' | 'unknown') {
    this.collectors.get(runId)?.finish(status)
    this.collectors.delete(runId)
    const watch = this.watches.find((row) => row.context.runId === runId)
    if (watch) {
      watch.to = this.observationTime().toISOString()
      this.store.setMeta('watched-runs', this.watches)
    }
  }
  async reconcile() {
    // Discover once per root per pass, then read only appended bytes. Only Studio-observed sessions qualify.
    const roots = [
      ...new Set(
        this.watches
          .map((row) => row.context.transcriptRoot)
          .filter((x): x is string => Boolean(x)),
      ),
    ]
    for (const root of roots) {
      if (!existsSync(root)) continue
      const files = await transcriptFiles(root)
      const sessions = [
        ...new Set(
          this.watches
            .filter((row) => row.context.transcriptRoot === root)
            .map((row) => row.context.sessionId)
            .filter((x): x is string => Boolean(x)),
        ),
      ]
      for (const session of sessions) {
        const watches = this.watches.filter(
          (row) => row.context.transcriptRoot === root && row.context.sessionId === session,
        )
        const earliest = watches.reduce((a, row) => (row.from < a ? row.from : a), watches[0].from)
        const selected = files.filter(
          (file) => file.endsWith(`/${session}.jsonl`) || file.includes(`/${session}/`),
        )
        const result = await importTranscripts(
          this.store,
          [],
          {},
          {
            files: selected,
            incremental: true,
            after: earliest,
            accept: (timestamp, file) =>
              watches.some(
                (row) =>
                  timestamp >= row.from &&
                  (row.to ? timestamp <= row.to : this.collectors.has(row.context.runId!)),
              ) ||
              (file.includes('/subagents/') &&
                this.recording() &&
                !this.store
                  .periods()
                  .some(
                    (period) =>
                      period.state === 'disabled' &&
                      timestamp >= period.from &&
                      timestamp <= period.to,
                  )),
            contextAt: (timestamp) => {
              const matches = watches.filter(
                (row) =>
                  timestamp >= row.from &&
                  (row.to ? timestamp <= row.to : this.collectors.has(row.context.runId!)),
              )
              // Late/background or overlapping records retain usage but no invented task attribution.
              return matches.length === 1 ? matches[0].context : {}
            },
          },
        )
        if (result.invalidLines || result.unidentifiable)
          this.failure({ code: 'TRANSCRIPT_INCOMPLETE' })
      }
    }
  }
  private selected(query: UsageQuery) {
    const config = this.store.config()
    return this.store
      .calls()
      .map((row) => classified(row, config))
      .filter(
        (row) =>
          (!query.workspace || row.workspace === query.workspace) &&
          (!query.model || row.model === query.model) &&
          (!query.category || row.category === query.category),
      )
  }
  snapshot(query: UsageQuery): UsageSnapshot {
    this.heartbeat()
    const rows = this.selected(query)
    const allRows = this.store.calls()
    const runs = this.store.runs()
    const report = buildReport(rows, this.selectedRuns(query), this.store.config(), query)
    const audit = buildReport(allRows, runs, this.store.config(), query)
    const end = Math.min(Date.parse(query.to), Date.now() + 1)
    const activityRange = {
      from: new Date(
        Date.parse(parseBoundary(beijingDate(new Date(end - 1).toISOString()))) - 364 * 86400000,
      ).toISOString(),
      to: new Date(end).toISOString(),
    }
    const activity = buildReport(rows, [], this.store.config(), activityRange)
    return {
      range: { from: query.from, to: query.to },
      all: report.all,
      excludingDevelopment: report.excludingDevelopment,
      activity: {
        ...activityRange,
        all: activity.all.byDay,
        excludingDevelopment: activity.excludingDevelopment.byDay,
      },
      periods: this.store.periods(),
      enabled: this.store.config().enabled,
      environmentDisabled: this.environmentDisabled,
      database: this.store.path,
      originId: this.store.originId,
      earliest: allRows[0]?.timestamp ?? null,
      latest: allRows.at(-1)?.timestamp ?? null,
      workspaces: [
        ...new Set(allRows.map((row) => row.workspace).filter((x): x is string => x !== null)),
      ],
      models: [...new Set(allRows.map((row) => row.model).filter((x): x is string => x !== null))],
      lastError: this.lastError,
      unfinishedRuns: audit.runCoverage.unfinishedRuns,
      runsWithoutCalls: audit.runCoverage.runsWithoutCalls,
      failedRuns: runs.filter(
        (run) => run.startedAt >= query.from && run.startedAt < query.to && run.status === 'failed',
      ).length,
      mismatchedRuns: audit.runCoverage.mismatchedRuns,
    }
  }
  private selectedRuns(query: UsageQuery) {
    const ids = new Set(this.selected(query).map((row) => row.runId))
    return this.store
      .runs()
      .map((run) => classifyRun(run, this.store.config()))
      .filter(
        (run) =>
          (!query.workspace || run.workspace === query.workspace) &&
          (!query.model || ids.has(run.id)) &&
          (!query.category || run.category === query.category),
      )
  }
  calls(query: UsageQuery, offset: number, excludeDevelopment: boolean) {
    const rows = this.selected(query)
      .filter(
        (row) =>
          row.timestamp >= query.from &&
          row.timestamp < query.to &&
          (!excludeDevelopment || row.category !== 'development'),
      )
      .reverse()
    return { total: rows.length, records: rows.slice(offset, offset + 50) }
  }
  setEnabled(enabled: boolean) {
    this.store.configure((config) => ({ ...config, enabled }))
    this.transition(this.recording() ? 'recording' : 'disabled')
  }
  classify(target: { kind: 'run' | 'session' | 'task'; id: string; category: UsageCategory }) {
    const key = {
      run: 'runCategories',
      session: 'sessionCategories',
      task: 'taskCategories',
    } as const
    this.store.configure((config) => ({
      ...config,
      [key[target.kind]]: { ...config[key[target.kind]], [target.id]: target.category },
    }))
  }
  async backfill(root?: string) {
    let roots = root ? [root] : []
    if (!root) {
      const base = join(dirname(this.directory), 'runtime-components', 'claude-runtime')
      if (existsSync(base))
        roots = (await readdir(base, { withFileTypes: true }))
          .filter((row) => row.isDirectory())
          .map((row) => join(base, row.name, 'config', 'projects'))
          .filter(existsSync)
    }
    if (!roots.length) throw Object.assign(new Error('NO_TRANSCRIPTS'), { code: 'NO_TRANSCRIPTS' })
    return importTranscripts(this.store, roots)
  }
  importFile(path: string) {
    const data = z
      .object({
        format: z.literal('cclink-model-usage-v1'),
        records: z.array(modelUsageRecordSchema),
        runs: z.array(usageRunSchema),
      })
      .passthrough()
      .parse(JSON.parse(readFileSync(path, 'utf8')))
    let inserted = 0
    for (const row of data.records) if (this.store.put(row)) inserted++
    for (const run of data.runs) this.store.putRun(run)
    return { inserted, replayed: data.records.length - inserted }
  }
  exportFile(path: string, format: 'csv' | 'json', query: UsageQuery, excludeDevelopment: boolean) {
    const records = this.selected(query).filter(
      (row) =>
        row.timestamp >= query.from &&
        row.timestamp < query.to &&
        (!excludeDevelopment || row.category !== 'development'),
    )
    const runIds = new Set(records.map((row) => row.runId))
    const runs = this.selectedRuns(query).filter(
      (run) =>
        (runIds.has(run.id) || (run.startedAt >= query.from && run.startedAt < query.to)) &&
        (!excludeDevelopment || run.category !== 'development'),
    )
    const data =
      format === 'csv'
        ? exportCsv(records)
        : JSON.stringify(
            {
              format: 'cclink-model-usage-v1',
              records,
              runs,
              report: buildReport(records, runs, this.store.config(), query),
            },
            null,
            2,
          )
    writeFileSync(path, data, { mode: 0o600, flag: 'wx' })
    return { path, calls: records.length }
  }
  close() {
    for (const id of this.collectors.keys()) this.finish(id, 'interrupted')
    this.heartbeatEnd()
    this.store.close()
  }
}
