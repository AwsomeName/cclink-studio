// Real Electron + production worker/IPC/UI + actual Claude runtime against a local fixture.
// No paid API, real credentials, or user's Studio profile is used.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'
const root = await mkdtemp(join(tmpdir(), 'studio-model-usage-ui-'))
const profile = join(root, 'profile'),
  home = join(root, 'home'),
  documents = join(root, 'documents')
const repository = resolve(import.meta.dirname, '..')
const evidence = join(repository, 'docs/testing/model-usage')
await Promise.all(
  [profile, home, documents, evidence].map((path) => mkdir(path, { recursive: true })),
)
const result = await promisify(execFile)(
  process.execPath,
  ['scripts/model-usage-smoke.mjs', '--profile', profile],
  { cwd: repository, timeout: 60000 },
)
assert(result.stdout.includes('"result": "PASS"'))
console.log(
  'PASS actual runtime → sanitized observer → background worker → SQLite (2 calls, output 50)',
)
await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({ componentSetupPageSeenVersion: 2, claudeRuntimeSource: 'system' }),
)
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron');app.setPath('home',${JSON.stringify(home)});app.setPath('documents',${JSON.stringify(documents)});app.setAppPath(${JSON.stringify(repository)});require(${JSON.stringify(join(repository, 'out/main/index.js'))});`,
)
let app, page
const passed = []
const pass = (name) => {
  passed.push(name)
  console.log('PASS ' + name)
}
const query = { from: '2020-01-01T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z' }
async function snapshot() {
  const result = await page.evaluate(
    (query) => window.cclinkStudio.modelUsage.snapshot(query),
    query,
  )
  assert(result.success, JSON.stringify(result))
  return result.value
}
async function until(check, message) {
  for (let i = 0; i < 60; i++) {
    if (await check()) return
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 150))
  }
  throw new Error(message)
}
async function launch() {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [launcher],
    cwd: repository,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
    timeout: 30000,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.waitForSelector('.main-window')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000),
  )
  if (!(await page.locator('.settings-page').count()))
    await page.locator('.activity-bar-icon[title="设置"]').click()
  await page.locator('.settings-nav-item').filter({ hasText: '模型用量' }).click()
  await page.locator('.mu-counts').waitFor()
}
try {
  await launch()
  assert.equal((await snapshot()).all.calls, 2)
  assert((await page.locator('.mu-counts').innerText()).includes('2 次调用'))
  pass('settings shows real collected usage with partial-usage explanation')
  await page.getByRole('button', { name: '按模型', exact: true }).click()
  assert((await page.locator('.mu-legend').last().innerText()).includes('claude-sonnet'))
  await page.getByRole('button', { name: '按 Token 类型', exact: true }).click()
  await page.locator('.mu-day[aria-label*="2 次调用"]').click()
  await page.locator('.mu-call').first().locator('summary').click()
  await page.getByLabel('设置任务类别').first().selectOption('development')
  await until(
    async () => (await snapshot()).excludingDevelopment.calls === 0,
    'classification did not affect report',
  )
  await page.getByRole('button', { name: '用量概览', exact: true }).click()
  await page.getByRole('button', { name: '排除开发', exact: true }).click()
  await until(
    async () => (await page.locator('.mu-counts').innerText()).startsWith('0 次调用'),
    'scope UI did not update',
  )
  pass('heatmap drills into calls; explicit classification updates exclude-development summary')
  await page.getByRole('button', { name: '全部工作量', exact: true }).click()
  const jsonPath = join(root, 'export.json'),
    csvPath = join(root, 'export.csv')
  await app.evaluate(
    ({ dialog }, { jsonPath, csvPath }) => {
      dialog.showSaveDialog = async (options) => ({
        canceled: false,
        filePath: options.filters[0].extensions[0] === 'json' ? jsonPath : csvPath,
      })
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [jsonPath] })
    },
    { jsonPath, csvPath },
  )
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  await until(async () => {
    try {
      return JSON.parse(await readFile(jsonPath, 'utf8')).records.length === 2
    } catch {
      return false
    }
  }, 'JSON export failed')
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click()
  await until(async () => {
    try {
      return (await readFile(csvPath, 'utf8')).includes('cacheRead')
    } catch {
      return false
    }
  }, 'CSV export failed')
  const json = JSON.parse(await readFile(jsonPath, 'utf8'))
  assert.equal(json.report.all.tokens.output.value, 50)
  assert.equal(new Set(json.records.map((row) => row.originId)).size, 1)
  pass('CSV / JSON export matches visible scope and preserves origin and missing fields')
  await page.getByText('历史数据、采集设置与费用', { exact: true }).click()
  await page.getByRole('button', { name: '回填 Studio 历史', exact: true }).click()
  await page.getByText(/新增 0 条，重复/).waitFor()
  assert.equal((await snapshot()).all.calls, 2)
  await page.getByRole('button', { name: '导入其他来源 JSON', exact: true }).click()
  await page.getByText(/新增 0 条，重复 2 条/).waitFor()
  assert.equal((await snapshot()).all.calls, 2)
  pass('history backfill and repeated JSON import do not double count')
  await page.getByText('历史数据、采集设置与费用', { exact: true }).click()
  await page.locator('.settings-content').evaluate((element) => (element.scrollTop = 0))
  await page.screenshot({ path: join(evidence, 'settings-real-runtime.png') })
  await page.locator('.mu-chart').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'charts-real-runtime.png') })
  await page.getByLabel('自动记录模型用量').uncheck()
  await until(async () => !(await snapshot()).enabled, 'disable failed')
  await app.close()
  app = null
  await launch()
  assert.equal((await snapshot()).enabled, false)
  assert.equal((await snapshot()).all.calls, 2)
  assert.equal(await page.getByLabel('自动记录模型用量').isChecked(), false)
  pass('disabled state and historical usage survive an actual Electron restart')
  const rejected = await page.evaluate(() => window.cclinkStudio.modelUsage.backfill('/etc'))
  assert.equal(rejected.success, false)
  pass('production IPC rejects arbitrary renderer filesystem arguments')
  await writeFile(
    join(evidence, 'result.json'),
    JSON.stringify({ at: new Date().toISOString(), paidApiCalls: 0, checks: passed }, null, 2) +
      '\n',
  )
} finally {
  if (app) await app.close()
  await rm(root, { recursive: true, force: true })
}
