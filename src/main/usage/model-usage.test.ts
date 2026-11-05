import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { ModelUsageStore } from './model-usage-store'
import { ModelUsageCollector, createCall } from './model-usage-collector'
import { importTranscripts } from './model-usage-import'
import { buildReport, exportCsv, peakWindow, summarize, timeRange } from './model-usage-report'
import { ModelUsageService } from './model-usage-service'
import { sanitizeUsage, withCoverage } from './model-usage-normalize'
import { usageConfigSchema } from '../../shared/model-usage'

let dir: string
let store: ModelUsageStore
const now = '2026-11-05T05:00:00.000Z'
const usage = {
  input_tokens: 100,
  output_tokens: 20,
  cache_read_input_tokens: 50,
  cache_creation_input_tokens: 10,
  output_tokens_details: { thinking_tokens: 5 },
}
const assistant = (id: string, overrides = {}) => ({
  type: 'assistant',
  session_id: 'session-1',
  message: {
    id,
    model: 'glm-test',
    stop_reason: 'tool_use',
    usage,
    content: [{ text: 'PRIVATE RESPONSE' }],
  },
  ...overrides,
})
const stream = (event: unknown, lane: string | null = null) => ({
  type: 'stream_event',
  session_id: 'session-1',
  parent_tool_use_id: lane,
  event,
})
const collector = () =>
  new ModelUsageCollector(
    store,
    { runId: 'run-1', taskId: 'task-1', workspace: '/workspace' },
    () => new Date(now),
  )
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'model-usage-'))
  store = new ModelUsageStore(join(dir, 'usage.sqlite'))
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('model usage accounting', () => {
  it('updates cumulative streaming snapshots and repeated assistant blocks; does not add thinking twice', () => {
    const c = collector()
    c.observe(
      stream({
        type: 'message_start',
        message: { id: 'm1', model: 'glm-test', usage: { ...usage, output_tokens: 1 } },
      }),
    )
    c.observe(stream({ type: 'message_delta', usage: { output_tokens: 8 } }))
    c.observe(
      stream({
        type: 'message_delta',
        usage: { output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } },
      }),
    )
    c.observe(stream({ type: 'message_stop' }))
    c.observe(assistant('m1'))
    c.observe(assistant('m1'))
    c.observe(stream({ type: 'message_start', message: { id: 'm2', model: 'glm-test', usage } }))
    c.observe(assistant('m2')) // the assistant block's output is still only a placeholder
    c.observe(stream({ type: 'message_delta', usage: { output_tokens: 20 } }))
    c.observe(stream({ type: 'message_stop' }))
    c.observe({
      type: 'result',
      usage: { input_tokens: 200, output_tokens: 40 },
      total_cost_usd: 99,
    })
    expect(store.calls()).toHaveLength(2)
    expect(summarize(store.calls()).tokens.output.value).toBe(40)
    expect(peakWindow(store.calls(), 18_000_000)?.knownTokens).toBe(360)
    expect(store.calls().find((row) => row.messageId === 'm1')?.coverage).toBe('complete')
    expect(store.runs()[0].sdkEstimatedUsd).toBe(99)
  })

  it('isolates concurrent subagent streams and excludes the parent aggregate', () => {
    const c = collector()
    for (const [id, lane] of [
      ['parent', null],
      ['child', 'tool-a'],
    ] as const) {
      c.observe(
        stream(
          {
            type: 'message_start',
            message: { id, model: 'glm-test', usage: { input_tokens: 10 } },
          },
          lane,
        ),
      )
    }
    c.observe(stream({ type: 'message_delta', usage: { output_tokens: 3 } }, 'tool-a'))
    c.observe(stream({ type: 'message_stop' }, 'tool-a'))
    c.observe(stream({ type: 'message_delta', usage: { output_tokens: 7 } }))
    c.observe(stream({ type: 'message_stop' }))
    c.observe({
      type: 'result',
      usage: { input_tokens: 10, output_tokens: 7 },
      modelUsage: { 'glm-test': { inputTokens: 20, outputTokens: 10 } },
    })
    expect(summarize(store.calls()).tokens.output.value).toBe(10)
    expect(store.calls().find((row) => row.messageId === 'child')?.parentToolUseId).toBe('tool-a')
    const report = buildReport(
      store.calls(),
      store.runs(),
      store.config(),
      timeRange({ day: '2026-11-05' }),
    )
    expect(report.runCoverage.mismatchedRuns).toBe(0)
    expect(store.runs()[0].rawModelUsage['glm-test'].outputTokens).toBe(10)
  })

  it('does not count assistant/start placeholders, accepts a final zero, and never restores a placeholder on replay', () => {
    const c = collector()
    c.observe(assistant('unverified'))
    c.observe(
      stream({
        type: 'message_start',
        message: {
          id: 'zero',
          usage: {
            input_tokens: 8,
            output_tokens: 1,
            output_tokens_details: { thinking_tokens: 0 },
          },
        },
      }),
    )
    expect(store.calls().find((row) => row.messageId === 'zero')?.normalized.output).toBeNull()
    c.observe(stream({ type: 'message_delta', usage: { output_tokens: 0 } }))
    c.observe(stream({ type: 'message_stop' }))
    c.observe(assistant('zero', { message: { id: 'zero', usage: { output_tokens: 1 } } }))
    c.finish('succeeded')
    expect(store.calls().find((row) => row.messageId === 'zero')).toMatchObject({
      normalized: { output: 0, thinking: null },
      outputEvidence: 'stream-delta',
    })
    expect(
      store.calls().find((row) => row.messageId === 'unverified')?.normalized.output,
    ).toBeNull()
  })

  it('keeps observable failed attempts and retry ordinals, deduplicating retry notices', () => {
    const c = collector()
    const retry = {
      type: 'system',
      subtype: 'api_retry',
      uuid: 'retry1',
      session_id: 'session-1',
      attempt: 1,
    }
    c.observe(retry)
    c.observe(retry)
    c.observe(assistant('after-retry'))
    c.finish('succeeded')
    const report = summarize(store.calls())
    expect(report.calls).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.retriedCalls).toBe(1)
    expect(report.coverage.none).toBe(1)
    expect(store.calls().find((row) => row.status === 'failed')?.normalized.input).toBeNull()
  })

  it('keeps interrupted usage partial and run failures without inventing a free call', () => {
    const c = collector()
    c.observe(
      stream({ type: 'message_start', message: { id: 'partial', usage: { input_tokens: 10 } } }),
    )
    c.finish('interrupted')
    expect(store.calls()[0]).toMatchObject({
      status: 'interrupted',
      final: false,
      coverage: 'partial',
    })
    expect(store.calls()[0].normalized.output).toBeNull()
    new ModelUsageCollector(store, { runId: 'pre-request-failure' }, () => new Date(now)).finish(
      'failed',
    )
    expect(store.calls()).toHaveLength(1)
    const report = buildReport(
      store.calls(),
      store.runs(),
      store.config(),
      timeRange({ day: '2026-11-05' }),
    )
    expect(report.runCoverage.runsWithoutCalls).toBe(1)
  })

  it('does not trust synthetic SDK zeros or persist prompts, keys, error content, or unrecognized usage', () => {
    const c = collector()
    c.observe(
      assistant('error', {
        error: 'PRIVATE ERROR',
        message: {
          id: 'error',
          model: '<synthetic>',
          usage: { input_tokens: 0, output_tokens: 0 },
          content: 'PRIVATE CONTENT',
        },
      }),
    )
    c.observe(
      assistant('private', {
        message: {
          id: 'private',
          model: 'glm-test',
          usage: {
            ...usage,
            api_key: 'SECRET',
            arbitrary: 199,
            output_tokens_details: { thinking_tokens: 3, prompt: 'SECRET' },
          },
        },
      }),
    )
    c.finish('failed')
    const serialized = JSON.stringify(store.calls())
    expect(serialized).not.toMatch(/PRIVATE|SECRET|api_key|arbitrary|content/)
    expect(store.calls().find((row) => row.messageId === 'error')?.coverage).toBe('none')
    expect(sanitizeUsage({ cache_creation: { ephemeral_1h_input_tokens: 5 } })).toEqual({
      cache_creation: { ephemeral_1h_input_tokens: 5 },
    })
  })

  it('backfills nested transcripts idempotently and enriches live records without erasing origins', async () => {
    const c = collector()
    c.observe(assistant('m1'))
    c.finish('succeeded')
    const root = join(dir, 'projects')
    mkdirSync(join(root, 's', 'subagents'), { recursive: true })
    const row = {
      type: 'assistant',
      sessionId: 'session-1',
      timestamp: now,
      cwd: '/workspace',
      message: { id: 'm1', model: 'glm-test', stop_reason: 'end_turn', usage, content: 'PRIVATE' },
    }
    writeFileSync(
      join(root, 's.jsonl'),
      [row, row].map((value) => JSON.stringify(value)).join('\n') + '\n',
    )
    writeFileSync(
      join(root, 's', 'subagents', 'child.jsonl'),
      JSON.stringify({ ...row, message: { ...row.message, id: 'child' } }) + '\n',
    )
    const first = await importTranscripts(store, [root])
    const second = await importTranscripts(store, [root])
    expect(first.inserted).toBe(1)
    expect(second.inserted).toBe(0)
    expect(store.calls()).toHaveLength(2)
    expect(store.calls().find((value) => value.messageId === 'm1')).toMatchObject({
      runId: 'run-1',
      originId: store.originId,
      sources: ['claude-sdk', 'claude-transcript'],
    })
  })

  it('reports malformed and incomplete lines without storing them and retries after repair', async () => {
    const file = join(dir, 'partial.jsonl')
    writeFileSync(file, '{broken}\n{"type":')
    expect(await importTranscripts(store, [file])).toMatchObject({
      invalidLines: 1,
      pendingLines: 1,
    })
    writeFileSync(
      file,
      JSON.stringify({
        type: 'assistant',
        sessionId: 's',
        timestamp: now,
        message: {
          id: 'm',
          model: 'glm-test',
          stop_reason: 'end_turn',
          usage: { input_tokens: 20, output_tokens: 5 },
        },
      }),
    )
    expect((await importTranscripts(store, [file])).inserted).toBe(1)
    expect(store.calls()[0]).toMatchObject({
      coverage: 'partial',
      retryOrdinal: null,
      durationMs: null,
      taskId: null,
    })
  })

  it('retains source identity across databases and duplicate imports', () => {
    collector().observe(assistant('shared'))
    const other = new ModelUsageStore(join(dir, 'other.sqlite'))
    try {
      for (const record of store.calls()) {
        other.put(record)
        other.put(record)
      }
      expect(other.calls()).toHaveLength(1)
      expect(other.calls()[0].originId).toBe(store.originId)
      expect(other.originId).not.toBe(store.originId)
    } finally {
      other.close()
    }
  })

  it('uses Beijing day/month/Monday-week boundaries and rejects ambiguous or invalid ranges', () => {
    expect(timeRange({ day: '2026-11-05' })).toEqual({
      from: '2026-11-04T16:00:00.000Z',
      to: '2026-11-05T16:00:00.000Z',
    })
    expect(timeRange({ week: '2026-11-05' }).from).toBe('2026-11-01T16:00:00.000Z')
    expect(timeRange({ month: '2026-12' }).to).toBe('2026-12-31T16:00:00.000Z')
    expect(() => timeRange({ day: '2026-02-30' })).toThrow()
    expect(() => timeRange({ from: '2026-11-01T12:00:00', to: '2026-12-01' })).toThrow()
    const a = withCoverage({
      ...createCall({}, store.originId, 's', 'a', '2026-11-04T15:59:59.999Z', 'claude-transcript'),
      rawUsage: usage,
      final: true,
    })
    const b = { ...a, id: 'b', timestamp: '2026-11-04T16:00:00.000Z' }
    const report = buildReport([a, b], [], store.config(), timeRange({ day: '2026-11-05' }))
    expect(report.all.calls).toBe(1)
  })

  it('finds a true rolling peak across midnight, excludes exactly-boundary calls, and keeps unknown categories', () => {
    const rows = [0, 2, 5, 6].map((hour, index) =>
      withCoverage({
        ...createCall(
          { taskId: `task-${index}` },
          store.originId,
          's',
          `m-${index}`,
          new Date(Date.parse('2026-11-04T15:00:00Z') + hour * 3_600_000).toISOString(),
          'claude-transcript',
        ),
        rawUsage: { input_tokens: 10 },
        final: true,
      }),
    )
    expect(peakWindow(rows, 5 * 3_600_000)?.knownTokens).toBe(30)
    const config = usageConfigSchema.parse({ taskCategories: { 'task-1': 'development' } })
    const report = buildReport(rows, [], config, timeRange({ month: '2026-11' }))
    expect(report.all.calls).toBe(4)
    expect(report.excludingDevelopment.calls).toBe(3)
    expect(report.all.tokens.thinking.value).toBeNull()
  })

  it('quotes CSV safely and leaves unavailable fields empty', () => {
    const row = createCall(
      { workspace: '=HYPERLINK("secret")' },
      store.originId,
      's',
      'm',
      now,
      'claude-transcript',
    )
    const csv = exportCsv([row])
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).not.toContain('null')
  })

  it('fails open with an inspectable health warning and supports disable without deleting data', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const bad = join(dir, 'blocked')
    writeFileSync(bad, 'not a directory')
    const factory = (options: import('node:worker_threads').WorkerOptions) =>
      new Worker(new URL('./model-usage-worker.ts', import.meta.url), {
        ...options,
        execArgv: ['--import', pathToFileURL(resolve('scripts/model-usage.mjs')).href],
      })
    const service = new ModelUsageService(bad, factory)
    await expect(service.initialize()).rejects.toThrow()
    expect(warning).toHaveBeenCalled()
    await service.close()
    const disabled = new ModelUsageStore(join(dir, 'disabled', 'usage.sqlite'))
    disabled.configure((config) => ({ ...config, enabled: false }))
    disabled.close()
    const off = new ModelUsageService(join(dir, 'disabled'), factory)
    await off.initialize()
    off.start({ runId: 'disabled-run' })?.observe(assistant('disabled-message'))
    expect((await off.snapshot(timeRange({ month: '2026-11' }))).all.calls).toBe(0)
    await off.close()
  })

  it('serializes real concurrent processes and a repeated cross-machine import', async () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      withCoverage({
        ...createCall({}, store.originId, 'concurrent', `m-${index}`, now, 'claude-transcript'),
        rawUsage: usage,
        final: true,
      }),
    )
    const file = join(dir, 'exchange.json')
    writeFileSync(file, JSON.stringify({ format: 'cclink-model-usage-v1', records, runs: [] }))
    const run = () =>
      new Promise<void>((resolvePromise, reject) => {
        const child = spawn(
          process.execPath,
          [resolve('scripts/model-usage.mjs'), 'import', '--db', store.path, '--file', file],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
        let output = ''
        child.stdout.on('data', (value) => {
          output += value
        })
        child.stderr.on('data', (value) => {
          output += value
        })
        child.on('error', reject)
        child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(output))))
      })
    await Promise.all([run(), run(), run()])
    expect(store.calls()).toHaveLength(12)
    expect(summarize(store.calls()).tokens.input.value).toBe(1200)
    expect(readFileSync(file, 'utf8')).not.toContain('PRIVATE')
  }, 20_000)
})
