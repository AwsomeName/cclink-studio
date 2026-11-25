import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ModelUsageStore } from './model-usage-store'
import { ModelUsageCollector } from './model-usage-collector'
import { importCodexRollouts } from './model-usage-codex-import'
import { usageEvent } from './model-usage-service'
import { summarize } from './model-usage-report'

let dir: string
let codexHome: string
let store: ModelUsageStore
const now = '2026-11-19T05:00:00.000Z'
const thread = '01a1efaf-b195-7c40-9d46-ca50fb86aaf6'

const breakdown = (input: number, cached: number, output: number, reasoning: number) => ({
  inputTokens: input,
  cachedInputTokens: cached,
  cacheWriteInputTokens: 0,
  outputTokens: output,
  reasoningOutputTokens: reasoning,
  totalTokens: input + output,
})
const snake = (value: ReturnType<typeof breakdown>) => ({
  input_tokens: value.inputTokens,
  cached_input_tokens: value.cachedInputTokens,
  cache_write_input_tokens: value.cacheWriteInputTokens,
  output_tokens: value.outputTokens,
  reasoning_output_tokens: value.reasoningOutputTokens,
  total_tokens: value.totalTokens,
})
// Two responses in one thread: totals are cumulative, `last` is per response.
const call1 = breakdown(13965, 0, 307, 0)
const call2 = breakdown(14814, 10880, 309, 26)
const total1 = call1
const total2 = breakdown(28779, 10880, 616, 26)

