#!/usr/bin/env node
// Negative and legacy-data cases in real Electron, without a model or external operations.
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-default-edge-smoke-')))
const home = join(root, 'home')
const parent = join(home, 'CCLink Studio')
const target = join(parent, '默认工作空间')
const evidence = join(repository, 'docs/testing/default-workspace-first-batch')
await Promise.all(
  [parent, evidence, join(root, 'documents')].map((p) => mkdir(p, { recursive: true })),
)
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const { app } = require('electron');
app.setPath('home', ${JSON.stringify(home)});
app.setPath('documents', ${JSON.stringify(join(root, 'documents'))});
app.setAppPath(${JSON.stringify(repository)});
require(${JSON.stringify(join(repository, 'out/main/index.js'))});`,
)
const results = []
let app
let page
const pass = (name) => {
  results.push({ name, status: 'pass' })
  console.log('PASS ' + name)
}
async function launch(name, settings = {}) {
  const profile = join(root, name)
  await mkdir(profile)
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({ componentSetupPageSeenVersion: 2, ...settings }),
  )
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
  return profile
}
async function close() {
  await app.close()
  app = null
}
try {
  await mkdir(target)
  await writeFile(join(target, 'existing.md'), 'KEEP-EXISTING-DATA')
  await launch('conflict')
  await page.getByRole('alert').filter({ hasText: '默认目录已被占用' }).waitFor()
  assert.equal(await readFile(join(target, 'existing.md'), 'utf8'), 'KEEP-EXISTING-DATA')
  await assert.rejects(readFile(join(target, '.cclink-studio/project.json')))
  await page.getByRole('button', { name: '定位或选择工作空间', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  pass('A04 已有占用目录保持原件，真实 App 显示冲突与恢复入口')
  await close()
  await rm(target, { recursive: true })

  await chmod(parent, 0o500)
  await launch('readonly')
  await page.getByRole('alert').waitFor()
  assert((await page.getByRole('alert').innerText()).includes('EACCES'))
  await assert.rejects(readFile(join(target, '.cclink-studio/project.json')))
  await page.screenshot({ path: join(evidence, 'readonly-default.png') })
  pass('A05 默认创建遇到真实只读父目录时明确降级，App 与选择器可继续使用')
  await close()
  await chmod(parent, 0o700)

  const legacy = join(home, 'legacy-workspace')
  await mkdir(legacy)
  await writeFile(join(legacy, 'old.md'), '# KEEP-LEGACY-WORKSPACE\n')
  await launch('legacy', { lastWorkspacePath: legacy, recentWorkspacePaths: [legacy] })
  const settings = await page.evaluate(() => window.cclinkStudio.settings.getAll())
  assert.equal(settings.startupWorkspaceTarget, 'resume')
  assert.equal(settings.lastWorkspacePath, legacy)
  assert.equal(settings.defaultWorkspacePath, '')
  assert.equal(await readFile(join(legacy, 'old.md'), 'utf8'), '# KEEP-LEGACY-WORKSPACE\n')
  await assert.rejects(readFile(join(target, '.cclink-studio/project.json')))
  pass('A02 旧配置没有新增字段时仍恢复旧空间，不创建或迁入默认目录')
  await close()

  const profile = join(root, 'global')
  await mkdir(profile)
  const globalState = {
    version: 1,
    workspaceId: 'global',
    ownerKey: null,
    workspaceKey: null,
    workspacePath: null,
    updatedAt: 1,
    sections: {
      editorDrafts: {
        files: {
          'draft:legacy': {
            currentContent: 'KEEP-UNFILED-DRAFT',
            savedContent: '',
            dirty: true,
            isUntitled: true,
            draftTitle: '未归档旧稿.md',
          },
        },
      },
    },
  }
  await writeFile(
    join(profile, 'workspace-state.json'),
    JSON.stringify({ version: 2, localWorkspaces: {}, workspaces: { global: globalState } }),
  )
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({ componentSetupPageSeenVersion: 2 }),
  )
  app = await _electron.launch({
    executablePath: electronPath,
    args: [launcher],
    cwd: repository,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
    },
    timeout: 30000,
  })
  page = await app.firstWindow()
  await page.waitForSelector('.main-window')
  const state = await page.evaluate(() => window.cclinkStudio.workspaceState.get(null, null))
  assert.deepEqual(state.sections.editorDrafts, globalState.sections.editorDrafts)
  const initialized = await page.evaluate(() =>
    Promise.all([
      window.cclinkStudio.workspaceState.ensureDefaultWorkspace(),
      window.cclinkStudio.workspaceState.ensureDefaultWorkspace(),
    ]),
  )
  assert(initialized.every((result) => result.success && result.workspacePath === target))
  assert.deepEqual(
    (await page.evaluate(() => window.cclinkStudio.workspaceState.get(null, null))).sections
      .editorDrafts,
    globalState.sections.editorDrafts,
  )
  pass('A03/A06 真实 IPC 并发初始化同一空间，原 global 草稿保持原归属及内容')

  const publication = await page.evaluate(async (path) => {
    const workspaceRef = { kind: 'local', path }
    const scope = { workspaceRef, month: '2026-09' }
    const check = (result) => {
      if (!result.success) throw new Error(result.error.message)
      return result.data
    }
    const markdownPath = `${path}/已有运营稿.md`
    await window.cclinkStudio.fs.saveTextDocument({
      filePath: markdownPath,
      content: '# 运营事务保存验收\n\n只保存配置与关联，不执行公开发布。\n',
    })
    check(
      await window.cclinkStudio.companyWorkspace.configure({
        ...scope,
        enabled: true,
        name: '运营配置验收公司',
      }),
    )
    const company = check(
      await window.cclinkStudio.companyWorkspace.createBusiness({
        ...scope,
        name: '运营配置验收业务',
        goal: '恢复同一发布草稿',
        deliverable: '原事务及关联可打开',
        dueDate: null,
        ledgerProjectId: null,
      }),
    )
    const account = check(
      await window.cclinkStudio.webResources.createConnection({
        workspaceRef,
        websiteName: 'CSDN 验收入口',
        entryUrl: 'https://blog.csdn.net/',
        principalKind: 'company',
        principalName: '验收主体',
        accountLabel: '未登录验收账号',
      }),
    )
    const affair = check(
      await window.cclinkStudio.articlePublishing.createTask({
        workspaceRef,
        markdownPath,
        accountId: account.account.id,
        fields: { title: '运营事务保存验收', summary: '仅保存验收配置', tags: [], category: '' },
      }),
    )
    check(
      await window.cclinkStudio.companyWorkspace.linkResource({
        ...scope,
        businessId: company.projects[0].id,
        kind: 'publishing',
        target: affair.id,
      }),
    )
    return { id: affair.id, accountId: account.account.id }
  }, target)
  const other = join(home, 'other-operations')
  await mkdir(other)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, other)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await page
    .getByRole('button', { name: '关闭打开工作空间', exact: true })
    .waitFor({ state: 'hidden' })
  const otherAffairs = await page.evaluate(
    (path) => window.cclinkStudio.webAffairs.getSnapshot({ workspaceRef: { kind: 'local', path } }),
    other,
  )
  assert(otherAffairs.success && otherAffairs.data.affairs.length === 0)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.locator('.workspace-open-source-card').filter({ hasText: '默认工作空间' }).click()
  await page
    .getByRole('button', { name: '关闭打开工作空间', exact: true })
    .waitFor({ state: 'hidden' })
  await close()
  app = await _electron.launch({
    executablePath: electronPath,
    args: [launcher],
    cwd: repository,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
    },
    timeout: 30000,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.waitForSelector('.main-window')
  const restored = await page.evaluate(
    async (path) => ({
      affairs: await window.cclinkStudio.webAffairs.getSnapshot({
        workspaceRef: { kind: 'local', path },
      }),
      company: await window.cclinkStudio.companyWorkspace.getSnapshot({
        workspaceRef: { kind: 'local', path },
        month: '2026-09',
      }),
    }),
    target,
  )
  assert(restored.affairs.success && restored.company.success)
  const affair = restored.affairs.data.affairs.find((item) => item.id === publication.id)
  assert(affair && affair.articlePublishing.accountId === publication.accountId)
  assert.equal(affair.articlePublishing.publication.status, 'not-started')
  assert.equal(affair.attempts.length, 0)
  assert(
    restored.company.data.links.some(
      (link) => link.kind === 'publishing' && link.target === publication.id,
    ),
  )
  await page.getByRole('button', { name: '公司经营', exact: true }).click()
  await page.getByRole('button', { name: '运营配置验收业务', exact: true }).click()
  await page.getByRole('button', { name: '打开原记录', exact: true }).click()
  await page.getByRole('heading', { name: '运营事务保存验收', exact: true }).waitFor()
  await page.screenshot({ path: join(evidence, 'restored-publication-draft.png') })
  pass('B01/B04 运营发布草稿及公司关联切换重启后仍为同一事务，未产生执行或提交')
} catch (error) {
  results.push({ name: 'failure', status: 'fail', message: error.message })
  throw error
} finally {
  if (app) await close()
  await chmod(parent, 0o700).catch(() => {})
  await writeFile(
    join(evidence, 'edge-result.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
  )
  await rm(root, { recursive: true, force: true })
}
