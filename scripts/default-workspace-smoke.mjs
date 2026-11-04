#!/usr/bin/env node
// Real Electron, production IPC/UI and optional live model. All writes use an isolated home/profile.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-default-workspace-smoke-')))
const home = join(root, 'home')
const userData = join(root, 'user-data')
const evidence = join(repository, 'docs/testing/default-workspace-first-batch')
await Promise.all(
  [home, userData, join(root, 'documents'), evidence].map((p) => mkdir(p, { recursive: true })),
)
const live = process.env.CCLINK_DEFAULT_WORKSPACE_LIVE_MODEL === '1'
const source = join(homedir(), 'Library/Application Support/CCLink Studio')
const originalSettings = live ? await readFile(join(source, 'settings.json')) : null
const originalCredentials = live
  ? await readFile(join(source, 'credentials/credentials.json'))
  : null
const provider = originalSettings ? JSON.parse(originalSettings) : {}
const apiKey = originalCredentials
  ? JSON.parse(originalCredentials).records?.['agent:default']?.fields?.apiKey
  : null
if (live)
  assert(
    apiKey && provider.apiBaseUrl && provider.modelName,
    'Live model configuration is incomplete',
  )
const month = '2026-09'
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    componentSetupPageSeenVersion: 2,
    claudeRuntimeSource: 'system',
    ...(live
      ? {
          provider: provider.provider,
          apiBaseUrl: provider.apiBaseUrl,
          modelName: provider.modelName,
        }
      : {}),
  }),
)
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const { app } = require('electron');
app.setPath('home', ${JSON.stringify(home)});
app.setPath('documents', ${JSON.stringify(join(root, 'documents'))});
app.setAppPath(${JSON.stringify(repository)});
require(${JSON.stringify(join(repository, 'out/main/index.js'))});
`,
)
let app
let page
const results = []
const pass = (name) => {
  results.push({ name, status: 'pass' })
  console.log('PASS ' + name)
}
const scope = (path) => ({ workspaceRef: { kind: 'local', path }, month })
const digest = (data) => createHash('sha256').update(data).digest('hex')
async function until(operation, condition, message, timeout = 30000) {
  const deadline = Date.now() + timeout
  let value
  while (Date.now() < deadline) {
    value = await operation()
    if (condition(value)) return value
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(message + ': ' + JSON.stringify(value))
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
      CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
    timeout: 30000,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.waitForSelector('.main-window', { timeout: 30000 })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960),
  )
}
async function close() {
  await app.close()
  app = null
}
async function chooser() {
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
}
async function switchTo(path) {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, path)
  await chooser()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await page
    .getByRole('button', { name: '关闭打开工作空间', exact: true })
    .waitFor({ state: 'hidden' })
}
async function clickCompany() {
  await page.getByRole('button', { name: '公司经营', exact: true }).click()
}
try {
  await launch()
  const a = join(home, 'CCLink Studio', '默认工作空间')
  await until(
    () => readFile(join(a, '.cclink-studio/project.json'), 'utf8').catch(() => null),
    Boolean,
    'Default manifest missing',
  )
  const identity = JSON.parse(
    await readFile(join(a, '.cclink-studio/project.json'), 'utf8'),
  ).projectId
  const settings = await page.evaluate(() => window.cclinkStudio.settings.getAll())
  assert.equal(settings.defaultWorkspacePath, a)
  if (live)
    await page.evaluate((key) => window.cclinkStudio.settings.setSecret('apiKey', key), apiKey)
  pass('A01 首次启动自动建立唯一默认空间，不登录、不先选目录')
  await page.screenshot({ path: join(evidence, 'default-workspace.png') })

  await page.getByRole('button', { name: '文章发布', exact: true }).click()
  await page.getByRole('button', { name: '新建运营稿', exact: true }).click()
  const editor = page.locator('.tiptap[contenteditable="true"]').first()
  await editor.waitFor()
  const marker = 'DEFAULT-WORKSPACE-ACCEPTANCE-20261103'
  await editor.fill('默认工作空间验收稿\n\n' + marker)
  await page.keyboard.press('Meta+s')
  const tree = await page.evaluate(
    (path) => window.cclinkStudio.fs.readDir(path),
    join(a, '运营/原稿'),
  )
  const manuscript = tree.find((entry) => entry.name.endsWith('.md')).path
  await until(
    () => readFile(manuscript, 'utf8'),
    (content) => content.includes(marker),
    'Draft save missing',
  )
  const manuscriptHash = digest(await readFile(manuscript))
  pass('B01 新建运营稿经真实编辑器保存到运营/原稿，不覆盖旧文件')

  await clickCompany()
  await page.getByLabel('公司显示名称').fill('默认空间验收公司')
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await page.getByLabel('账目月份').fill(month)
  await page.getByRole('button', { name: '创建业务项目', exact: true }).click()
  await page.getByLabel('业务项目名称').fill('默认空间运营业务')
  await page.getByLabel('目标', { exact: true }).fill('保存并恢复经营资料')
  await page.getByLabel('交付条件').fill('原稿、账目和任务重启后仍可打开')
  await page.getByRole('button', { name: '创建并打开业务', exact: true }).click()
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, manuscript)
  await page.getByRole('button', { name: '关联文件', exact: true }).click()
  await page
    .locator('.company-row')
    .filter({ hasText: manuscript.split('/').at(-1) })
    .waitFor()
  pass('B01 公司创建业务并关联同一运营稿件')

  const csv = join(a, '验收流水.csv')
  await writeFile(
    csv,
    '日期,收支,金额,账户,交易对方,用途,交易号\n2026-09-02,支出,180,银行卡,验收服务商,经营资料验证,default-1\n',
  )
  const ledger = await page.evaluate(
    async ({ month, csv }) => {
      const api = window.cclinkStudio.companyAccounts
      const check = (result) => {
        if (!result.success) throw new Error(result.error.message)
        return result.data
      }
      check(await api.initialize(month))
      const project = check(await api.createProject('验收经营支出'))
      check(await api.importFiles({ month, filePaths: [csv] }))
      let snapshot = check(await api.getSnapshot(month))
      let row = snapshot.records[0]
      snapshot = check(
        await api.updateRecord({
          recordId: row.id,
          expectedVersion: row.version,
          date: row.date,
          recordType: row.recordType,
          direction: row.direction,
          amountMinor: row.amountMinor,
          currency: row.currency,
          account: row.account,
          counterparty: row.counterparty,
          purpose: row.purpose,
          category: '经营服务',
          projectId: project.id,
          documentIds: [],
        }),
      )
      row = snapshot.records[0]
      check(await api.confirmRecord({ recordId: row.id, expectedVersion: row.version }))
      return { projectId: project.id, recordId: row.id }
    },
    { month, csv },
  )
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('button', { name: '修改业务信息', exact: true }).click()
  await page.locator('.company-form select').selectOption(ledger.projectId)
  await page.getByRole('button', { name: '保存业务信息', exact: true }).click()
  await page.getByText(/180\.00 · 本月已确认实际支出/).waitFor()
  await page.getByRole('button', { name: '查看关联流水与凭证', exact: true }).click()
  await page.getByText('验收服务商', { exact: true }).first().waitFor()
  pass('B02 原账目导入、确认、公司财务绑定及原流水下钻')

  await page.locator('[title="定时任务"]').first().click()
  await page.getByRole('button', { name: '新建定时任务', exact: true }).first().click()
  await page.getByLabel('任务名称').fill('默认空间资料验收')
  await page
    .getByLabel('任务内容')
    .fill(
      '读取绑定的 Markdown，输出简短 Markdown 摘要，务必保留文件中的验收标记原文，不添加未经证实的内容。',
    )
  await page
    .getByLabel('工作空间内路径（支持相对路径或绝对路径，每行一个，可留空）')
    .fill(manuscript)
  await page.getByLabel('结果保存方式').selectOption('workspace-file')
  await page.getByLabel('工作空间内目录').fill('产物')
  await page.getByLabel('文件名模板').fill('验收-{runId}.md')
  await page.getByLabel('周期').selectOption('once')
  const due = new Date(Date.now() + 100000)
  const pad = (n) => String(n).padStart(2, '0')
  const dueString = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`
  await page.getByLabel('日期与时间').fill(dueString)
  await page.getByRole('button', { name: '保存并在此设备启用', exact: true }).click()
  const tasks = await until(
    () => page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), a),
    (result) => result.success && result.tasks.length === 1 && result.tasks[0].activation.enabled,
    'Task save did not reach the production owner',
  )
  assert(
    (await page.locator('.scheduled-task-tab-header').innerText()).includes('已保存并在此设备启用'),
  )
  assert(tasks.success && tasks.tasks.length === 1)
  const taskId = tasks.tasks[0].definition.id
  assert(tasks.tasks[0].activation.enabled)
  pass('B03 定时任务定义及本机启用通过原 UI 保存')
  if (live) await page.getByRole('button', { name: '立即运行', exact: true }).click()

  const b = join(home, '已有资料空间')
  await mkdir(b)
  const preserved = join(b, '原有资料.md')
  await writeFile(preserved, '# 原有资料\n\n不得因默认空间改变。\n')
  const preservedHash = digest(await readFile(preserved))
  await switchTo(b)
  await clickCompany()
  await page.getByRole('heading', { name: '启用公司视图', exact: true }).waitFor()
  const emptyTasks = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), b)
  assert(emptyTasks.success && emptyTasks.tasks.length === 0)
  pass('B04 切换其他已有目录，公司和任务列表不串空间')

  if (live) {
    const readRuns = () =>
      page.evaluate(({ a, taskId }) => window.cclinkStudio.scheduledTasks.listRuns(a, taskId), {
        a,
        taskId,
      })
    const manual = await until(
      readRuns,
      (r) =>
        r.success &&
        r.runs.some(
          (run) => run.trigger === 'manual' && !['queued', 'running'].includes(run.status),
        ),
      'Live immediate run did not settle',
      180000,
    )
    const run = manual.runs.find((run) => run.trigger === 'manual')
    assert.equal(run.status, 'completed', run.error?.message)
    assert((await readFile(join(a, run.artifact.relativePath), 'utf8')).includes(marker))
    pass('B03 真实本地 SDK 与已配置模型立即运行成功，产物回原空间')
    const timed = await until(
      readRuns,
      (r) =>
        r.success &&
        r.runs.some(
          (run) => run.trigger !== 'manual' && !['queued', 'running'].includes(run.status),
        ),
      'Live due run did not settle',
      180000,
    )
    const scheduled = timed.runs.find((run) => run.trigger !== 'manual')
    assert.equal(scheduled.status, 'completed', scheduled.error?.message)
    assert((await readFile(join(a, scheduled.artifact.relativePath), 'utf8')).includes(marker))
    pass('B03 真实到点运行在其他空间激活时完成，文件和历史归属原空间')
  } else {
    results.push({
      name: 'B03 真实模型生成及到点运行',
      status: 'not-run',
      reason: 'Set CCLINK_DEFAULT_WORKSPACE_LIVE_MODEL=1 to use configured model',
    })
    await page.evaluate(
      ({ a, taskId }) =>
        window.cclinkStudio.scheduledTasks.setEnabled({ workspacePath: a, taskId, enabled: false }),
      { a, taskId },
    )
  }
  await close()
  await launch()
  const resumed = await page.evaluate(() => window.cclinkStudio.settings.getAll())
  assert.equal(resumed.lastWorkspacePath, b)
  assert.equal(digest(await readFile(preserved)), preservedHash)
  pass('A02 重启优先恢复原明确选择，已有资料内容不变')
  await chooser()
  await page.locator('.workspace-open-source-card').filter({ hasText: '默认工作空间' }).click()
  await page
    .getByRole('button', { name: '关闭打开工作空间', exact: true })
    .waitFor({ state: 'hidden' })
  await clickCompany()
  await page.getByRole('button', { name: '默认空间运营业务', exact: true }).click()
  await page.getByRole('button', { name: '打开原记录', exact: true }).first().click()
  await page.getByText(marker, { exact: false }).first().waitFor()
  assert.equal(digest(await readFile(manuscript)), manuscriptHash)
  const company = await page.evaluate(
    (input) => window.cclinkStudio.companyWorkspace.getSnapshot(input),
    scope(a),
  )
  assert(company.success && company.data.enabled && company.data.projects.length === 1)
  const restoredTasks = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), a)
  assert(restoredTasks.success && restoredTasks.tasks[0].definition.id === taskId)
  assert.equal(
    JSON.parse(await readFile(join(a, '.cclink-studio/project.json'), 'utf8')).projectId,
    identity,
  )
  pass('A01/B04 完整重启恢复默认身份、公司、原稿、账目关联与任务定义')
  await page.screenshot({ path: join(evidence, 'restored-operations.png') })
  await chooser()
  await page.getByRole('button', { name: '进入未归档', exact: true }).click()
  await close()
  await launch()
  assert.equal(
    (await page.evaluate(() => window.cclinkStudio.settings.getAll())).startupWorkspaceTarget,
    'unfiled',
  )
  pass('A03 明确未归档选择跨重启保留，不重新打开默认空间')
  await chooser()
  await page.locator('.workspace-open-source-card').filter({ hasText: '默认工作空间' }).click()
  await page
    .getByRole('button', { name: '关闭打开工作空间', exact: true })
    .waitFor({ state: 'hidden' })
  assert.equal(
    (await page.evaluate(() => window.cclinkStudio.settings.getAll())).startupWorkspaceTarget,
    'default',
  )
  await close()
  await rename(a, a + '-moved')
  await launch()
  await page
    .getByText(/已登记的默认工作空间不可用/)
    .first()
    .waitFor()
  await assert.rejects(readFile(join(a, '.cclink-studio/project.json')))
  assert.equal(
    JSON.parse(await readFile(join(a + '-moved', '.cclink-studio/project.json'), 'utf8')).projectId,
    identity,
  )
  pass('A05 原默认目录缺失时可用工作台明确降级，不创建空目录覆盖')
  await page.screenshot({ path: join(evidence, 'missing-default.png') })
  if (live) {
    assert.equal(digest(await readFile(join(source, 'settings.json'))), digest(originalSettings))
    assert.equal(
      digest(await readFile(join(source, 'credentials/credentials.json'))),
      digest(originalCredentials),
    )
    pass('真实用户设置和凭证只读使用，验收前后摘要完全一致')
  }
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  results.push({ name: 'failure', status: 'fail', message: error.message })
  throw error
} finally {
  if (app) await close()
  await writeFile(
    join(evidence, 'result.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), liveModel: live, results }, null, 2),
  )
  await rm(root, { recursive: true, force: true })
}
