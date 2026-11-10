#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

// Uses the user's installed Codex and its existing file login. Only fixture files
// and isolated Studio userData are changed; model calls consume the Codex account.
const runDir = await mkdtemp(join(tmpdir(), 'studio-codex-ui-'))
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
  await page.getByRole('button', { name: /Codex（默认）/ }).waitFor()
  await page.keyboard.press('Escape')
  await send(
    '请调用 Studio 的 editor_read 工具读取当前工作空间的 marker.md，回复文件里的标记。不要使用 shell。',
  )
  let events = await page.evaluate(() => window.__codexSmoke)
  assert(JSON.stringify(events.streams).includes('editor_read'))
  assert(JSON.stringify(events.streams).includes('STUDIO_CODEX_UI_8624'))
  const init = events.streams.find((e) => e.type === 'system' && e.subtype === 'init')
  assert(init?.session_id)
  await page.screenshot({ path: join(runDir, 'codex-read.png') })
  await send('请用 Studio 的 editor_write 在当前工作空间创建 result.md，正文只写 CODEX_WRITE_OK。')
  assert((await readFile(join(workspace, 'result.md'), 'utf8')).includes('CODEX_WRITE_OK'))
  await writeFile(
    join(runDir, 'before-restart.json'),
    JSON.stringify(await page.evaluate(() => window.__codexSmoke)),
  )
  await app.close()
  await launch()
  await page.locator('[data-agent-action="runtime"]:visible').last().click()
  await page.getByRole('button', { name: /Codex（默认）/ }).waitFor()
  await page.keyboard.press('Escape')
  await send('上一轮你写入文件的标记是什么？只回复标记，不调用工具。')
  events = await page.evaluate(() => window.__codexSmoke)
  assert(
    events.streams
      .map((e) => e.event?.text || '')
      .join('')
      .includes('CODEX_WRITE_OK'),
  )
  await writeFile(join(runDir, 'after-restart.json'), JSON.stringify(events))
  const resumed = events.streams.find((e) => e.type === 'system' && e.subtype === 'init')
  assert.equal(resumed?.session_id, init.session_id)
  const streamCount = events.streams.length
  await page
    .locator('[data-agent-landmark="composer"] textarea:visible')
    .last()
    .fill('请从 1 开始逐行数到 10000，不要使用工具。')
  await page.locator('[data-agent-action="send"]:visible').last().click()
  await page.waitForFunction(
    (count) => window.__codexSmoke.streams.slice(count).some((e) => e.event?.type === 'text-delta'),
    streamCount,
    { timeout: 120000 },
  )
  await page.locator('[data-agent-action="stop"]:visible').last().click()
  await page.waitForFunction(
    () => window.__codexSmoke.runs.some((run) => run.status === 'cancelled'),
    null,
    { timeout: 15000 },
  )
  await send('只回复 CANCEL_RECOVERED，不调用工具。')
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await page.locator('[data-agent-action="runtime"]:visible').last().click()
  await page.getByRole('button', { name: /Claude Code（备选）/ }).click()
  await page.screenshot({ path: join(runDir, 'claude-choice.png') })
  const result = {
    success: true,
    default: 'Codex',
    studioTools: 'read/write passed',
    restartResume: 'same native session',
    cancellation: 'stopped a real response, then continued',
    claude: 'selectable, no API key configured',
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
