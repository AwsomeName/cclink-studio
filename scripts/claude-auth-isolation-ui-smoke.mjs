#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

// Real Electron + real Claude, with only a loopback API and disposable credentials.
const runDir = await mkdtemp(join(tmpdir(), 'studio-auth-ui-'))
const userData = join(runDir, 'user-data')
const privateConfig = join(userData, 'agent-runtime', 'claude-api')
const foreignConfig = join(runDir, 'external-claude-config')
await mkdir(foreignConfig)
const requests = []
const server = createServer((req, res) => {
  req.resume()
  if (!req.url?.startsWith('/v1/messages')) return res.writeHead(404).end()
  requests.push({ key: req.headers['x-api-key'], authorization: req.headers.authorization })
  if (req.headers['x-api-key'] !== 'studio-ui-test-key') {
    res.writeHead(401, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: 'Invalid API key' },
      }),
    )
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  event('message_start', {
    message: {
      id: 'msg_studio_ui',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  })
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', {
    index: 0,
    delta: { type: 'text_delta', text: 'CCLINK_CONNECTION_OK' },
  })
  event('content_block_stop', { index: 0 })
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })
  event('message_stop', {})
  res.end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const apiBaseUrl = `http://127.0.0.1:${server.address().port}`
let app
let activePage
async function launch() {
  const env = {
    ...process.env,
    CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
    CLAUDE_CONFIG_DIR: foreignConfig,
    ANTHROPIC_API_KEY: 'external-key-must-not-be-used',
    CLAUDE_CODE_OAUTH_TOKEN: 'external-subscription-must-not-be-used',
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND
  app = await electron.launch({ args: [resolve('.')], env })
  const page = await app.firstWindow()
  activePage = page
  await page.waitForSelector('.main-window', { timeout: 30000 })
  return page
}
async function openAgentSettings(page) {
  if (!(await page.locator('.settings-page').count()))
    await page.locator('.activity-bar-icon[title="设置"]').click()
  await page.locator('.settings-nav').getByRole('button', { name: 'Agent', exact: true }).click()
  await page
    .getByText('所有运行时均使用 Studio 独立配置和 API Key，不读取或修改本机 Claude 登录。', {
      exact: true,
    })
    .waitFor()
}
async function send(page, conversationId) {
  return page.evaluate(async (id) => {
    const api = window.cclinkStudio.agent
    return await new Promise((resolve) => {
      const timer = setTimeout(() => finish({ kind: 'timeout' }), 20000)
      const stopComplete = api.onComplete((event) => {
        if (event.conversationId === id) finish({ kind: 'complete' })
      })
      const stopError = api.onError((event) => {
        if (event.conversationId === id)
          finish({ kind: 'error', code: event.code, message: event.message })
      })
      function finish(result) {
        clearTimeout(timer)
        stopComplete()
        stopError()
        resolve(result)
      }
      api
        .sendMessage(id, 'Reply exactly CCLINK_CONNECTION_OK. Do not use tools.')
        .then((result) => {
          if (!result.success) finish({ kind: 'rejected', result })
        })
        .catch((error) => finish({ kind: 'rejected', message: String(error) }))
    })
  }, conversationId)
}
function inspectStoredSession(configDir, sessionId) {
  // Each reader has its own configuration root. Never enumerate the user's real
  // ~/.claude directory or read their existing conversations.
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { listSessions, getSessionMessages } = await import(process.argv[1]);
        const id = process.argv[2];
        console.log(JSON.stringify({
          listed: (await listSessions()).some(session => session.sessionId === id),
          messageCount: (await getSessionMessages(id)).length,
        }));`,
        import.meta.resolve('@anthropic-ai/claude-agent-sdk'),
        sessionId,
      ],
      {
        env: {
          PATH: process.env.PATH,
          CLAUDE_CONFIG_DIR: configDir,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
        encoding: 'utf8',
        timeout: 10000,
      },
    ),
  )
}
try {
  let page = await launch()
  await openAgentSettings(page)
  const missing = await page.evaluate(() => window.cclinkStudio.agent.getStatus())
  assert.equal(missing.ready, true)
  assert.equal((await send(page, 'auth-ui-missing')).code, 'AUTH_REQUIRED')
  assert.equal(requests.length, 0)
  const configured = await page.evaluate(
    async ({ apiBaseUrl, path }) => {
      return window.cclinkStudio.settings.set({
        apiBaseUrl,
        modelName: 'claude-sonnet-4-6',
        claudeRuntimeSource: 'custom',
        claudeCodePath: path,
      })
    },
    { apiBaseUrl, path: resolve('.agent-runtime-staging', `darwin-${process.arch}`, 'claude') },
  )
  assert.equal(configured.success, true)
  await page.reload()
  await openAgentSettings(page)
  const keyRow = page
    .locator('.settings-secret-row')
    .filter({ has: page.getByText('API Key', { exact: true }) })
  await keyRow.locator('input').fill('studio-ui-test-key')
  await keyRow.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('API Key 已保存到本地凭证文件', { exact: true }).waitFor()
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.locator('.settings-connection-result.success').waitFor({ timeout: 30000 })
  assert.equal((await send(page, 'auth-ui-success')).kind, 'complete')
  const session = await page.evaluate(() => window.cclinkStudio.agent.getStatus('auth-ui-success'))
  assert.ok(session.sessionId)
  const stored = inspectStoredSession(privateConfig, session.sessionId)
  assert.equal(stored.listed, true)
  assert.ok(stored.messageCount >= 2)
  assert.deepEqual(inspectStoredSession(foreignConfig, session.sessionId), {
    listed: false,
    messageCount: 0,
  })
  assert.deepEqual(await readdir(foreignConfig), [])
  // The next turn starts a new Claude process and resumes the private transcript.
  assert.equal((await send(page, 'auth-ui-success')).kind, 'complete')
  const continued = await page.evaluate(() =>
    window.cclinkStudio.agent.getStatus('auth-ui-success'),
  )
  assert.equal(continued.sessionId, session.sessionId)
  await page.screenshot({ path: join(runDir, 'configured.png'), fullPage: true })

  await keyRow.locator('input').fill('invalid-studio-key')
  await keyRow.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.settings-secret-row input')?.value === '',
  )
  const invalid = await send(page, 'auth-ui-invalid')
  assert.equal(invalid.kind, 'error')
  assert.match(invalid.message, /401|认证|鉴权|authenticate/i)

  await keyRow.getByRole('button', { name: '清除', exact: true }).click()
  await page.getByText('API Key 已清除', { exact: true }).waitFor()
  const countBefore = requests.length
  const cleared = await send(page, 'auth-ui-cleared')
  assert.equal(cleared.kind, 'error')
  assert.equal(cleared.code, 'AUTH_REQUIRED')
  assert.equal(requests.length, countBefore)
  await page.screenshot({ path: join(runDir, 'cleared.png'), fullPage: true })
  await app.close()
  app = null
  page = await launch()
  const restarted = await page.evaluate(() => window.cclinkStudio.agent.getStatus())
  assert.equal(restarted.ready, true)
  assert.equal((await send(page, 'auth-ui-restarted')).code, 'AUTH_REQUIRED')
  assert.equal(requests.length, countBefore)
  assert.equal(inspectStoredSession(privateConfig, session.sessionId).listed, true)
  assert.deepEqual(inspectStoredSession(foreignConfig, session.sessionId), {
    listed: false,
    messageCount: 0,
  })
  assert.deepEqual(await readdir(foreignConfig), [])
  for (const request of requests) {
    assert.ok(['studio-ui-test-key', 'invalid-studio-key'].includes(request.key))
    assert.equal(request.authorization, undefined)
  }
  const report = {
    success: true,
    runtime: 'real Electron + Claude',
    api: 'local fixture, no paid calls',
    missingKey: 'blocked',
    configuredKey: 'connection test and conversation passed',
    invalidKey: '401, no subscription fallback',
    clearedKey: 'blocked immediately and after restart',
    sessionStorage: {
      directory: 'userData/agent-runtime/claude-api/projects',
      privateTranscript: 'real session listed and read from the Studio directory',
      externalDiscovery: 'not listed or readable by ID from a different configuration root',
      externalDirectory: 'unchanged after connection test, conversation, 401 and restart',
      continuation: 'new Claude process resumed the same private session',
      restart: 'private transcript retained',
      desktopUi: 'not tested; this verifies storage and SDK discovery boundaries',
    },
    requests: requests.length,
    runDir,
  }
  await writeFile(join(runDir, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(
    'UI failure:',
    await activePage?.locator('.settings-connection-result, .settings-error').allTextContents(),
  )
  await activePage
    ?.screenshot({ path: join(runDir, 'failure.png'), fullPage: true })
    .catch(() => {})
  console.error('Evidence:', runDir)
  throw error
} finally {
  await app?.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
