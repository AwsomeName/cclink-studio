#!/usr/bin/env node
// Real Electron UI and IPC. Every profile, workspace and write stays in an isolated test home.
// Build first; CCLINK_COMPANY_ENTRY_BUILD_ROOT can select an isolated electron-vite outDir.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const build = resolve(repository, process.env.CCLINK_COMPANY_ENTRY_BUILD_ROOT || 'out')
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-company-entry-smoke-')))
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

try {
  const fresh = await prepare('fresh')
  await launch(fresh)
  await page.locator('.status-bar-workspace').filter({ hasText: '默认工作空间' }).waitFor()
  await company()
  await page.getByRole('heading', { name: '启用公司视图', exact: true }).waitFor()
  assert.equal(
    await page.locator('.workspace-data-location').getAttribute('title'),
    fresh.defaultPath,
  )
  pass('首次启动无需选目录，直接进入默认空间的公司启用页')
  await close()

  const profile = await prepare('unfiled', { startupWorkspaceTarget: 'unfiled' })
  await launch(profile)
  await page.locator('.status-bar-workspace[title="未归档"]').waitFor()
  await assert.rejects(readFile(join(profile.defaultPath, '.cclink-studio/project.json')))
  await company()
  await page.getByRole('heading', { name: '启用公司视图', exact: true }).waitFor()
  assert.equal(
    await page.locator('.workspace-data-location').getAttribute('title'),
    profile.defaultPath,
  )
  const manifest = await readFile(join(profile.defaultPath, '.cclink-studio/project.json'), 'utf8')
  await page.getByLabel('公司显示名称').fill('默认入口验收公司')
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await page.getByRole('button', { name: '创建业务项目', exact: true }).click()
  await page.getByLabel('业务项目名称').fill('重启保留的经营业务')
  await page.getByLabel('目标', { exact: true }).fill('不选项目也能进入公司')
  await page.getByLabel('交付条件').fill('默认公司与业务在重启后仍可见')
  await page.getByRole('button', { name: '创建并打开业务', exact: true }).click()
  await page.getByRole('heading', { name: '重启保留的经营业务', exact: true }).waitFor()
  const original = await companySnapshot(profile.defaultPath)
  assert(original.success && original.data.projects.length === 1)
  pass('未归档点击公司经营，自动建立并激活默认空间，可启用公司并创建业务')

  await unfiled()
  await company()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await page
    .getByRole('button', { name: /重启保留的经营业务/ })
    .first()
    .waitFor()
  assert.equal(
    await readFile(join(profile.defaultPath, '.cclink-studio/project.json'), 'utf8'),
    manifest,
  )
  const reused = await companySnapshot(profile.defaultPath)
  assert(reused.success)
  assert.deepEqual(reused.data.projects, original.data.projects)
  pass('再次从未归档进入同一默认公司，身份和原业务保留')
  await close()

  await launch(profile)
  await page.locator('.status-bar-workspace').filter({ hasText: '默认工作空间' }).waitFor()
  await company()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  const restarted = await companySnapshot(profile.defaultPath)
  assert(restarted.success)
  assert.deepEqual(restarted.data.projects, original.data.projects)
  assert.equal(restarted.data.name, '默认入口验收公司')
  await page.screenshot({ path: join(root, 'company-restored.png') })
  pass('完整退出重启自动恢复默认空间，原公司和业务继续可见')

  const other = join(profile.home, '其他资料空间')
  await mkdir(other)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, other)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await page.locator('.status-bar-workspace').filter({ hasText: '其他资料空间' }).waitFor()
  await company()
  await page.getByRole('heading', { name: '启用公司视图', exact: true }).waitFor()
  assert.equal(await page.locator('.workspace-data-location').getAttribute('title'), other)
  pass('已有本地空间仍打开自己的公司页面，不被默认空间替换')

  await unfiled()
  await company()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await close()
  const moved = join(profile.home, '保留原公司目录')
  await rename(profile.defaultPath, moved)
  await launch(profile)
  await page.locator('.workspace-recovery-notice').waitFor()
  await company()
  await page.locator('.toast-error').filter({ hasText: '不会新建空目录' }).waitFor()
  await assert.rejects(readFile(join(profile.defaultPath, '.cclink-studio/project.json')))
  assert.equal(await readFile(join(moved, '.cclink-studio/project.json'), 'utf8'), manifest)
  assert.equal(await page.locator('.company-workbench').count(), 0)
  await page.screenshot({ path: join(root, 'missing-default.png') })
  pass('登记默认目录丢失时显示恢复原因，点击公司不会新建空目录冒充原公司')
  assert.deepEqual(pageErrors, [])
} catch (error) {
  if (page && !page.isClosed())
    await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (app) await close()
  await writeFile(
    join(root, 'results.json'),
    JSON.stringify({ results, pageErrors, build }, null, 2),
  )
  console.log(`Evidence: ${root}`)
}
