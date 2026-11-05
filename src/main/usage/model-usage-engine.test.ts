import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { ModelUsageEngine } from './model-usage-engine'
import { ModelUsageService, usageEvent } from './model-usage-service'
import { timeRange } from './model-usage-report'
import { modelUsageContracts } from '../../shared/ipc/model-usage-contract'
const dirs: string[] = []
const directory = () => {
  const path = mkdtempSync(join(tmpdir(), 'studio-usage-engine-'))
  dirs.push(path)
  return path
}
afterEach(() => {
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const assistant = (id: string, timestamp: string) =>
  JSON.stringify({
    type: 'assistant',
    sessionId: 'session',
    timestamp,
    message: {
      id,
      model: 'glm-fixture',
      stop_reason: 'end_turn',
      content: [{ text: 'PRIVATE' }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  })
const factory = (options: import('node:worker_threads').WorkerOptions) =>
  new Worker(new URL('./model-usage-worker.ts', import.meta.url), {
    ...options,
    execArgv: ['--import', pathToFileURL(resolve('scripts/model-usage.mjs')).href],
  })
describe('usage product data path', () => {
  it('recovers late subagents and partial appends once, without collecting a new disabled main run', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-11-05T04:00:00Z')
    const dir = directory(),
      root = join(dir, 'projects')
    mkdirSync(join(root, 'workspace', 'session', 'subagents'), { recursive: true })
    const file = join(root, 'workspace', 'session.jsonl')
    const engine = new ModelUsageEngine(join(dir, 'usage'), 'instance')
    try {
      engine.start({
        runId: 'r1',
        taskId: 'daily-task',
        sessionId: 'session',
        transcriptRoot: root,
      })
      vi.setSystemTime('2026-11-05T04:01:00Z')
      writeFileSync(file, assistant('main', new Date().toISOString()) + '\n')
      engine.finish('r1', 'succeeded')
      await engine.reconcile()
      vi.setSystemTime('2026-11-05T04:02:00Z')
      const child = join(root, 'workspace', 'session', 'subagents', 'child.jsonl')
      const line = assistant('child', new Date().toISOString())
      writeFileSync(child, line.slice(0, 30))
      await engine.reconcile()
      expect(engine.store.calls()).toHaveLength(1)
      appendFileSync(child, line.slice(30) + '\n')
      await engine.reconcile()
      await engine.reconcile()
      expect(engine.store.calls()).toHaveLength(2)
      expect(engine.store.calls().find((row) => row.messageId === 'child')?.runId).toBeNull()
      engine.setEnabled(false)
      vi.setSystemTime('2026-11-05T04:03:00Z')
      appendFileSync(file, assistant('disabled-new-run', new Date().toISOString()) + '\n')
      await engine.reconcile()
      expect(engine.store.calls()).toHaveLength(2)
      expect(JSON.stringify(engine.store.calls())).not.toContain('PRIVATE')
    } finally {
      engine.close()
    }
  })
  it('keeps definition and execution counts separate and exports the same explicitly classified scope', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-11-05T04:00:00Z')
    const dir = directory(),
      engine = new ModelUsageEngine(dir, 'instance')
    try {
      for (const runId of ['daily-1', 'daily-2']) {
        engine.start({ runId, taskId: 'daily-task', sessionId: 'session' })
        const event = JSON.parse(assistant(runId, new Date().toISOString()))
        event.session_id = event.sessionId
        engine.observe(runId, {
          type: 'stream_event',
          session_id: 'session',
          event: { type: 'message_start', message: event.message },
        })
        engine.observe(runId, {
          type: 'stream_event',
          session_id: 'session',
          event: { type: 'message_delta', usage: { output_tokens: 5 } },
        })
        engine.observe(runId, {
          type: 'stream_event',
          session_id: 'session',
          event: { type: 'message_stop' },
        })
        engine.finish(runId, 'succeeded')
      }
      engine.classify({ kind: 'task', id: 'daily-task', category: 'daily-report' })
      engine.classify({ kind: 'run', id: 'daily-2', category: 'development' })
      const query = timeRange({ month: '2026-11' })
      const snapshot = engine.snapshot(query)
      expect(snapshot.all.tasks).toBe(1)
      expect(snapshot.all.executions).toBe(2)
      expect(snapshot.excludingDevelopment.calls).toBe(1)
      const exported = join(dir, 'report.json')
      engine.exportFile(exported, 'json', query, true)
      expect(JSON.parse(readFileSync(exported, 'utf8')).records).toHaveLength(1)
      expect(engine.importFile(exported).inserted).toBe(0)
      expect(engine.snapshot(query).all.calls).toBe(2)
      engine.start({ runId: 'failed-before-message', taskId: 'daily-task' })
      engine.finish('failed-before-message', 'failed')
      expect(engine.snapshot(query).all.executions).toBe(3)
      expect(engine.snapshot(query).runsWithoutCalls).toBe(1)
    } finally {
      engine.close()
    }
  })
  it('keeps the caller responsive during a real SQLite writer lock and persists worker observations', async () => {
    const dir = directory(),
      service = new ModelUsageService(dir, factory)
    await service.initialize()
    const lock = new DatabaseSync(join(dir, 'usage.sqlite'))
    try {
      lock.exec('BEGIN IMMEDIATE')
      const observer = service.start({ runId: 'r-lock' })!
      observer.observe({
        type: 'stream_event',
        session_id: 's',
        event: {
          type: 'message_start',
          message: { id: 'm', model: 'glm', usage: { input_tokens: 17 } },
        },
      })
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 30))
      observer.finish('interrupted')
      lock.exec('ROLLBACK')
      const snapshot = await service.snapshot({
        from: '2020-01-01T00:00:00.000Z',
        to: '2030-01-01T00:00:00.000Z',
      })
      expect(snapshot.all.calls).toBe(1)
      expect(snapshot.all.tokens.input.value).toBe(17)
      const details = await service.calls(
        { from: '2020-01-01T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z' },
        0,
        false,
      )
      expect(details.records[0].durationMs).toBeGreaterThanOrEqual(20)
    } finally {
      lock.close()
      await service.close()
    }
  })
  it('drops body deltas before the queue and rejects unbounded or arbitrary filesystem IPC inputs', () => {
    expect(
      usageEvent({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { text: 'PRIVATE' } },
      }),
    ).toBeNull()
    expect(
      JSON.stringify(
        usageEvent({
          type: 'assistant',
          message: { content: 'PRIVATE', usage: { input_tokens: 3, key: 'SECRET' } },
        }),
      ),
    ).not.toMatch(/PRIVATE|SECRET/)
    expect(() => modelUsageContracts.backfill.parseArgs(['/etc'])).toThrow()
    expect(() =>
      modelUsageContracts.exportFile.parseArgs([
        {
          query: timeRange({ month: '2026-11' }),
          format: 'json',
          excludeDevelopment: false,
          path: '/etc/out',
        },
      ]),
    ).toThrow()
  })
})
