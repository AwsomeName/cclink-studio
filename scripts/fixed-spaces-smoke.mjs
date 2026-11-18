#!/usr/bin/env node
// Real Electron UI and IPC. Every profile, workspace and write stays in an isolated test home.
// Build first; CCLINK_FIXED_SPACES_BUILD_ROOT can select an isolated electron-vite outDir.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const build = resolve(
  repository,
  process.env.CCLINK_FIXED_SPACES_BUILD_ROOT || '.cache/fixed-spaces-build',
)
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-fixed-spaces-smoke-')))
const fixture = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' })
  res.end(
    '<!doctype html><html><body style="margin:0;width:100%;height:2500px"><h1>固定空间浏览器验收</h1><input id="draft"><div style="position:absolute;left:3500px;width:10px">overflow</div></body></html>',
  )
})
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/fixed-spaces`
const results = []
const pageErrors = []
let app
let page
const pass = (name) => {
  results.push({ name, status: 'pass' })
  console.log(`PASS ${name}`)
}

async function prepare(name, settings = {}) {
  const home = join(root, name, 'home')
  const userData = join(root, name, 'profile')
  const documents = join(root, name, 'documents')
  await Promise.all([home, userData, documents].map((path) => mkdir(path, { recursive: true })))
  await writeFile(
    join(userData, 'settings.json'),
    JSON.stringify({
      componentSetupPageSeenVersion: 2,
      claudeRuntimeSource: 'system',
      ...settings,
    }),
  )
  const launcher = join(root, name, 'launch.cjs')
  await writeFile(
    launcher,
    `const {app}=require('electron');
