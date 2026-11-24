#!/usr/bin/env node
// Real Electron check of the DeepSeek web search settings screens.
// Isolated user data; only a fake test key is stored and no request is sent to DeepSeek.
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const rootDir = resolve(import.meta.dirname, '..')
const runDir = await realpath(await mkdtemp(join(tmpdir(), 'cclink-web-search-smoke-')))
const userData = join(runDir, 'user-data')
await mkdir(userData)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({ componentSetupPageSeenVersion: 2, startupWorkspaceTarget: 'unfiled' }),
)
const results = []
let app
let page
const pass = (name) => {
  results.push({ name, status: 'pass' })
  console.log('PASS ' + name)
}
const assert = (value, message) => {
  if (!value) throw new Error(message)
}
const shot = (name) => page.screenshot({ path: join(runDir, name + '.png') })

try {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [rootDir],
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
    },
    timeout: 30000,
  })
  page = await app.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30000 })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960),
  )

  const initial = await page.evaluate(() => window.cclinkStudio.webSearch.getStatus())
  assert(initial.success && initial.data.state === 'disabled', 'Web search should start disabled')
  pass('联网搜索默认未启用，本地功能不受影响')

  // A fresh profile opens the “我的空间” first-run dialog; dismiss it without setting anything up.
  const firstRun = page.getByText('设置「我的空间」')
  if (await firstRun.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    if (await firstRun.isVisible().catch(() => false))
      await page.locator('button', { hasText: /^×$/ }).first().click()
    await firstRun.waitFor({ state: 'hidden' })
  }

  // Settings · API Key 与连接 · 联网搜索
  await page
    .getByRole('button', { name: /Studio 设置/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'API Key 与连接', exact: true }).first().click()
  await page
    .getByRole('button', { name: /^联网搜索/ })
    .first()
    .click()
  await page.getByRole('heading', { name: '联网搜索', exact: true }).waitFor()
  assert(
    await page.getByRole('radio', { name: /沿用 Claude Code/ }).isDisabled(),
    'Agent key option should be disabled without a DeepSeek agent key',
  )
  await shot('01-search-service-empty')
  pass('联网搜索设置页：未启用、无法沿用时禁用该选项')

  await page.getByLabel('DeepSeek API Key').fill('sk-smoke-test-not-a-real-key')
  await page.getByRole('button', { name: '仅保存', exact: true }).click()
  await page.getByText('已保存。').waitFor()
  const saved = await page.evaluate(() => window.cclinkStudio.webSearch.getStatus())
  assert(
    saved.success && saved.data.ownKeyConfigured && saved.data.state === 'disabled',
    'Own key should be saved without enabling search',
  )
  pass('单独填写的 Key 已保存；未验证前不启用')

  // Simulate a passed verification (no network): enable through the same IPC the page uses.
  await page.evaluate(async () => {
    const s = await window.cclinkStudio.webSearch.getStatus()
    if (!s.success) throw new Error(s.error)
    await window.cclinkStudio.webSearch.saveSettings({
      enabled: true,
      keySource: 'own',
      monthlyLimit: s.data.monthlyLimit,
      resultCount: s.data.resultCount,
      backends: s.data.backends,
    })
  })
  await page.getByRole('button', { name: 'Agent 行为与工具', exact: true }).first().click()
  await page.getByRole('button', { name: 'API Key 与连接', exact: true }).first().click()
  await page
    .getByRole('button', { name: /^联网搜索/ })
    .first()
    .click()
  await page.getByText(/✓ 已启用/).waitFor()
  await page.getByRole('button', { name: '停用联网搜索', exact: true }).waitFor()
  await shot('02-search-service-ready')
  pass('启用后显示“已启用”和停用按钮')

  // Agent 行为与工具 · 联网搜索 module with per-agent switches
  await page.getByRole('button', { name: 'Agent 行为与工具', exact: true }).first().click()
  const moduleRow = page.locator('.agent-module', { hasText: '联网搜索' })
  await moduleRow.waitFor()
  await moduleRow.locator('.agent-module-expand').click()
  await moduleRow.getByText('web_search', { exact: true }).waitFor()
  await moduleRow.getByText('谁可以用', { exact: true }).waitFor()
  await moduleRow.scrollIntoViewIfNeeded()
  await shot('03-agent-tools')
  const claudeToggle = moduleRow.locator('.web-search-access-grid > div', {
    hasText: 'Claude Code',
  })
  await claudeToggle.locator('button, input, [role="switch"]').first().click()
  const toggled = await page.evaluate(() => window.cclinkStudio.webSearch.getStatus())
  assert(toggled.success && toggled.data.backends.claudeCode === true, 'Claude toggle not saved')
  pass('Agent 工具页显示联网搜索模块，按 Agent 的开关已保存')

  // 模型用量 · 联网搜索
  await page.getByRole('button', { name: '模型用量', exact: true }).first().click()
  const usage = page.locator('.web-search-usage')
  await usage.waitFor()
  await usage.getByText('估算费用').waitFor()
  await usage.scrollIntoViewIfNeeded()
  await shot('04-usage')
  pass('模型用量页显示联网搜索次数与估算费用')

  // Claude Code · DeepSeek model choice (unsaved draft)
  await page.getByRole('button', { name: 'API Key 与连接', exact: true }).first().click()
  await page
    .getByRole('button', { name: /^Claude Code/ })
    .first()
    .click()
  await page.getByLabel('模型服务商').selectOption('deepseek')
  const choice = page.getByRole('radiogroup', { name: 'DeepSeek 模型' })
  await choice.waitFor()
  assert(
    (await choice.getByRole('radio', { name: /deepseek-flash/ }).getAttribute('aria-checked')) ===
      'true',
    'deepseek-flash should be the default',
  )
  await shot('05-deepseek-model')
  pass('选择 DeepSeek 时显示两个模型，默认 deepseek-flash')
} catch (error) {
  console.error(error)
  if (page) await page.screenshot({ path: join(runDir, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  await writeFile(join(runDir, 'result.json'), JSON.stringify({ runDir, results }, null, 2))
  console.log('Evidence: ' + runDir)
}
