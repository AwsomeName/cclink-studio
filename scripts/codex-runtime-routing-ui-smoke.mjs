#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

// Uses the user's installed Codex and its existing file login. Only fixture files
// and isolated Studio userData are changed; model calls consume the Codex account.
const runDir = await mkdtemp(join(tmpdir(), 'studio-codex-routing-'))
const workspace = await mkdtemp(join(homedir(), '.cclink-codex-smoke-'))
const userData = join(runDir, 'user-data')
await mkdir(userData)
await writeFile(join(workspace, 'marker.md'), 'STUDIO_CODEX_UI_8624')
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
    componentSetupPageSeenVersion: 99,
    permissionMode: 'auto-except-destructive',
  }),
)
let app
let page
async function launch() {
  const env = { ...process.env, CCLINK_STUDIO_TEST_USER_DATA_PATH: userData }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND
  app = await electron.launch({ args: [resolve('.')], env })
  page = await app.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30000 })
  await page.evaluate(() => {
    window.__codexSmoke = { streams: [], completions: [], errors: [], runs: [] }
    const api = window.cclinkStudio.agent
    api.onStreamEvent((e) => window.__codexSmoke.streams.push(e))
    api.onComplete((e) => window.__codexSmoke.completions.push(e))
    api.onError((e) => window.__codexSmoke.errors.push(e))
    api.onRunStatus((e) => window.__codexSmoke.runs.push(e))
  })
}
async function send(message) {
  const before = await page.evaluate(() => window.__codexSmoke.completions.length)
  const input = page.locator('[data-agent-landmark="composer"] textarea:visible').last()
  await input.fill(message)
  await page.locator('[data-agent-action="send"]:visible').last().click()
  await page.waitForFunction(
    (count) =>
      window.__codexSmoke.completions.length > count || window.__codexSmoke.errors.length > 0,
    before,
    { timeout: 120000 },
  )
  const errors = await page.evaluate(() => window.__codexSmoke.errors)
  assert.deepEqual(errors, [])
}
try {
  await launch()
  await app.evaluate(({ dialog }, workspace) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] })
  }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await page.locator('.activity-bar-icon[title="会话"]').click()
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await page.locator('[data-agent-action="runtime"]:visible').last().click()
  assert.equal(await page.getByRole('button', { name: /^Codex ACP/ }).count(), 0)
  assert(
    (await page.getByRole('button', { name: /Codex（默认）/ }).getAttribute('class')).includes(
      'selected',
    ),
  )
  await page.keyboard.press('Escape')
  await app.close()
  // Seed only this isolated fixture's historical ACP binding. ACP is no longer
  // a choice for a new conversation; existing saved bindings still load honestly.
  const stateDir = join(workspace, '.cclink-studio', 'state')
  let seeded = false
  for (const name of await readdir(stateDir)) {
    if (!name.endsWith('.json')) continue
    const path = join(stateDir, name)
    const state = JSON.parse(await readFile(path, 'utf8'))
    const snapshot = state.snapshot?.sections?.agentConversations
    const conversation = snapshot?.conversations?.[snapshot.activeConversationId]
    if (!conversation) continue
    assert.equal(conversation.runtimeBinding.kind, 'codex')
    conversation.runtimeBinding = { kind: 'acp', implementationId: 'codex-acp' }
    await writeFile(path, JSON.stringify(state))
    seeded = true
  }
  assert(seeded, 'Isolated legacy ACP fixture was persisted')
  await launch()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-agent-action="runtime"]')].some((el) =>
      el.textContent.includes('Codex ACP'),
    ),
  )
  await page
    .locator('[data-agent-landmark="composer"] textarea:visible')
    .last()
    .fill('只回复 ACP_RECOVERY_TEST，不使用工具。')
  await page.locator('[data-agent-action="send"]:visible').last().click()
  await page.waitForFunction(
    () => window.__codexSmoke.runs.some((run) => run.status === 'failed'),
    null,
    { timeout: 15000 },
  )
  const failed = await page.evaluate(() => window.__codexSmoke)
  assert(JSON.stringify(failed.runs).includes('API Key'))
  const conversationId = failed.runs.at(-1)?.conversationId
  assert(conversationId)
  const failedStatus = await page.evaluate(
    (id) => window.cclinkStudio.agent.getStatus(id),
    conversationId,
  )
  assert.equal(failedStatus.runtimeBinding.kind, 'acp')
  assert.equal(failedStatus.sessionId, null)
  await page.screenshot({ path: join(runDir, 'acp-failed.png') })
  const restart = process.argv.includes('--restart')
  if (restart) {
    await app.close()
    await launch()
  }
  await page.locator('[data-agent-action="runtime"]:visible').last().click()
  const native = page.getByRole('button', { name: /Codex（默认）/ })
  assert.equal(
    await native.isEnabled(),
    true,
    'Failed ACP conversation must remain switchable after restart',
  )
  await native.click()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-agent-action="send"]')?.getAttribute('aria-label') === '发送',
    null,
    { timeout: 3000 },
  )
  await send(
    '请调用 Studio 的 editor_read 工具读取当前工作空间的 marker.md，回复文件里的标记。不要使用 shell。',
  )
  const recovered = await page.evaluate(() => window.__codexSmoke)
  assert.equal(recovered.runs.at(-1)?.conversationId, conversationId)
  assert(JSON.stringify(recovered.streams).includes('STUDIO_CODEX_UI_8624'))
  assert(JSON.stringify(recovered.streams).includes('editor_read'))
  const status = await page.evaluate(
    (id) => window.cclinkStudio.agent.getStatus(id),
    conversationId,
  )
  assert.equal(status.runtimeBinding.kind, 'codex')
  assert(status.sessionId)
  await page.screenshot({ path: join(runDir, 'acp-recovered.png') })
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await page.locator('[data-agent-action="runtime"]:visible').last().click()
  assert.equal(await page.getByRole('button', { name: /^Codex ACP/ }).count(), 0)
  assert(
    (await page.getByRole('button', { name: /Codex（默认）/ }).getAttribute('class')).includes(
      'selected',
    ),
  )
  await page.keyboard.press('Escape')
  await send('只回复 NATIVE_DEFAULT_OK，不使用工具。')
  const finalEvents = await page.evaluate(() => window.__codexSmoke)
  const newId = finalEvents.runs.at(-1).conversationId
  assert.notEqual(newId, conversationId)
  const fresh = await page.evaluate((id) => window.cclinkStudio.agent.getStatus(id), newId)
  assert.equal(fresh.runtimeBinding.kind, 'codex')
  assert(JSON.stringify(finalEvents.completions.at(-1)).includes('NATIVE_DEFAULT_OK'))
  await page.screenshot({ path: join(runDir, 'native-default.png') })
  const result = {
    success: true,
    sourceVersion: JSON.parse(await readFile('package.json', 'utf8')).version,
    newConversation: 'native Codex selected, no ACP option, real response passed',
    acpWithoutKey: 'reproduced',
    failedSession: 'none',
    recoveryPath: restart
      ? 'restart then switch, same conversation'
      : 'switch immediately, same conversation',
    nativeCodex: 'real MCP read and response passed',
    runDir,
  }
  await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await writeFile(
    join(runDir, 'events.json'),
    JSON.stringify(await page?.evaluate(() => window.__codexSmoke).catch(() => null)),
  )
  await page?.screenshot({ path: join(runDir, 'failure.png') }).catch(() => {})
  await writeFile(
    join(runDir, 'failure.txt'),
    String(error) +
      '\n' +
      (await page
        .locator('body')
        .innerText()
        .catch(() => '')),
  )
  console.error('Codex UI smoke failed', runDir, error)
  process.exitCode = 1
} finally {
  await app?.close()
  await rm(workspace, { recursive: true, force: true })
}