app.setPath('home',${JSON.stringify(home)});
app.setPath('documents',${JSON.stringify(documents)});
app.setAppPath(${JSON.stringify(repository)});
require(${JSON.stringify(join(build, 'main/index.js'))});`,
  )
  return { home, userData, launcher, defaultPath: join(home, 'CCLink Studio', '默认工作空间') }
}

async function launch(profile) {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [profile.launcher],
    cwd: repository,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: profile.userData,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
    timeout: 30000,
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.setDefaultTimeout(15000)
  await page.waitForSelector('.main-window')
  await page.getByRole('button', { name: '我的空间', exact: true }).waitFor()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960),
  )
}
async function close() {
  await app.close()
  app = null
}
async function company() {
  await page.getByRole('button', { name: '公司经营', exact: true }).click()
}
async function unfiled() {
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: '进入未归档', exact: true }).click()
  await page.locator('.status-bar-workspace[title="未归档"]').waitFor()
}
async function companySnapshot(path) {
  return page.evaluate(
    (path) =>
      window.cclinkStudio.companyWorkspace.getSnapshot({
        workspaceRef: { kind: 'local', path },
        month: '2026-11',
      }),
    path,
  )
}
async function switchTo(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, path)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await page
    .getByRole('button', { name: '关闭打开工作空间', exact: true })
    .waitFor({ state: 'hidden' })
}
async function fixed() {
  return page.evaluate(() => window.cclinkStudio.workspaceState.getFixedSpaces())
}
async function clickFixed(role) {
  await page
    .locator('.fixed-space-entries')
    .getByRole('button', { name: role, exact: true })
    .click()
}
async function until(read, test, label) {
  for (let i = 0; i < 100; i++) {
    const result = await read()
    if (test(result)) return result
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(label)
}
try {
  const landingProject = join(root, 'personal-from-project/home/专项研发')
  const landingProfile = await prepare('personal-from-project', {
    startupWorkspaceTarget: 'resume',
    lastWorkspacePath: landingProject,
  })
  await mkdir(landingProject)
  await launch(landingProfile)
  await page.locator('.status-bar-workspace').filter({ hasText: '专项研发' }).waitFor()
  await clickFixed('我的空间')
  await page.getByRole('heading', { name: '我的空间', exact: true }).waitFor()
  await page.getByRole('button', { name: /新建笔记/ }).waitFor()
  await until(
    () =>
      page
        .locator('.workspace-sidebar-shell')
        .evaluate((element) => element.getBoundingClientRect().width),
    (width) => width < 1,
    'Personal landing page kept an empty secondary sidebar',
  )
  await page.screenshot({ path: join(root, 'personal-from-project.png'), scale: 'css' })
  pass('从普通空间启动后首次点击我的空间，直接显示个人工作台和新建入口')
  await close()
  const profile = await prepare('main', { startupWorkspaceTarget: 'resume', lastWorkspacePath: '' })
  await launch(profile)
  await page.getByRole('heading', { name: '我的空间', exact: true }).waitFor()
  await page.screenshot({ path: join(root, 'first-launch.png'), scale: 'css' })
  let bindings = await fixed()
  const personal = bindings.personal.workspacePath
  assert.equal(personal, join(profile.home, 'CCLink Studio/我的空间'))
  assert.equal(bindings.company, null)
  await assert.rejects(
    readFile(join(profile.home, 'CCLink Studio/我的公司/.cclink-studio/project.json')),
  )
  pass('首次启动双固定入口，个人自动可用，公司尚未建库')
  // An actual editor write, saved by the existing document workflow.
  await page.getByRole('button', { name: '文章发布', exact: true }).click()
  await page.getByRole('button', { name: '新建运营稿', exact: true }).click()
  await page
    .locator('.tiptap[contenteditable="true"]')
    .first()
    .fill('个人入口验收笔记 FIXED-SPACES-NOTE')
  await page.keyboard.press('Meta+s')
  const files = await page.evaluate(
    (path) => window.cclinkStudio.fs.readDir(path),
    join(personal, '运营/原稿'),
  )
  const note = files.find((entry) => entry.name.endsWith('.md')).path
  await until(
    () => readFile(note, 'utf8'),
    (value) => value.includes('FIXED-SPACES-NOTE'),
    'Personal note was not saved',
  )
  await clickFixed('我的空间')
  await page.getByRole('heading', { name: '我的空间', exact: true }).waitFor()
  await page
    .locator('.workspace-home-record')
    .filter({ hasText: note.split('/').at(-1) })
    .click()
  await page.locator('.tiptap').filter({ hasText: 'FIXED-SPACES-NOTE' }).waitFor()
  pass('真实编辑器写入个人笔记并保存到独立个人目录')
  await clickFixed('我的公司')
  await page.getByRole('dialog', { name: '连接已有公司，或开始新公司' }).waitFor()
  assert.equal(
    await page.locator('.fixed-space-entries [aria-current="page"]').innerText(),
    '我的空间',
  )
  await page.getByLabel(/启用一份新公司/).check()
  await page.getByLabel('新公司名称').fill('固定入口验收公司')
  await page.getByRole('button', { name: '启用新公司', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  bindings = await fixed()
  const oldCompany = bindings.company.workspacePath
  assert.notEqual(oldCompany, personal)
  await page.getByRole('button', { name: '创建业务项目', exact: true }).click()
  await page.getByLabel('业务项目名称').fill('原有经营业务')
  await page.getByLabel('目标', { exact: true }).fill('验证旧数据保留')
  await page.getByLabel('交付条件').fill('原记录可以下钻')
  await page.getByRole('button', { name: '创建并打开业务', exact: true }).click()
  await page.getByRole('heading', { name: '原有经营业务', exact: true }).waitFor()
  await page.getByRole('button', { name: '新建对话', exact: true }).first().click()
  const conversations = await until(
    () => companySnapshot(oldCompany),
    (value) => value.success && value.data.conversations.length > 0,
    'Conversation missing',
  )
  const conversationId = conversations.data.conversations[0].id
  const businessId = conversations.data.projects[0].id
  const csv = join(oldCompany, '旧流水.csv')
  await writeFile(
    csv,
    '日期,收支,金额,账户,交易对方,用途,交易号\n2026-11-02,支出,180,银行卡,验收服务商,旧流水验收,fixed-1\n',
  )
  const oldNote = join(oldCompany, '旧个人笔记.md')
  await writeFile(oldNote, '# 个人资料留在原公司目录\n')
  const seed = await page.evaluate(
    async ({ path, csv, businessId, conversationId }) => {
      const check = (result) => {
        if (!result.success) throw new Error(JSON.stringify(result.error))
        return result.data
      }
      const scope = { workspaceRef: { kind: 'local', path }, month: '2026-11' }
      check(
        await window.cclinkStudio.companyWorkspace.linkResource({
          ...scope,
          businessId,
          kind: 'conversation',
          target: conversationId,
        }),
      )
      const ledger = window.cclinkStudio.companyAccounts
      check(await ledger.initialize('2026-11'))
      check(await ledger.importFiles({ month: '2026-11', filePaths: [csv] }))
      const records = check(await ledger.getSnapshot('2026-11')).records
      const account = check(
        await window.cclinkStudio.webResources.createConnection({
          workspaceRef: scope.workspaceRef,
          websiteName: '验收账号',
          entryUrl: 'https://blog.csdn.net/',
          principalKind: 'company',
          principalName: '验收公司',
          accountLabel: '未登录验收账号',
        }),
      )
      const publication = check(
        await window.cclinkStudio.articlePublishing.createTask({
          workspaceRef: scope.workspaceRef,
          markdownPath: path + '/旧个人笔记.md',
          accountId: account.account.id,
          fields: { title: '原发布事务验收', summary: '不执行发布', tags: [], category: '' },
        }),
      )
      check(
        await window.cclinkStudio.companyWorkspace.linkResource({
          ...scope,
          businessId,
          kind: 'publishing',
          target: publication.id,
        }),
      )
      return {
        publicationId: publication.id,
        recordId: records[0].id,
        company: check(await window.cclinkStudio.companyWorkspace.getSnapshot(scope)),
      }
    },
    { path: oldCompany, csv, businessId, conversationId },
  )
  pass('启用独立公司并准备原业务、流水、混合个人笔记及关联会话')
  await close()
  const manifestBefore = await readFile(join(oldCompany, '.cclink-studio/project.json'), 'utf8')
  const companyBefore = await readFile(
    join(oldCompany, '.cclink-studio/company-workspace/company.sqlite'),
  )
  const accountsBefore = await readFile(
    join(oldCompany, '.cclink-studio/company-accounts/accounts.sqlite'),
  )
  // Simulate an installed pre-feature profile: only remove this feature's bindings.
  const statePath = join(profile.userData, 'workspace-state.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  delete state.fixedSpaces
  await writeFile(statePath, JSON.stringify(state))
  const settingsPath = join(profile.userData, 'settings.json')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  await writeFile(
    settingsPath,
    JSON.stringify({
      ...settings,
      defaultWorkspacePath: oldCompany,
      startupWorkspaceTarget: 'default',
    }),
  )
  await launch(profile)
  await page
    .locator('.fixed-space-entries [aria-current="page"]')
    .filter({ hasText: '我的空间' })
    .waitFor()
  await clickFixed('我的公司')
  await page.getByText('固定入口验收公司', { exact: true }).waitFor()
  await page.getByRole('button', { name: '使用这份公司资料', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  assert.deepEqual((await fixed()).company, bindings.company)
  assert.equal(
    await readFile(join(oldCompany, '.cclink-studio/project.json'), 'utf8'),
    manifestBefore,
  )
  assert.deepEqual(
    await readFile(join(oldCompany, '.cclink-studio/company-workspace/company.sqlite')),
    companyBefore,
  )
  assert.equal(await readFile(oldNote, 'utf8'), '# 个人资料留在原公司目录\n')
  await page.screenshot({ path: join(root, 'old-company-connected.png') })
  pass('旧默认公司接回原目录，身份与公司库字节不变，混合资料保留')
  await page.getByRole('button', { name: '原有经营业务', exact: true }).click()
  await page.getByRole('button', { name: '打开原记录', exact: true }).first().click()
  await until(
    () => page.evaluate(() => window.cclinkStudio.workspaceState.getFixedSpaces()),
    (value) => value.company.projectId === bindings.company.projectId,
    'Binding changed',
  )
  await company()
  await page.getByRole('button', { name: '财务', exact: true }).click()
  await page.getByText('验收服务商', { exact: true }).first().waitFor()
  const afterRecord = await page.evaluate(() =>
    window.cclinkStudio.companyAccounts.getSnapshot('2026-11'),
  )
  assert.equal(afterRecord.data.records[0].id, seed.recordId)
  assert.deepEqual(
    await readFile(join(oldCompany, '.cclink-studio/company-accounts/accounts.sqlite')),
    accountsBefore,
  )
  await company()
  await page.getByRole('button', { name: '原有经营业务', exact: true }).click()
  await page
    .locator('.company-row')
    .filter({ hasText: '原发布事务验收' })
    .getByRole('button', { name: '打开原记录', exact: true })
    .click()
  await page.getByRole('heading', { name: '原发布事务验收', exact: true }).waitFor()
  const restoredPublication = (await companySnapshot(oldCompany)).data.publications.find(
    (item) => item.id === seed.publicationId,
  )
  assert.equal(restoredPublication.status, 'not-started')
  pass('原公司关联会话、流水与原发布事务可下钻，账目库不变、发布仍未开始')
  const project = join(profile.home, '专项研发')
  await mkdir(project)
  await switchTo(project)
  await company()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  assert.equal(
    await page.locator('.fixed-space-entries [aria-current="page"]').innerText(),
    '我的公司',
  )
  await clickFixed('我的空间')
  await page.getByRole('heading', { name: '我的空间', exact: true }).waitFor()
  await page
    .locator('.workspace-home-record')
    .filter({ hasText: note.split('/').at(-1) })
    .click()
  await page.locator('.tiptap').filter({ hasText: 'FIXED-SPACES-NOTE' }).waitFor()
  await clickFixed('我的公司')
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await close()
  await launch(profile)
  await page
    .locator('.fixed-space-entries [aria-current="page"]')
    .filter({ hasText: '我的公司' })
    .waitFor()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  assert.equal((await companySnapshot(oldCompany)).data.projects[0].id, businessId)
  await clickFixed('我的空间')
  await page.getByRole('heading', { name: '我的空间', exact: true }).waitFor()
  await page
    .locator('.workspace-home-record')
    .filter({ hasText: note.split('/').at(-1) })
    .click()
  await page.locator('.tiptap').filter({ hasText: 'FIXED-SPACES-NOTE' }).waitFor()
  await page.screenshot({ path: join(root, 'personal-restored.png') })
  pass('专项空间进入公司、双空间往返及完整重启恢复原笔记和业务')
  await close()
  await rename(oldCompany, oldCompany + '-relocated')
  await launch(profile)
  await clickFixed('我的公司')
  await page.getByRole('heading', { name: '找回原公司资料', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '选择公司资料', exact: true }).count(), 1)
  assert(await page.getByRole('button', { name: '选择公司资料', exact: true }).isDisabled())
  await assert.rejects(readFile(join(oldCompany, '.cclink-studio/project.json')))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, oldCompany + '-relocated')
  await page.getByRole('button', { name: '定位原目录／选择其他公司', exact: true }).click()
  await page.getByRole('button', { name: '使用这份公司资料', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  assert.equal((await fixed()).company.projectId, bindings.company.projectId)
  pass('原路径失效保留关联、拒绝空公司替代，定位原目录后接回同一身份')
  await clickFixed('我的空间')
  await page.getByRole('button', { name: '工作台', exact: true }).click()
  await page.getByRole('heading', { name: '我的空间', exact: true }).waitFor()
  await page.screenshot({ path: join(root, 'personal-home.png'), scale: 'css' })
  await page.getByRole('button', { name: /新建笔记/ }).click()
  await page.locator('.tiptap[contenteditable="true"]').first().fill('个人工作台新笔记 HOME-NOTE')
  await page.keyboard.press('Meta+s')
  const homeNotes = await page.evaluate(
    (path) => window.cclinkStudio.fs.readDir(path),
    join(personal, '笔记'),
  )
  await until(
    () => readFile(homeNotes[0].path, 'utf8'),
    (text) => text.includes('HOME-NOTE'),
    'Home note save',
  )
  await clickFixed('我的公司')
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  const layoutResults = []
  for (const width of [1440, 1200, 900]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800),
      width,
    )
    for (const theme of ['dark', 'light']) {
      await page.evaluate(async (theme) => {
        await window.cclinkStudio.settings.set({ theme })
        document.documentElement.setAttribute('data-theme', theme)
      }, theme)
      const geometry = await until(
        () =>
          page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            nav: document.querySelector('.activity-bar').getBoundingClientRect().width,
            sidebar: document.querySelector('.workspace-sidebar-shell').getBoundingClientRect()
              .width,
            fixed: [...document.querySelectorAll('.fixed-space-entries button')].map((e) => ({
              text: e.innerText,
              left: e.getBoundingClientRect().left,
              right: e.getBoundingClientRect().right,
            })),
            selected: document.querySelectorAll('.fixed-space-entries [aria-current="page"]')
              .length,
          })),
        (value) => value.width === width && value.sidebar < 1,
        'Layout did not settle',
      )
      assert(geometry.scroll <= width)
      assert.equal(geometry.nav, 140)
      assert.equal(geometry.selected, 1)
      assert(geometry.fixed.every((item) => item.left >= 0 && item.right <= width))
      layoutResults.push({ theme, ...geometry })
    }
  }
  await writeFile(join(root, 'layout.json'), JSON.stringify(layoutResults, null, 2))
  await page.screenshot({ path: join(root, 'company-900-light.png'), scale: 'css' })
  await page.getByRole('button', { name: '收起左侧导航与内容栏', exact: true }).click()
  await until(
    () => page.locator('.activity-bar').evaluate((e) => e.getBoundingClientRect().width),
    (value) => value === 48,
    'Collapsed nav',
  )
  await page.getByRole('button', { name: '展开左侧导航与内容栏', exact: true }).click()
  await page.locator('.activity-more summary').click()
  for (const name of ['视频创作', '硬件生产', 'CCLink 远程'])
    assert(await page.getByRole('button', { name, exact: true }).isVisible())
  await page.locator('.activity-more summary').click()
  pass('公司页内导航、六种窗口/主题组合、140/48px收放及更多工具可达')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960),
  )
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark')
  })
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(root, 'company-final.png'), scale: 'css' })
  await switchTo(project)
  const projectButton = page.locator(`.project-strip-item[data-project-path="${project}"]`)
  await projectButton.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /关闭项目/ }).click()
  await page
    .locator('.fixed-space-entries [aria-current="page"]')
    .filter({ hasText: '我的空间' })
    .waitFor()
  pass('关闭最后一个普通空间回到我的空间，固定入口仍保留')
  await page.getByRole('button', { name: '新建浏览器页', exact: true }).click()
  await page.getByRole('textbox', { name: '浏览器地址', exact: true }).fill(fixtureUrl)
  await page.getByRole('textbox', { name: '浏览器地址', exact: true }).press('Enter')
  let web = await until(
    async () =>
      app
        .context()
        .pages()
        .find((p) => p.url().startsWith(fixtureUrl)),
    Boolean,
    'Real embedded page missing',
  )
  const id = await until(
    async () =>
      page.evaluate(async () => {
        const bindings = await window.cclinkStudio.workspaceState.getFixedSpaces()
        return window.cclinkStudio.browser.getActiveViewId(bindings.personal.workspacePath)
      }),
    Boolean,
    'Browser id missing',
  )
  async function measure(label) {
    const evidence = await until(
      async () => ({
        diagnostic: await page.evaluate(
          (id) => window.cclinkStudio.browser.getRuntimeDiagnostics(id),
          id,
        ),
        actual: await web.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          visualScale: visualViewport.scale,
        })),
        pane: await page
          .locator('.workbench-content')
          .evaluate((e) => e.getBoundingClientRect().width),
      }),
      ({ diagnostic: d, actual: a, pane }) =>
        d?.fitWidth?.samples?.length >= 3 &&
        d.fitWidth.actualZoomFactor === 1 &&
        d.fitWidth.actualVisualScale === 1 &&
        Math.abs(a.visualScale - 1) < 0.001 &&
        Math.abs(d.layout.nativeBounds.width - a.viewport) <= 2 &&
        Math.abs(d.layout.rendererBounds.width - pane) <= 2,
      'Browser ' + label,
    )
    assert(evidence.diagnostic.fitWidth.rawFactor < 0.5)
    assert.equal(evidence.diagnostic.fitWidth.appliedFactor, 1)
    assert(!evidence.diagnostic.layout.overlapsProtectedTop)
    await writeFile(join(root, 'browser-' + label + '.json'), JSON.stringify(evidence, null, 2))
    return evidence
  }
  await measure('new-tab')
  await web.evaluate(() => history.pushState({}, '', '#in-page'))
  await measure('in-page')
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await measure('sidebar-open')
  await page.getByRole('button', { name: '收起左侧导航与内容栏', exact: true }).click()
  await measure('pane-wider')
  await page.evaluate((id) => window.cclinkStudio.browser.setZoom(id, 0.3), id)
  assert(
    Math.abs(
      (await page.evaluate((id) => window.cclinkStudio.browser.getRuntimeDiagnostics(id), id))
        .fitWidth.actualZoomFactor - 0.3,
    ) < 0.001,
  )
  await page.evaluate((id) => window.cclinkStudio.browser.fitWidth(id), id)
  await measure('manual-30-restored')
  await page.evaluate((id) => window.cclinkStudio.browser.setZoom(id, 1), id)
  const diag = await page.evaluate(
    (id) => window.cclinkStudio.browser.getRuntimeDiagnostics(id),
    id,
  )
  await app.evaluate(async ({ webContents }, id) => {
    await webContents.fromId(id).setVisualZoomLevelLimits(0.1, 3)
  }, diag.webContentsId)
  const cdp = await web.context().newCDPSession(web)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.3 })
  assert(Math.abs((await web.evaluate(() => visualViewport.scale)) - 0.3) < 0.001)
  await web.locator('#draft').fill('preserve-no-reload')
  await page.evaluate((id) => window.cclinkStudio.browser.fitWidth(id), id)
  await measure('visual-30-restored')
  assert.equal(await web.locator('#draft').inputValue(), 'preserve-no-reload')
  await cdp.detach()
  await close()
  await launch(profile)
  web = await until(
    async () =>
      app
        .context()
        .pages()
        .find((p) => p.url().startsWith(fixtureUrl)),
    Boolean,
    'Restored embedded page missing',
  )
  await measure('restart')
  pass('真实WebContentsView：新页、页内导航、面板变宽、page/visual 30%恢复及重启均为100%')
  await close()
  const multi = await prepare('multiple')
  await launch(multi)
  const companyPaths = [join(multi.home, '已有公司甲'), join(multi.home, '已有公司乙')]
  for (const path of companyPaths) {
    await mkdir(path)
    await switchTo(path)
    const result = await page.evaluate(
      async (path) =>
        window.cclinkStudio.companyWorkspace.configure({
          workspaceRef: { kind: 'local', path },
          month: '2026-11',
          enabled: true,
          name: path.split('/').at(-1),
        }),
      path,
    )
    assert(result.success)
  }
  await clickFixed('我的空间')
  await clickFixed('我的公司')
  await page.locator('.fixed-space-dialog').getByText('已有公司甲', { exact: true }).waitFor()
  await page.locator('.fixed-space-dialog').getByText('已有公司乙', { exact: true }).waitFor()
  assert.equal(await page.locator('.fixed-space-candidates input:checked').count(), 0)
  assert(await page.getByRole('button', { name: '选择公司资料', exact: true }).isDisabled())
  await page.screenshot({ path: join(root, 'multiple-companies.png'), scale: 'css' })
  await page.getByLabel(/已有公司乙/).check()
  await page.getByRole('button', { name: '使用这份公司资料', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  const beforeSwitch = await fixed()
  await page.getByRole('button', { name: '关联设置', exact: true }).click()
  await page.getByLabel(/已有公司甲/).check()
  assert(await page.getByRole('button', { name: '使用这份公司资料', exact: true }).isDisabled())
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '使用这份公司资料', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  assert.equal((await fixed()).company.workspacePath, companyPaths[0])
  await page.locator(`.project-strip-item[data-project-path="${companyPaths[1]}"]`).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await page.getByRole('button', { name: '业务项目', exact: true }).click()
  assert.equal(
    await page.locator('.workspace-data-location').getAttribute('title'),
    companyPaths[1],
  )
  assert.equal((await fixed()).company.workspacePath, companyPaths[0])
  assert.equal(
    (await companySnapshot(companyPaths[1])).data.workspaceId,
    beforeSwitch.company.projectId,
  )
  pass('多公司不默认猜选，更换主公司需确认，旧公司历史Tab及页内导航保持原归属')

  // Binding can succeed while activation fails. Repairing the original state must make retry work.
  await clickFixed('我的公司')
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  const stateDir = join(companyPaths[1], '.cclink-studio/state')
  const originalStates = new Map()
  for (const file of await readdir(stateDir)) {
    if (!/\.json(?:\.bak)?$/.test(file)) continue
    originalStates.set(file, await readFile(join(stateDir, file)))
    await writeFile(join(stateDir, file), '{isolated-corrupted-state')
  }
  assert(originalStates.size > 0)
  await page.getByRole('button', { name: '关联设置', exact: true }).click()
  await page.getByLabel(/已有公司乙/).check()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '使用这份公司资料', exact: true }).click()
  await page.locator('.fixed-space-dialog [role="alert"]').waitFor()
  await page.getByRole('button', { name: '重试进入公司', exact: true }).waitFor()
  await page.screenshot({ path: join(root, 'activation-failed.png'), scale: 'css' })
  assert.equal((await fixed()).company.workspacePath, companyPaths[1])
  assert.equal(
    await page.locator('.workspace-data-location').getAttribute('title'),
    companyPaths[0],
  )
  for (const [file, bytes] of originalStates) await writeFile(join(stateDir, file), bytes)
  await page.locator('.fixed-space-dialog footer .primary').click()
  await page.locator('.fixed-space-dialog').waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  assert.equal(
    await page.locator('.workspace-data-location').getAttribute('title'),
    companyPaths[1],
  )
  await page.screenshot({ path: join(root, 'activation-retried.png'), scale: 'css' })
  pass('关联保存后进入失败保留原现场，修复原状态后可直接重试进入')

  // A restored company tab must never mistake a lost bound database for a new company.
  const boundDatabase = join(companyPaths[1], '.cclink-studio/company-workspace/company.sqlite')
  await close()
  const boundDatabaseBefore = await readFile(boundDatabase)
  await rename(boundDatabase, boundDatabase + '.saved')
  await launch(multi)
  await page.getByRole('alert').filter({ hasText: '原公司数据库不可用' }).waitFor()
  assert.equal(await page.getByText('正在读取公司资料…', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '开始使用', exact: true }).count(), 0)
  const blocked = await page.evaluate(async (path) => {
    const configure = await window.cclinkStudio.companyWorkspace.configure({
      workspaceRef: { kind: 'local', path },
      month: '2026-11',
      enabled: true,
      name: '禁止空公司',
    })
    let connectRejected = false
    try {
      await window.cclinkStudio.workspaceState.connectCompanySpace({
        workspacePath: path,
        initializeName: '禁止空公司',
      })
    } catch {
      connectRejected = true
    }
    return { configure, connectRejected }
  }, companyPaths[1])
  assert.equal(blocked.configure.success, false)
  assert.equal(blocked.connectRejected, true)
  await assert.rejects(readFile(boundDatabase))
  assert.deepEqual(await readFile(boundDatabase + '.saved'), boundDatabaseBefore)
  await page.screenshot({ path: join(root, 'missing-company-database.png'), scale: 'css' })
  await clickFixed('我的公司')
  await page.getByRole('heading', { name: '找回原公司资料', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '在原目录启用公司', exact: true }).count(), 0)
  await page.getByRole('button', { name: '返回我的空间', exact: true }).click()
  await page.locator('.fixed-space-dialog').waitFor({ state: 'hidden' })
  assert.equal(
    await page.locator('.fixed-space-entries [aria-current="page"]').innerText(),
    '我的空间',
  )
  await close()
  await rename(boundDatabase + '.saved', boundDatabase)
  await launch(multi)
  await clickFixed('我的公司')
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  assert.deepEqual(await readFile(boundDatabase), boundDatabaseBefore)
  pass('重启恢复的公司库缺失时读写与接回均拒绝建空库，个人仍可用，恢复原库即可继续')
  assert.deepEqual(pageErrors, [])
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await close()
  await new Promise((resolve) => fixture.close(resolve))
  await writeFile(
    join(root, 'results.json'),
    JSON.stringify({ results, pageErrors, build }, null, 2),
  )
  console.log(`Evidence: ${root}`)
}