function rollout(name: string, originator: string, lines: unknown[]) {
  const folder = join(codexHome, 'sessions', '2026', '11', '19')
  mkdirSync(folder, { recursive: true })
  const file = join(folder, `rollout-2026-11-19T01-23-53-${name}.jsonl`)
  const meta = {
    timestamp: '2026-11-18T17:23:50.000Z',
    type: 'session_meta',
    payload: {
      id: name,
      originator,
      cwd: '/workspace',
      base_instructions: { text: 'PRIVATE INSTRUCTIONS' },
    },
  }
  writeFileSync(file, [meta, ...lines].map((line) => JSON.stringify(line)).join('\n') + '\n')
  return file
}
const turnContext = (model: string) => ({
  timestamp: '2026-11-18T17:23:53.957Z',
  type: 'turn_context',
  payload: { model, cwd: '/workspace' },
})
const tokenCount = (at: string, last: ReturnType<typeof breakdown>, total: typeof last) => ({
  timestamp: at,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { last_token_usage: snake(last), total_token_usage: snake(total) },
    rate_limits: { primary: { used_percent: 90 } },
  },
})
const userMessage = {
  timestamp: '2026-11-18T17:23:54.000Z',
  type: 'response_item',
  payload: { type: 'message', content: [{ text: 'PRIVATE PROMPT' }] },
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'model-usage-codex-'))
  codexHome = join(dir, 'codex-home')
  store = new ModelUsageStore(join(dir, 'usage.sqlite'))
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('Codex model usage', () => {
  it('records live app-server usage with cache split out of OpenAI input and reasoning kept inside output', () => {
    const collector = new ModelUsageCollector(
      store,
      { runId: 'run-1', sessionId: thread, workspace: '/workspace', provider: 'openai' },
      () => new Date(now),
    )
    for (const [last, total] of [
      [call1, total1],
      [call2, total2],
      [call2, total2], // repeated notification for the same response
    ])
      collector.observe(
        usageEvent({
          type: 'codex_token_usage',
          session_id: thread,
          model: 'gpt-test',
          last,
          total,
        }),
      )
    collector.finish('succeeded')
    const calls = store.calls()
    expect(calls).toHaveLength(2)
    expect(calls.every((row) => row.protocol === 'openai-responses')).toBe(true)
    expect(calls.find((row) => row.normalized.output === 309)).toMatchObject({
      runId: 'run-1',
      model: 'gpt-test',
      provider: 'openai',
      coverage: 'complete',
      status: 'succeeded',
      normalized: { input: 3934, cacheRead: 10880, cacheWrite: 0, output: 309, thinking: 26 },
    })
    const sum = summarize(calls)
    // input + cacheRead + cacheWrite + output equals Codex's own total_tokens.
    expect(
      sum.tokens.input.value! +
        sum.tokens.cacheRead.value! +
        sum.tokens.cacheWrite.value! +
        sum.tokens.output.value!,
    ).toBe(total2.totalTokens)
  })

  it('backfills only Studio-originated rollouts and never persists log content', async () => {
    rollout(thread, 'cclink_studio', [
      turnContext('gpt-test'),
      userMessage,
      tokenCount('2026-11-18T17:24:03.649Z', call1, total1),
      tokenCount('2026-11-18T17:24:17.213Z', call2, total2),
    ])
    rollout('external-thread', 'Codex Desktop', [
      turnContext('gpt-other'),
      tokenCount('2026-11-18T18:00:00.000Z', call1, total1),
    ])
    const result = await importCodexRollouts(store, codexHome)
    expect(result).toMatchObject({ files: 1, inserted: 2, skippedExternal: 1 })
    const calls = store.calls()
    expect(calls.map((row) => row.sessionId)).toEqual([thread, thread])
    expect(calls[0]).toMatchObject({ model: 'gpt-test', workspace: '/workspace', runId: null })
    const database = readFileSync(join(dir, 'usage.sqlite')).toString('latin1')
    expect(database).not.toContain('PRIVATE')
    expect(JSON.stringify(calls)).not.toContain('PRIVATE')
  })

  it('does not double count when the rollout replays calls already recorded live', async () => {
    const collector = new ModelUsageCollector(
      store,
      { runId: 'run-live', sessionId: thread, provider: 'openai' },
      () => new Date(now),
    )
    collector.observe(
      usageEvent({ type: 'codex_token_usage', session_id: thread, last: call1, total: total1 }),
    )
    rollout(thread, 'cclink_studio', [
      turnContext('gpt-test'),
      tokenCount('2026-11-18T17:24:03.649Z', call1, total1),
      tokenCount('2026-11-18T17:24:17.213Z', call2, total2),
    ])
    const first = await importCodexRollouts(store, codexHome)
    expect(first).toMatchObject({ inserted: 1, replayed: 1 })
    const again = await importCodexRollouts(store, codexHome)
    expect(again).toMatchObject({ inserted: 0, replayed: 2 })
    const calls = store.calls()
    expect(calls).toHaveLength(2)
    // Live attribution survives the replay; the replay fills in the model.
    expect(calls[0]).toMatchObject({ runId: 'run-live', model: 'gpt-test' })
    expect(calls[0].sources.sort()).toEqual(['codex-app-server', 'codex-rollout'])
  })

  it('reads only appended lines incrementally and skips external files without rereading them', async () => {
    const file = rollout(thread, 'cclink_studio', [
      turnContext('gpt-test'),
      tokenCount('2026-11-18T17:24:03.649Z', call1, total1),
    ])
    rollout('external-thread', 'Codex Desktop', [])
    expect(await importCodexRollouts(store, codexHome, { incremental: true })).toMatchObject({
      files: 1,
      inserted: 1,
    })
    appendFileSync(file, JSON.stringify(tokenCount('2026-11-18T17:24:17.213Z', call2, total2)))
    // Unterminated last line stays pending until the writer finishes it.
    expect(await importCodexRollouts(store, codexHome, { incremental: true })).toMatchObject({
      inserted: 0,
      pendingLines: 1,
      skippedExternal: 1,
    })
    appendFileSync(file, '\n')
    expect(await importCodexRollouts(store, codexHome, { incremental: true })).toMatchObject({
      inserted: 1,
      replayed: 0,
    })
    expect(store.calls().map((row) => row.model)).toEqual(['gpt-test', 'gpt-test'])
  })
})
