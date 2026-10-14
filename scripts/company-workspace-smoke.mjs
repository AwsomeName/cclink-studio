#!/usr/bin/env node
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const rootDir = resolve(import.meta.dirname, '..')
const runDir = await realpath(await mkdtemp(join(tmpdir(), 'cclink-company-smoke-')))
const userData = join(runDir, 'user-data')
// WorkspaceState only authorizes local roots under the user's home directory.
const workspaceRoot = await realpath(
  await mkdtemp(join(homedir(), '.cclink-company-workspace-smoke-')),
)
const a = join(workspaceRoot, 'company-a')
const b = join(workspaceRoot, 'company-b')
await Promise.all([userData, a, b].map((path) => mkdir(path)))
const material = join(a, '产品规格.md')
const csv = join(a, '付款流水.csv')
await writeFile(material, '# AR 眼镜规格\n\n公司工作空间验收资料。\n')
await writeFile(
  csv,
  '日期,收支,金额,账户,交易对方,用途,交易号\n2026-09-02,支出,180,银行卡,示例服务商,试戴服务,smoke-1\n',
)
await writeFile(
  join(userData, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: Object.fromEntries(
      [a, b].map((path, index) => [
        'smoke-' + index,
        {
          workspaceKey: path,
          workspacePath: path,
          ownerKey: null,
          updatedAt: Date.now(),
          storage: 'fallback',
          projectId: null,
        },
      ]),
    ),
  }),
)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: a,
    recentWorkspacePaths: [a, b],
    componentSetupPageSeenVersion: 2,
  }),
)
let app
let page
const results = []
const environment = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '',
  ELECTRON_RENDERER_URL: '',
  CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
}
const scope = (path) => ({ workspaceRef: { kind: 'local', path }, month: '2026-09' })
function assert(value, message) {
  if (!value) throw new Error(message)
}
function pass(name) {
  results.push({ name, status: 'pass' })
  console.log('PASS ' + name)
}
async function until(operation, predicate, description) {
  const end = Date.now() + 20000
  let result
  while (Date.now() < end) {
    result = await operation()
    if (predicate(result)) return result
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(description + ': ' + JSON.stringify(result))
}
async function launch() {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [rootDir],
    cwd: rootDir,
    env: environment,
    timeout: 30000,
  })
  page = await app.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30000 })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960),
  )
}
async function switchWorkspace(path) {
  const result = await page.evaluate(async (target) => {
    const current = await window.cclinkStudio.workspaceState.listLocalWorkspaces()
    if (!current.some((item) => item.workspacePath === target))
      throw new Error('Fixture root not registered')
    const root = await window.cclinkStudio.workspaceState.resolveLocalWorkspace(target)
    if (!root.valid) throw new Error(root.error)
    // Use the production command/controller entry through the workspace picker.
    return root
  }, path)
  assert(result.valid, 'Workspace root resolution failed')
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, path)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await page
    .getByRole('button', { name: '关闭打开工作空间', exact: true })
    .waitFor({ state: 'hidden' })
}
try {
  await launch()
  await page.getByRole('button', { name: '公司经营', exact: true }).click()
  await page.getByRole('heading', { name: '启用公司视图', exact: true }).waitFor({ timeout: 20000 })
  await page.getByLabel('公司显示名称').fill('眼镜研发公司')
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await page.getByLabel('账目月份').fill('2026-09')
  pass('普通本地工作空间免登录启用公司视图')
  await page.getByRole('button', { name: '创建业务项目', exact: true }).click()
  await page.getByLabel('业务项目名称').fill('AR 眼镜一代')
  await page.getByLabel('目标', { exact: true }).fill('完成首轮试戴资料')
  await page.getByLabel('交付条件').fill('规格与试戴资料可以追溯')
  await page.getByRole('button', { name: '创建并打开业务', exact: true }).click()
  await page.getByRole('heading', { name: 'AR 眼镜一代', exact: true }).waitFor()
  pass('创建真实业务项目并打开详情')
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, material)
  await page.getByRole('button', { name: '关联文件', exact: true }).click()
  await page.getByText('产品规格.md', { exact: true }).waitFor()
  const openFile = page.getByRole('button', { name: '打开原记录', exact: true }).first()
  await openFile.click()
  await page
    .locator('.tiptap')
    .getByText('AR 眼镜规格', { exact: false })
    .waitFor({ timeout: 10000 })
    .catch(() => page.getByText('AR 眼镜规格', { exact: false }).first().waitFor())
  await page.locator('.activity-bar-icon[title="公司经营"]').click()
  await page.getByRole('button', { name: '业务项目', exact: true }).click()
  await page.getByRole('button', { name: 'AR 眼镜一代', exact: true }).click()
  pass('关联真实文件并通过原编辑器查看')
  // Create a real conversation using the production command, without sending a model request.
  const newConversation = page.getByRole('button', { name: '新建会话', exact: true })
  if (await newConversation.count()) await newConversation.first().click()
  const conversation = await until(
    async () =>
      page.evaluate((input) => window.cclinkStudio.companyWorkspace.getSnapshot(input), scope(a)),
    (value) => value.success && value.data.conversations.length > 0,
    'Persisted conversation directory',
  )
  assert(
    (await page.getByLabel('账目月份').inputValue()) === '2026-09',
    'Returning from a source editor lost the selected month',
  )
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByLabel('选择关联会话').selectOption(conversation.data.conversations[0].id)
  await page.getByRole('button', { name: '关联会话', exact: true }).click()
  await until(
    () =>
      page.evaluate((input) => window.cclinkStudio.companyWorkspace.getSnapshot(input), scope(a)),
    (value) => value.success && value.data.links.some((link) => link.kind === 'conversation'),
    'Conversation binding',
  )
  pass('关联主进程持久化的原有会话')
  // Exercise the existing ledger service through its actual preload API; no simulated confirmation.
  const ledger = await page.evaluate(
    async (input) => {
      const api = window.cclinkStudio.companyAccounts
      let result = await api.initialize(input.month)
      if (!result.success) throw new Error(result.error.message)
      const project = await api.createProject('眼镜研发支出')
      if (!project.success) throw new Error(project.error.message)
      const imported = await api.importFiles({ month: input.month, filePaths: [input.csv] })
      if (!imported.success) throw new Error(imported.error.message)
      result = await api.getSnapshot(input.month)
      if (!result.success) throw new Error(result.error.message)
      const record = result.data.records[0]
      result = await api.updateRecord({
        recordId: record.id,
        expectedVersion: record.version,
        date: record.date,
        recordType: record.recordType,
        direction: record.direction,
        amountMinor: record.amountMinor,
        currency: record.currency,
        account: record.account,
        counterparty: record.counterparty,
        purpose: record.purpose,
        category: '研发服务',
        projectId: project.data.id,
        documentIds: [],
      })
      if (!result.success) throw new Error(result.error.message)
      const confirmed = await api.confirmRecord({
        recordId: record.id,
        expectedVersion: result.data.records[0].version,
      })
      if (!confirmed.success) throw new Error(confirmed.error.message)
      return project.data
    },
    { month: '2026-09', csv },
  )
  await until(
    () =>
      page.evaluate((input) => window.cclinkStudio.companyWorkspace.getSnapshot(input), scope(a)),
    (value) =>
      value.success && value.data.finance.projects.some((project) => project.id === ledger.id),
    'Company finance projection',
  )
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('button', { name: '修改业务信息', exact: true }).click()
  await page.locator('.company-form select').selectOption(ledger.id)
  await page.getByRole('button', { name: '保存业务信息', exact: true }).click()
  await page.getByText(/¥180\.00 · 本月已确认实际支出/).waitFor()
  await page.getByRole('button', { name: '查看关联流水与凭证', exact: true }).click()
  await page.getByText('2026-09 流水 · 眼镜研发支出', { exact: true }).waitFor()
  await page.getByText('示例服务商', { exact: true }).first().waitFor()
  pass('绑定原账目归属并下钻到实际确认流水')
  await page.getByRole('button', { name: '公司总览', exact: true }).click()
  await page.getByRole('button', { name: 'AR 眼镜一代', exact: true }).click()
  // Create an original, unstarted publishing task in the isolated profile; no login or execution.
  const manuscript = join(a, '运营介绍.md')
  await writeFile(manuscript, '# AR 眼镜介绍\n\n首轮产品介绍稿，仅用于关联与下钻验收。\n')
  const publication = await page.evaluate(
    async ({ workspacePath, markdownPath }) => {
      const workspaceRef = { kind: 'local', path: workspacePath }
      const account = await window.cclinkStudio.webResources.createConnection({
        workspaceRef,
        websiteName: 'CSDN 验收账号',
        entryUrl: 'https://blog.csdn.net/',
        principalKind: 'company',
        principalName: '验收公司',
        accountLabel: '本地未登录验收账号',
      })
      if (!account.success) throw new Error(account.error.message)
      const result = await window.cclinkStudio.articlePublishing.createTask({
        workspaceRef,
        markdownPath,
        accountId: account.data.account.id,
        fields: { title: 'AR 眼镜介绍', summary: '关联验收稿', tags: [], category: '' },
      })
      if (!result.success) throw new Error(result.error.message)
      return result.data
    },
    { workspacePath: a, markdownPath: manuscript },
  )
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByLabel('选择已有发布任务').selectOption(publication.id)
  await page.getByRole('button', { name: '关联发布任务', exact: true }).click()
  const publishingRow = page.locator('.company-row').filter({ hasText: publication.title })
  await publishingRow.getByRole('button', { name: '打开原记录', exact: true }).click()
  await page.getByRole('heading', { name: publication.title, exact: true }).waitFor()
  const publishingFact = await page.evaluate(
    (input) => window.cclinkStudio.companyWorkspace.getSnapshot(input),
    scope(a),
  )
  assert(
    publishingFact.success &&
      publishingFact.data.publications.some(
        (item) => item.id === publication.id && item.status === 'not-started',
      ),
    'Company changed the original publication fact',
  )
  await page.getByRole('button', { name: '业务项目', exact: true }).click()
  await page.getByRole('button', { name: 'AR 眼镜一代', exact: true }).click()
  pass('关联原发布事务并下钻，未开始事实保持不变')
  await page.getByRole('button', { name: '归档业务', exact: true }).click()
  await page.getByRole('button', { name: '重新打开业务', exact: true }).waitFor()
  const archived = await page.evaluate(
    (input) => window.cclinkStudio.companyWorkspace.getSnapshot(input),
    scope(a),
  )
  assert(
    archived.success && archived.data.projects[0].archived && archived.data.links.length === 3,
    'Archiving removed resource references',
  )
  await page.getByRole('button', { name: '重新打开业务', exact: true }).click()
  await page.getByRole('button', { name: '归档业务', exact: true }).waitFor()
  pass('业务归档和重新打开保留三类来源关联')
  await page.getByRole('button', { name: '公司总览', exact: true }).click()
  await writeFile(material, '# 产品规格\n\n已更新。')
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('button', { name: '查看下一步', exact: true }).click()
  await page.getByText(/文件已变化，使用前请核对/).waitFor()
  await rm(material)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByText(/文件缺失或不再属于当前工作空间/).waitFor()
  pass('变化与缺失资料显示真实卡点')
  await page.screenshot({ path: join(runDir, 'company-project.png'), fullPage: true })
  await switchWorkspace(b)
  await page.getByRole('button', { name: '公司经营', exact: true }).click()
  await page.getByRole('heading', { name: '启用公司视图', exact: true }).waitFor()
  const other = await page.evaluate(
    (input) => window.cclinkStudio.companyWorkspace.getSnapshot(input),
    scope(b),
  )
  assert(other.success && other.data.projects.length === 0, 'A business leaked into B')
  await switchWorkspace(a)
  await page.getByRole('button', { name: '公司经营', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await page.getByRole('button', { name: 'AR 眼镜一代', exact: true }).click()
  assert(
    (await page.getByLabel('账目月份').inputValue()) === '2026-09',
    'Workspace switching lost the selected company month',
  )
  pass('A/B 切换隔离并恢复业务关联')
  await app.close()
  app = null
  await launch()
  await page.getByRole('button', { name: '公司经营', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await page.getByRole('button', { name: 'AR 眼镜一代', exact: true }).click()
  assert(
    (await page.getByLabel('账目月份').inputValue()) === '2026-09',
    'Restart lost the selected company month',
  )
  const restored = await page.evaluate(
    (input) => window.cclinkStudio.companyWorkspace.getSnapshot(input),
    scope(a),
  )
  assert(
    restored.success &&
      restored.data.projects.length === 1 &&
      restored.data.links.length === 3 &&
      restored.data.projects[0].ledgerProjectId === ledger.id,
    'Restart did not restore company state',
  )
  pass('完整 Electron 重启保留业务、文件和会话引用及财务绑定')
  await page.getByRole('button', { name: '公司总览', exact: true }).click()
  await page.getByRole('button', { name: '关闭公司视图', exact: true }).click()
  await page.getByRole('heading', { name: '启用公司视图', exact: true }).waitFor()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.locator('.sidebar').waitFor()
  pass('关闭公司视图后本地文件能力继续可用')
  console.log(JSON.stringify({ runDir, results }, null, 2))
  await writeFile(
    join(runDir, 'result.json'),
    JSON.stringify(
      {
        runDir,
        results,
        scope:
          'Real Electron automated acceptance; fixtures only, file picker return controlled; no model request or publication.',
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error(error)
  if (page)
    await page.screenshot({ path: join(runDir, 'failure.png'), fullPage: true }).catch(() => {})
  console.error('Evidence: ' + runDir)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  await rm(workspaceRoot, { recursive: true, force: true })
  console.log('Temporary smoke workspaces removed: ' + workspaceRoot)
}
