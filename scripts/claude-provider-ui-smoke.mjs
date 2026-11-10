#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

// Read the test credential from stdin, never from argv or a source file.
// Uses paid DeepSeek requests plus the native Codex login, with fixture data only.
const apiKey = readFileSync(0, 'utf8').trim()
assert(apiKey, 'Provide the DeepSeek test key through stdin')
const runDir = await mkdtemp(join(tmpdir(), 'studio-provider-ui-'))
const workspace = await mkdtemp(join(homedir(), '.cclink-provider-smoke-'))
const userData = join(runDir, 'user-data')
await mkdir(userData)
await writeFile(join(workspace, 'marker.md'), 'STUDIO_PROVIDER_7296')
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
    componentSetupPageSeenVersion: 99,
    permissionMode: 'auto-except-destructive',
    claudeRuntimeSource: 'custom',
    claudeCodePath: resolve('.agent-runtime-staging', `darwin-${process.arch}`, 'claude'),
  }),
)
let app
let page
let turn = 0
const report = { success: false, runDir }
const redact = (value) => String(value).replaceAll(apiKey, '[redacted]')
async function launch() {
  const env = {
    ...process.env,
    CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
    ANTHROPIC_API_KEY: 'external-key-must-not-be-used',
    CLAUDE_CODE_OAUTH_TOKEN: 'external-subscription-must-not-be-used',
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND
  app = await electron.launch({ args: [resolve('.')], env })
  page = await app.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30000 })
  await page.evaluate(() => {
    window.__providerSmoke = { streams: [], completions: [], errors: [] }
    const api = window.cclinkStudio.agent
    api.onStreamEvent((e) => window.__providerSmoke.streams.push(e))
    api.onComplete((e) => window.__providerSmoke.completions.push(e))
    api.onError((e) => window.__providerSmoke.errors.push(e))
  })
}
async function openSettings() {
  await page.locator('.activity-bar-icon[title="设置"]').click()
  await page.locator('.settings-nav').getByRole('button', { name: 'Agent', exact: true }).click()
}
async function newConversation(runtime = 'Codex') {
  await page.locator('.activity-bar-icon[title="会话"]').click()
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await page.locator('[data-agent-action="runtime"]:visible').last().click()
  assert(
    await page
      .getByRole('button', { name: /Codex（默认）/ })
      .evaluate((e) => e.classList.contains('selected')),
  )
  if (runtime === 'Claude') await page.getByRole('button', { name: /Claude Code（备选）/ }).click()
  else await page.keyboard.press('Escape')
}
async function send(message) {
  const before = await page.evaluate(() => ({
    complete: window.__providerSmoke.completions.length,
    errors: window.__providerSmoke.errors.length,
    streams: window.__providerSmoke.streams.length,
  }))
  await page.locator('[data-agent-landmark="composer"] textarea:visible').last().fill(message)
  await page.locator('[data-agent-action="send"]:visible').last().click()
  await page.waitForFunction(
    (b) =>
      window.__providerSmoke.completions.length > b.complete ||
      window.__providerSmoke.errors.length > b.errors,
    before,
    { timeout: 120000 },
  )
  const events = await page.evaluate(
    (b) => ({
      streams: window.__providerSmoke.streams.slice(b.streams),
      errors: window.__providerSmoke.errors.slice(b.errors),
    }),
    before,
  )
  await writeFile(join(runDir, `turn-${++turn}.json`), redact(JSON.stringify(events)))
  assert.equal(events.errors.length, 0, redact(JSON.stringify(events.errors)))
  return events.streams
}
async function scanForKey(dir) {
  const matches = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) matches.push(...(await scanForKey(path)))
    else if (entry.isFile() && (await readFile(path)).includes(Buffer.from(apiKey)))
      matches.push(path)
  }
  return matches
}
try {
  await launch()
  await app.evaluate(({ dialog }, workspace) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] })
  }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await newConversation()
  report.defaultBeforeConfiguration = 'Codex'
  await openSettings()
  await page
    .locator('.settings-row')
    .filter({ has: page.getByText('模型提供商', { exact: true }) })
    .locator('select')
    .selectOption('deepseek')
  const settings = await page.evaluate(() => window.cclinkStudio.settings.getAll())
  assert.equal(settings.apiBaseUrl, 'https://api.deepseek.com/anthropic')
  assert.equal(settings.apiFormat, 'anthropic')
  report.model = settings.modelName
  const keyRow = page
    .locator('.settings-secret-row')
    .filter({ has: page.getByText('API Key', { exact: true }) })
  await keyRow.locator('input').fill(apiKey)
  await keyRow.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('API Key 已保存到本地凭证文件', { exact: true }).waitFor()
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.locator('.settings-connection-result').waitFor({ timeout: 60000 })
  assert(
    await page.locator('.settings-connection-result.success').count(),
    redact(await page.locator('.settings-connection-result').innerText()),
  )
  report.connectionTest = 'passed'
  console.log('DeepSeek connection test passed')
  await page.screenshot({ path: join(runDir, 'deepseek-settings.png') })
  await newConversation('Claude')
  const read = await send(
    '请调用 Studio editor_read 读取工作空间 marker.md 并回复其中的标记，不使用其他工具。',
  )
  assert(JSON.stringify(read).includes('editor_read'))
  assert(JSON.stringify(read).includes('STUDIO_PROVIDER_7296'))
  const init = read.find((e) => e.type === 'system' && e.subtype === 'init')
  assert(init?.session_id)
  await send(
    '请调用 Studio editor_write 创建当前工作空间 result.md，正文只写 DEEPSEEK_WRITE_OK。不要调用其他工具。',
  )
  assert((await readFile(join(workspace, 'result.md'), 'utf8')).includes('DEEPSEEK_WRITE_OK'))
  report.claudeTools = 'read/write passed'
  console.log('Claude + DeepSeek real Studio tools passed')
  await page.screenshot({ path: join(runDir, 'claude-deepseek.png') })
  await app.close()
  app = null
  await launch()
  const resumed = await send('上一轮你写入文件的标记是什么？只回复标记，不使用工具。')
  assert(JSON.stringify(resumed).includes('DEEPSEEK_WRITE_OK'))
  assert.equal(
    resumed.find((e) => e.type === 'system' && e.subtype === 'init')?.session_id,
    init.session_id,
  )
  report.claudeRestartResume = 'same native session'
  await newConversation()
  const codex = await send(
    '请调用 Studio editor_read 读取工作空间 marker.md 并回复其中的标记，不使用其他工具。',
  )
  assert(JSON.stringify(codex).includes('editor_read'))
  assert(JSON.stringify(codex).includes('STUDIO_PROVIDER_7296'))
  report.codexWithClaudeConfigured = 'default and real Studio tool call passed'
  const cleared = await page.evaluate(() => window.cclinkStudio.settings.clearSecret('apiKey'))
  assert(cleared.success)
  const blocked = await page.evaluate(
    (customPath) =>
      window.cclinkStudio.settings.testClaudeModelConnection({ source: 'custom', customPath }),
    resolve('.agent-runtime-staging', `darwin-${process.arch}`, 'claude'),
  )
  assert.equal(blocked.result?.code, 'AUTH_REQUIRED')
  report.clearedKey = 'Claude blocked without subscription fallback'
  await newConversation()
  const final = await send('只回复 CODEX_STILL_READY，不使用任何工具。')
  assert.equal(
    final
      .filter((event) => event.event?.type === 'text-delta')
      .map((event) => event.event.text)
      .join('')
      .trim(),
    'CODEX_STILL_READY',
  )
  report.codexAfterClearingClaudeKey = 'default and response passed'
  report.success = true
} catch (error) {
  report.error = redact(error)
  process.exitCode = 1
} finally {
  // Clear only this disposable Studio profile, never the real user's settings.
  await page?.evaluate(() => window.cclinkStudio.settings.clearSecret('apiKey')).catch(() => {})
  await app?.close().catch(() => {})
  const keyFiles = await scanForKey(userData).catch(() => ['scan failed'])
  report.secretResidueAfterClear = keyFiles.length
  if (keyFiles.length) {
    report.success = false
    report.error = 'Test credential persisted after clear; disposable profile removed'
    process.exitCode = 1
  }
  await rm(userData, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
  report.temporaryProfileRemoved = true
  await writeFile(join(runDir, 'result.json'), redact(JSON.stringify(report, null, 2)))
  console.log(redact(JSON.stringify(report, null, 2)))
}
