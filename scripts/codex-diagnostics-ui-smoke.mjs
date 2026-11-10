#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

// Real Electron and native Codex. Only the final recovery turn calls a paid model.
// Authentication failure uses an empty disposable CODEX_HOME; no native login is changed.
const runDir = await mkdtemp(join(tmpdir(), 'studio-codex-diagnostics-'))
const workspace = await mkdtemp(join(homedir(), '.cclink-diagnostics-smoke-'))
const emptyHome = join(runDir, 'empty-codex-home')
const brokenBin = join(runDir, 'broken-bin')
await mkdir(emptyHome)
await mkdir(brokenBin)
await writeFile(join(brokenBin, 'codex'), '#!/bin/sh\nexit 23\n', { mode: 0o700 })
let app
let page
const result = { success: false, runDir }

async function launch(profile, overrides = {}) {
  const userData = join(runDir, profile)
  await mkdir(userData, { recursive: true })
  try {
    await writeFile(
      join(userData, 'settings.json'),
      JSON.stringify({
        lastWorkspacePath: workspace,
        recentWorkspacePaths: [workspace],
        componentSetupPageSeenVersion: 99,
        permissionMode: 'auto-except-destructive',
      }),
      { flag: 'wx' },
    )
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const env = { ...process.env, CCLINK_STUDIO_TEST_USER_DATA_PATH: userData, ...overrides }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND
  app = await electron.launch({ args: [resolve('.')], env })
  page = await app.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30000 })
  await page.evaluate(() => {
    window.__diagnosticsSmoke = { streams: [], runs: [], errors: [] }
    const api = window.cclinkStudio.agent
    api.onStreamEvent((event) => window.__diagnosticsSmoke.streams.push(event))
    api.onRunStatus((event) => window.__diagnosticsSmoke.runs.push(event))
    api.onError((event) => window.__diagnosticsSmoke.errors.push(event))
  })
}
async function close() {
  await app.close()
  app = null
}
async function newConversation() {
  await app.evaluate(({ dialog }, workspace) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] })
  }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await page.locator('.activity-bar-icon[title="会话"]').click()
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
}
async function menu() {
  await page.locator('[data-agent-action="runtime"]:visible').last().click()
}
async function detect(label) {
  await page.getByRole('button', { name: /检测本机 Codex/ }).click()
  await page.getByRole('status').filter({ hasText: label }).waitFor({ timeout: 25000 })
  assert(
    await page
      .locator('.agent-runtime-menu')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    'Runtime diagnostics must not overflow horizontally',
  )
}
async function frameworkReport(expected) {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '框架日志', exact: true }).click()
  let report = ''
  for (let attempt = 0; attempt < 80; attempt++) {
    report = await app.evaluate(({ clipboard }) => clipboard.readText())
    if (report.includes('## 本机 Codex 启动诊断') && report.includes(expected)) break
    await page.waitForTimeout(250)
  }
  assert(report.includes(expected))
  await writeFile(join(runDir, `${expected}.md`), report)
}
async function send(text, expectedStatus) {
  const before = await page.evaluate(() => window.__diagnosticsSmoke.runs.length)
  await page.locator('[data-agent-landmark="composer"] textarea:visible').last().fill(text)
  await page.locator('[data-agent-action="send"]:visible').last().click()
  await page.waitForFunction(
    ({ before, expectedStatus }) =>
      window.__diagnosticsSmoke.runs.slice(before).some((event) => event.status === expectedStatus),
    { before, expectedStatus },
    { timeout: 120000 },
  )
  return page.evaluate(() => window.__diagnosticsSmoke.runs.at(-1))
}
try {
  await launch('no-login', { CODEX_HOME: emptyHome })
  await newConversation()
  await menu()
  await detect('未登录 ChatGPT')
  await page.screenshot({ path: join(runDir, 'no-login.png') })
  await frameworkReport('CODEX_AUTH_REQUIRED')
  const missingLoginRun = await send('只回复 OK，不调用工具。', 'failed')
  const missingLoginStatus = await page.evaluate(
    (id) => window.cclinkStudio.agent.getStatus(id),
    missingLoginRun.conversationId,
  )
  assert.equal(missingLoginStatus.codexDiagnostic?.state, 'not-logged-in')
  assert.equal(missingLoginStatus.sessionId, null)
  await menu()
  assert(await page.getByRole('button', { name: /Claude Code（备选）/ }).isEnabled())
  result.noLogin =
    'real native account check, copied framework log and failed run all identify missing login'
  await close()

  await launch('broken', { PATH: `${brokenBin}:${process.env.PATH ?? ''}` })
  await newConversation()
  await menu()
  await detect('Codex 启动失败')
  await page.screenshot({ path: join(runDir, 'start-failed.png') })
  await frameworkReport('CODEX_PROCESS_EXITED')
  const broken = await page.evaluate(() => window.cclinkStudio.diagnostics.probeCodex())
  assert.equal(broken.exitCode, 23)
  result.startFailure = 'actual child exit 23 shown in UI and framework log'
  await close()

  await launch('recovery')
  await newConversation()
  await menu()
  await detect('启动及本地登录检查通过')
  await page.getByRole('button', { name: /Codex ACP/ }).click()
  const failed = await send('只回复 RUNTIME_SWITCH_OK，不调用工具。', 'failed')
  await menu()
  assert(await page.getByRole('button', { name: /Codex（默认）/ }).isEnabled())
  await page.screenshot({ path: join(runDir, 'failed-unlocked.png') })
  await close()
  await launch('recovery')
  await menu()
  assert(await page.getByRole('button', { name: /Codex（默认）/ }).isEnabled())
  await page.getByRole('button', { name: /Codex（默认）/ }).click()
  const completed = await send('只回复 RUNTIME_SWITCH_OK，不调用工具。', 'succeeded')
  assert.equal(completed.conversationId, failed.conversationId)
  const streams = await page.evaluate(() => window.__diagnosticsSmoke.streams)
  assert(
    streams
      .filter((event) => event.event?.type === 'text-delta')
      .map((event) => event.event.text)
      .join('')
      .includes('RUNTIME_SWITCH_OK'),
  )
  const status = await page.evaluate(
    (id) => window.cclinkStudio.agent.getStatus(id),
    completed.conversationId,
  )
  assert.equal(status.runtimeBinding.kind, 'codex')
  assert(status.sessionId)
  await menu()
  assert(await page.getByRole('button', { name: /Claude Code（备选）/ }).isDisabled())
  await page.screenshot({ path: join(runDir, 'recovery-success.png') })
  await frameworkReport('CODEX_READY')
  result.failedFirstSendRecovery =
    'same conversation switches ACP to Codex after failure and restart, real response succeeds'
  result.establishedSession = 'runtime selection remains locked'
  result.success = true
} catch (error) {
  result.error = String(error)
  await page?.screenshot({ path: join(runDir, 'failure.png') }).catch(() => {})
  await writeFile(
    join(runDir, 'events.json'),
    JSON.stringify(await page?.evaluate(() => window.__diagnosticsSmoke).catch(() => null)),
  )
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  await rm(workspace, { recursive: true, force: true })
  await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
}
