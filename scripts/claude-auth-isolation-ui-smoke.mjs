#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
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
  if (!(await page.locator('.settings-page').isVisible()))
    await page.locator('.activity-bar-icon[title="设置"]').click()
  await page
    .locator('.settings-nav')
    .getByRole('button', { name: 'API Key 与连接', exact: true })
    .click()
  await page
    .locator('.connections-services')
    .getByRole('button', { name: /^Claude Code/ })
    .click()
  await page.locator('.connections-form').waitFor()
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
        .sendMessage(id, {
          message: 'Reply exactly CCLINK_CONNECTION_OK. Do not use tools.',
          runtimeBinding: { kind: 'claude-code' },
        })
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
  const keyInput = page.locator('.connections-form input[type="password"]').first()
  const form = page.locator('.connections-detail')
  await form.getByLabel('模型服务商').selectOption('custom')
  await form.getByLabel('API 地址').fill(apiBaseUrl)
  await form.getByLabel('模型名称').fill('claude-sonnet-4-6')
  await keyInput.fill('studio-ui-test-key')
  await form.getByRole('button', { name: '仅保存', exact: true }).click()
  await form
    .getByText('已保存到本机，尚未验证。保存成功不代表服务认证、余额或模型权限已通过。', {
      exact: true,
    })
    .waitFor()
  assert.equal(await keyInput.inputValue(), '')
  assert.equal(requests.length, 0)
  await form.getByRole('button', { name: '验证连接', exact: true }).click()
  await page.locator('.connections-feedback.success').waitFor({ timeout: 30000 })
  await page.locator('.settings-content').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: join(runDir, 'connections-verified.png'), fullPage: true })
  // The settings CTA creates a real Claude-bound conversation; the first UI message must reach the fixture.
  await form.getByRole('button', { name: '新建 Claude Code 会话', exact: true }).click()
  await page
    .locator('.agent-runtime-label')
    .filter({ hasText: 'Claude Code' })
    .first()
    .waitFor({ state: 'attached' })
  const composer = page.locator('textarea.agent-input:visible').first()
  await composer.fill('Reply exactly CCLINK_CONNECTION_OK. Do not use tools.')
  await composer.press('Enter')
  await page
    .locator('.agent-message.assistant')
    .filter({ hasText: 'CCLINK_CONNECTION_OK' })
    .first()
    .waitFor({ timeout: 30000 })
  await page.screenshot({ path: join(runDir, 'claude-conversation.png'), fullPage: true })
  // Wait until the UI run has released the configuration lock before continuing the isolation checks.
  await page.waitForFunction(async () => !(await window.cclinkStudio.agent.getStatus()).busy)
  await openAgentSettings(page)
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

  await keyInput.fill('invalid-studio-key')
  await form.getByRole('button', { name: '保存并验证', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.connections-form input[type=password]')?.value === '',
  )
  await page.locator('.connections-feedback.error').waitFor({ timeout: 30000 })
  assert.match(
    await page.locator('.connections-feedback.error').innerText(),
    /401|认证|AUTHENTICATION_FAILED/,
  )
  const invalid = await send(page, 'auth-ui-invalid')
  assert.equal(invalid.kind, 'error')
  assert.match(invalid.message, /401|认证|鉴权|authenticate/i)

  await form.getByRole('button', { name: '删除密钥', exact: true }).click()
  await form.getByRole('button', { name: '确认删除', exact: true }).click()
  await page
    .getByText('密钥已删除，相关功能需要重新配置；非敏感连接设置保留。', { exact: true })
    .waitFor()
  const countBefore = requests.length
  const cleared = await send(page, 'auth-ui-cleared')
  assert.equal(cleared.kind, 'error')
  assert.equal(cleared.code, 'AUTH_REQUIRED')
  assert.equal(requests.length, countBefore)
  await page.screenshot({ path: join(runDir, 'cleared.png'), fullPage: true })
  // Advanced management must invalidate the same live runtime, not only the disk record.
  const advanced = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: '存储与高级管理' }) })
  for (const action of ['remove', 'clearAll', 'reload']) {
    await keyInput.fill('studio-ui-test-key')
    await form.getByRole('button', { name: '仅保存', exact: true }).click()
    await form
      .getByText('已保存到本机，尚未验证。保存成功不代表服务认证、余额或模型权限已通过。', {
        exact: true,
      })
      .waitFor()
    if (!(await advanced.getAttribute('open'))) {
      // An open boolean attribute has an empty-string value.
      if (!(await advanced.evaluate((element) => element.open)))
        await advanced.locator('summary').click()
    }
    if (action === 'remove') {
      page.once('dialog', (dialog) => dialog.accept())
      await advanced
        .locator('.settings-row')
        .filter({ has: page.getByText('agent:default', { exact: true }) })
        .getByRole('button', { name: '清除', exact: true })
        .click()
    } else if (action === 'clearAll') {
      page.once('dialog', (dialog) => dialog.accept())
      await advanced.getByRole('button', { name: '清除全部', exact: true }).click()
    } else {
      const credentialPath = join(userData, 'credentials', 'credentials.json')
      const disk = JSON.parse(await readFile(credentialPath, 'utf8'))
      delete disk.records['agent:default']
      await writeFile(credentialPath, JSON.stringify(disk), { mode: 0o600 })
      await advanced.getByRole('button', { name: '重新加载', exact: true }).click()
    }
    await page.waitForFunction(
      async () => !(await window.cclinkStudio.settings.getSecretStatus()).apiKeyConfigured,
    )
    await page.waitForFunction(
      () => !document.querySelector('.connections-services button')?.disabled,
    )
    assert.equal((await send(page, `auth-ui-advanced-${action}`)).code, 'AUTH_REQUIRED')
    assert.equal(requests.length, countBefore)
  }
  // All service forms use the same credential owner; unsupported tests must stay absent.
  const serviceNav = page.locator('.connections-services')
  for (const name of ['Meshy', 'Pexels']) {
    await serviceNav.getByRole('button', { name: new RegExp('^' + name) }).click()
    await form
      .locator('input[type="password"]')
      .first()
      .fill('fixture-' + name)
    await form.getByRole('button', { name: '保存密钥', exact: true }).click()
    await form
      .getByText('已保存到本机，尚未验证。保存成功不代表服务认证、余额或模型权限已通过。', {
        exact: true,
      })
      .waitFor()
    assert.equal(await form.getByRole('button', { name: /验证连接|保存并验证/ }).count(), 0)
    assert.equal(await form.locator('input[type="password"]').first().inputValue(), '')
  }
  await page.getByPlaceholder('搜索设置', { exact: true }).fill('即梦')
  await page.locator('.settings-search-result').filter({ hasText: '即梦图像生成' }).click()
  await form.getByRole('heading', { name: '即梦', exact: true }).waitFor()
  await form.locator('input[type="password"]').nth(0).fill('fixture-ak')
  assert.equal(await form.getByRole('button', { name: '保存密钥', exact: true }).isDisabled(), true)
  await form.locator('input[type="password"]').nth(1).fill('fixture-sk')
  await form.getByRole('button', { name: '保存密钥', exact: true }).click()
  await form
    .getByText('已保存到本机，尚未验证。保存成功不代表服务认证、余额或模型权限已通过。', {
      exact: true,
    })
    .waitFor()
  await serviceNav.getByRole('button', { name: /^GitHub/ }).click()
  await form.getByLabel('GitHub 用户名').fill('studio-fixture')
  await form.locator('input[type="password"]').fill('fixture-github-token')
  await form.getByRole('button', { name: '仅保存', exact: true }).click()
  await form
    .getByText('已保存到本机，尚未验证。保存成功不代表服务认证、余额或模型权限已通过。', {
      exact: true,
    })
    .waitFor()
  await serviceNav.getByRole('button', { name: /^Pexels/ }).click()
  // Search navigation and the settings sidebar must preserve a draft when cancelled.
  await form.locator('input[type="password"]').fill('draft-to-preserve')
  await page.getByPlaceholder('搜索设置', { exact: true }).fill('Meshy')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.locator('.settings-search-result').filter({ hasText: 'Meshy' }).first().click()
  assert.equal(await form.locator('input[type="password"]').inputValue(), 'draft-to-preserve')
  await form.getByRole('heading', { name: 'Pexels', exact: true }).waitFor()
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.settings-search-result').filter({ hasText: 'Meshy' }).first().click()
  await form.getByRole('heading', { name: 'Meshy', exact: true }).waitFor()
  await serviceNav.getByRole('button', { name: /^Pexels/ }).click()
  assert.equal(await form.locator('input[type="password"]').inputValue(), '')
  await form.locator('input[type="password"]').fill('sidebar-draft')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.locator('.settings-nav').getByRole('button', { name: '外观', exact: true }).click()
  assert.equal(await form.locator('input[type="password"]').inputValue(), 'sidebar-draft')
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.settings-nav').getByRole('button', { name: '外观', exact: true }).click()
  await openAgentSettings(page)
  await serviceNav.getByRole('button', { name: /^Pexels/ }).click()
  assert.equal(await form.locator('input[type="password"]').inputValue(), '')
  await form.locator('input[type="password"]').fill('unsaved-fixture')
  page.once('dialog', (dialog) => dialog.accept())
  await serviceNav.getByRole('button', { name: /^Meshy/ }).click()
  await serviceNav.getByRole('button', { name: /^Pexels/ }).click()
  assert.equal(await form.locator('input[type="password"]').inputValue(), '')
  const savedServices = await page.evaluate(async () =>
    (await window.cclinkStudio.credentials.listMetadata()).metadata.map((item) => item.id),
  )
  for (const id of [
    'extension:meshy:default',
    'extension:pexels:default',
    'extension:jimeng:default',
    'git:github',
  ])
    assert.ok(savedServices.includes(id))
  assert.equal(requests.length, countBefore)
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
    configuredKey:
      'unified settings save, real connection test, Claude CTA and first UI conversation passed',
    invalidKey: '401, no subscription fallback',
    clearedKey: 'blocked immediately and after restart',
    advancedCredentials:
      'remove, clear all and reload revoke the live Claude key without sending a request',
    serviceForms:
      'Meshy, Pexels, Jimeng paired fields, GitHub local save, search/sidebar cancel preserves drafts and confirmed navigation disposes secrets',
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
    await activePage?.locator('.connections-feedback, .settings-error').allTextContents(),
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
