// Real Claude runtime + SDK + local fixture server. No paid API or user credentials.
import './model-usage.mjs'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile, mkdir, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Worker } from 'node:worker_threads'

const { ModelUsageStore } = await import('../src/main/usage/model-usage-store.ts')
const { ModelUsageCollector } = await import('../src/main/usage/model-usage-collector.ts')
const { ModelUsageService } = await import('../src/main/usage/model-usage-service.ts')
const { importTranscripts, transcriptFiles } =
  await import('../src/main/usage/model-usage-import.ts')
const root = await mkdtemp(join(tmpdir(), 'cclink-model-usage-real-'))
const store = new ModelUsageStore(join(root, 'usage.sqlite'))
const profileIndex = process.argv.indexOf('--profile')
const profile = profileIndex >= 0 ? resolve(process.argv[profileIndex + 1]) : null
const background = profile
  ? new ModelUsageService(
      join(profile, 'model-usage'),
      (options) => new Worker(resolve('out/main/model-usage-worker.js'), options),
    )
  : null
await background?.initialize()
const observer = background?.start({
  runId: 'fixture-run',
  workspace: root,
  provider: 'local-fixture',
  category: 'analysis',
  transcriptRoot: join(root, 'claude-config', 'projects'),
})
const sample = join(root, 'sample.txt')
await writeFile(sample, 'sanitized fixture')
let requests = 0
const observed = []
const server = createServer(async (request, response) => {
  // Drain the request but neither retain nor log its content or headers.
  for await (const chunk of request) void chunk
  if (request.url?.split('?')[0].endsWith('/messages/count_tokens')) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ input_tokens: 100 }))
    return
  }
  if (!request.url?.split('?')[0].endsWith('/messages')) {
    response.writeHead(404)
    response.end()
    return
  }
  requests++
  const index = requests
  const id = `msg_usage_fixture_${index}`
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'request-id': `req_fixture_${index}`,
  })
  const send = (event) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  send({
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 1,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
      },
    },
  })
  if (index === 1) {
    send({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tool_fixture', name: 'Read', input: {} },
    })
    send({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify({ file_path: sample }) },
    })
  } else {
    send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    send({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Fixture completed.' },
    })
  }
  send({ type: 'content_block_stop', index: 0 })
  send({
    type: 'message_delta',
    delta: { stop_reason: index === 1 ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: index * 10 + 10 },
  })
  send({ type: 'message_stop' })
  response.end()
})
await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening))
const address = server.address()
const abortController = new AbortController()
const timeout = setTimeout(() => abortController.abort(), 45_000)
const collector = new ModelUsageCollector(store, {
  runId: 'fixture-run',
  workspace: root,
  provider: 'local-fixture',
})
try {
  const stream = query({
    prompt: 'Read sample.txt and reply once.',
    options: {
      abortController,
      cwd: root,
      pathToClaudeCodeExecutable:
        process.env.CCLINK_USAGE_SMOKE_CLAUDE ??
        resolve('.agent-runtime-staging', `${process.platform}-${process.arch}`, 'claude'),
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
        ANTHROPIC_API_KEY: 'local-fixture-not-a-secret',
        ANTHROPIC_AUTH_TOKEN: '',
        CLAUDE_CODE_OAUTH_TOKEN: '',
        CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
        DISABLE_UPDATES: '1',
        DISABLE_TELEMETRY: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      model: 'claude-sonnet-4-6',
      tools: ['Read'],
      allowedTools: ['Read'],
      settingSources: [],
      systemPrompt: 'Local usage fixture.',
      includePartialMessages: true,
      mcpServers: {},
      strictMcpConfig: true,
      maxTurns: 3,
    },
  })
  for await (const event of stream) {
    collector.observe(event)
    observer?.observe(event)
    if (event.type === 'assistant')
      observed.push({ id: event.message.id, assistantOutput: event.message.usage.output_tokens })
    if (event.type === 'result')
      observed.push({ resultOutput: event.usage.output_tokens, modelUsage: event.modelUsage })
  }
  collector.finish('succeeded')
  observer?.finish('succeeded')
  assert.equal(requests, 2, 'the runtime must continue after the real Read tool')
  const calls = store.calls()
  assert.equal(calls.length, 2)
  assert.deepEqual(
    calls.map((row) => row.normalized.output).sort((a, b) => a - b),
    [20, 30],
  )
  const logRoot = join(root, 'claude-config', 'projects')
  const transcriptOutputs = []
  for (const file of await transcriptFiles(logRoot)) {
    for (const line of (await readFile(file, 'utf8')).split('\n').filter(Boolean)) {
      const event = JSON.parse(line)
      if (event.type === 'assistant')
        transcriptOutputs.push({
          id: event.message.id,
          output: event.message.usage?.output_tokens,
          stopReason: event.message.stop_reason,
        })
    }
  }
  const imported = await importTranscripts(store, [logRoot])
  assert.equal(imported.inserted, 0, 'real SDK and transcript must share deduplication identity')
  assert.equal(store.calls().length, 2)
  if (background && profile) {
    const snapshot = await background.snapshot({
      from: '2020-01-01T00:00:00.000Z',
      to: '2030-01-01T00:00:00.000Z',
    })
    assert.equal(snapshot.all.calls, 2)
    assert.equal(snapshot.all.tokens.output.value, 50)
    const history = join(
      profile,
      'runtime-components',
      'claude-runtime',
      'usage-fixture',
      'config',
      'projects',
    )
    await mkdir(history, { recursive: true })
    await cp(logRoot, history, { recursive: true })
  }
  console.log(
    JSON.stringify({ result: 'PASS', requests, observed, transcriptOutputs, imported }, null, 2),
  )
} finally {
  clearTimeout(timeout)
  abortController.abort()
  server.closeAllConnections()
  await new Promise((resolveClosed) => server.close(resolveClosed))
  store.close()
  await background?.close()
  await rm(root, { recursive: true, force: true })
}
