#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

// Explicit real-model check using the installed Codex's existing login. Pass the five
// synthetic image-*.png fixtures produced by agent-image-input-smoke.mjs. Never use personal images.
const paths = process.argv.slice(2).map((path) => resolve(path))
assert.equal(paths.length, 5, 'Pass five synthetic image fixtures from agent-image-input-smoke.mjs')
for (const path of paths) assert.ok((await stat(path)).size > 5 * 1024 * 1024)
const runDir = await mkdtemp(join(tmpdir(), 'studio-image-real-'))
const workspace = await mkdtemp(join(homedir(), '.cclink-image-smoke-'))
const userData = join(runDir, 'user-data')
await mkdir(userData)
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
try {
  const env = { ...process.env, CCLINK_STUDIO_TEST_USER_DATA_PATH: userData }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  app = await electron.launch({ args: [resolve('.')], env })
  page = await app.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await page.locator('.activity-bar-icon[title="会话"]').click()
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await page.evaluate(() => {
    window.__imageCheck = { text: '', errors: [], complete: false }
    window.cclinkStudio.agent.onStreamEvent((event) => {
      if (event.event?.type === 'text-delta') window.__imageCheck.text += event.event.text
    })
    window.cclinkStudio.agent.onError((error) =>
      window.__imageCheck.errors.push({ code: error.code, message: error.message }),
    )
    window.cclinkStudio.agent.onComplete(() => {
      window.__imageCheck.complete = true
    })
  })
  await page.locator('input[type="file"][accept*="image/png"]').last().setInputFiles(paths)
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.agent-image-attachment img').length === 5 &&
      !document.querySelector('.agent-image-preparation'),
    null,
    { timeout: 60_000 },
  )
  await page
    .locator('[data-agent-landmark="composer"] textarea:visible')
    .last()
    .fill(
      '请按顺序逐行抄写这五张图片顶部可见的文字，包括英文、数字和中文。只回复图片中的文字，不调用任何工具。',
    )
  await page.locator('[data-agent-action="send"]:visible').last().click()
  await page.waitForFunction(
    () => window.__imageCheck.complete || window.__imageCheck.errors.length,
    null,
    { timeout: 120_000 },
  )
  const result = await page.evaluate(() => window.__imageCheck)
  await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2))
  assert.deepEqual(result.errors, [])
  assert.equal((result.text.match(/CCLink image test 12345/g) ?? []).length, 5)
  assert.equal((result.text.match(/中文截图/g) ?? []).length, 5)
  await page.screenshot({ path: join(runDir, 'real-model-read.png'), fullPage: true })
  console.log(
    `PASS real Codex read the English, digits and Chinese in all five automatically compressed images\nARTIFACTS ${runDir}`,
  )
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(runDir, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(
      join(runDir, 'failure.txt'),
      await page
        .locator('body')
        .innerText()
        .catch(() => ''),
    )
  }
  console.error(`FAIL ${error.stack}\nARTIFACTS ${runDir}`)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  await rm(workspace, { recursive: true, force: true })
}
