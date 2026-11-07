#!/usr/bin/env node
// Real Electron, isolated files/profile, actual permission failures; no model or account required.
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-markdown-autosave-smoke-')))
const workspace = join(root, 'workspace-a')
const otherWorkspace = join(root, 'workspace-b')
const profile = join(root, 'user-data')
const evidence =
  process.env.CCLINK_AUTOSAVE_EVIDENCE_DIR || '/tmp/cclink-markdown-autosave-evidence'
await Promise.all(
  [workspace, otherWorkspace, profile, evidence].map((path) => mkdir(path, { recursive: true })),
)
await writeFile(join(workspace, 'auto.md'), 'INITIAL_MARKDOWN\n')
await writeFile(join(workspace, 'other.md'), 'SECOND-DOCUMENT\n')
await writeFile(join(workspace, 'page.html'), '<p>ORIGINAL_HTML</p>\n')
await writeFile(join(otherWorkspace, 'other-workspace.md'), 'WORKSPACE_B\n')
await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({
    componentSetupPageSeenVersion: 2,
    startupWorkspaceTarget: 'resume',
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace, otherWorkspace],
    markdownAutoSave: true,
  }),
)
await writeFile(
  join(profile, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: Object.fromEntries(
      [workspace, otherWorkspace].map((path) => [
        path,
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
let app
let page
const results = []
const pass = (name) => {
  results.push(name)
  console.log(`PASS ${name}`)
}
async function waitFor(check, label, timeout = 15_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}`)
}
async function launch() {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [join(repository, 'out/main/index.js')],
    cwd: repository,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: process.env.CCLINK_AUTOSAVE_RENDERER_URL || '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
    timeout: 30_000,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  await page.waitForSelector('.main-window')
}
async function openFile(name) {
  const tab = page.locator('.tab-title').getByText(name, { exact: true })
  if (await tab.count()) await tab.first().click()
  else {
    const item = page.locator('.file-tree-name').getByText(name, { exact: true })
    if (!(await item.isVisible()))
      await page.getByRole('button', { name: '文件', exact: true }).click()
    await item.click()
  }
  await page.waitForSelector('.markdown-editor-wrapper, .source-text-editor')
}
const editor = () => page.locator('.tiptap[contenteditable="true"]')
async function setAutoSave(enabled) {
  await page.locator('[title="设置"]').first().click()
  await page.getByText('编辑器', { exact: true }).first().click()
  const toggle = page
    .locator('.settings-row')
    .filter({ hasText: 'Markdown 自动保存' })
    .getByRole('switch')
  if ((await toggle.getAttribute('aria-checked')) !== String(enabled)) await toggle.click()
  await waitFor(
    async () =>
      (await page.evaluate(() => window.cclinkStudio.settings.getAll())).markdownAutoSave ===
      enabled,
    'autosave setting',
  )
  await page
    .locator('.tab')
    .filter({ has: page.locator('.tab-title', { hasText: 'auto.md' }) })
    .click()
  await editor().waitFor()
}
async function requestSwitch() {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, otherWorkspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
}
async function directories(path) {
  const found = [path]
  for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) found.push(...(await directories(join(path, entry.name))))
  }
  return found
}
let blockedDirectories = []
async function restorePermissions() {
  await chmod(workspace, 0o700)
  await chmod(profile, 0o700)
  for (const path of blockedDirectories) await chmod(path, 0o700).catch(() => {})
  blockedDirectories = []
}
try {
  await launch()
  await openFile('auto.md')
  const editorBeforeSave = await editor().boundingBox()
  const saveControlBeforeSave = await page.locator('.toolbar-save-control').boundingBox()
  await editor().fill('AUTO-SAVE-FIRST')
  await page.getByRole('button', { name: '等待自动保存', exact: true }).waitFor()
  assert.equal(
    await page.locator('.markdown-editor-wrapper > .editor-persistence-status').count(),
    0,
  )
  assert.equal((await editor().boundingBox()).y, editorBeforeSave.y)
  await page.screenshot({ path: join(evidence, 'autosave-pending.png') })
  await waitFor(
    async () => (await readFile(join(workspace, 'auto.md'), 'utf8')).includes('AUTO-SAVE-FIRST'),
    'automatic disk write',
  )
  await page.locator('.toolbar-save-state').getByText('已保存', { exact: true }).waitFor()
  assert.equal((await editor().boundingBox()).y, editorBeforeSave.y)
  assert.deepEqual(await page.locator('.toolbar-save-control').boundingBox(), saveControlBeforeSave)
  await page.screenshot({ path: join(evidence, 'autosave-saved.png') })
  pass('A1 编辑后无需快捷键，1.5 秒自动落盘并显示已保存')
  pass('A1 UI 等待与已保存共用右上角固定区域，正文不发生上下位移')

  await editor().fill('AUTO-SAVE-AFTER-TAB-SWITCH')
  await openFile('other.md')
  await waitFor(
    async () =>
      (await readFile(join(workspace, 'auto.md'), 'utf8')).includes('AUTO-SAVE-AFTER-TAB-SWITCH'),
    'inactive tab write',
  )
  assert((await editor().innerText()).includes('SECOND-DOCUMENT'))
  await page
    .locator('.tab')
    .filter({ has: page.locator('.tab-title', { hasText: 'auto.md' }) })
    .locator('.tab-dirty-dot')
    .waitFor({ state: 'hidden' })
  pass('A2 切换其他 Tab 后仍保存原 Markdown，不抢焦点')

  await page
    .locator('.file-tree-name')
    .getByText('page.html', { exact: true })
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: /以文本打开/ }).click()
  await page.locator('.source-text-area').waitFor()
  await page.locator('.source-text-area').fill('<p>HTML_UNSAVED</p>')
  await page.waitForTimeout(1800)
  assert((await readFile(join(workspace, 'page.html'), 'utf8')).includes('ORIGINAL_HTML'))
  pass('A3 HTML 保持显式保存，自动保存范围未扩大')

  await openFile('auto.md')
  await setAutoSave(false)
  await editor().fill('MANUAL-SAVE-MODE')
  await page.waitForTimeout(1800)
  assert(!(await readFile(join(workspace, 'auto.md'), 'utf8')).includes('MANUAL-SAVE-MODE'))
  await editor().press('Meta+s')
  await waitFor(
    async () => (await readFile(join(workspace, 'auto.md'), 'utf8')).includes('MANUAL-SAVE-MODE'),
    'manual save',
  )
  pass('A4 设置可关闭自动保存，Cmd+S 仍立即保存')

  await setAutoSave(true)
  await editor().fill('KEEP-LOCAL-CONFLICT')
  await writeFile(join(workspace, 'auto.md'), 'KEEP-EXTERNAL-CONFLICT\n')
  await page.locator('.markdown-conflict-banner').waitFor()
  await page.waitForTimeout(1800)
  assert((await readFile(join(workspace, 'auto.md'), 'utf8')).includes('KEEP-EXTERNAL-CONFLICT'))
  assert((await editor().innerText()).includes('KEEP-LOCAL-CONFLICT'))
  await page.screenshot({ path: join(evidence, 'conflict.png') })
  await page
    .locator('.markdown-conflict-banner')
    .getByRole('button', { name: /重新载入/ })
    .click()
  pass('A5 外部冲突暂停自动保存，磁盘与编辑草稿均保留')

  await chmod(workspace, 0o500)
  await editor().fill('KEEP-WRITE-FAILURE')
  const retrySave = page.getByRole('button', { name: '重试保存', exact: true })
  await retrySave.waitFor()
  assert((await retrySave.getAttribute('title')).includes('文件保存失败：'))
  assert((await editor().innerText()).includes('KEEP-WRITE-FAILURE'))
  await page.screenshot({ path: join(evidence, 'file-save-failure.png') })
  await chmod(workspace, 0o700)
  await retrySave.click()
  await waitFor(
    async () => (await readFile(join(workspace, 'auto.md'), 'utf8')).includes('KEEP-WRITE-FAILURE'),
    'retry file write',
  )
  pass('A6 真实目录只读时显示失败，恢复权限后原内容可重试保存')

  await setAutoSave(false)
  blockedDirectories = await directories(join(workspace, '.cclink-studio'))
  for (const path of [...blockedDirectories].reverse()) await chmod(path, 0o500)
  await chmod(profile, 0o500)
  await editor().fill('KEEP-DRAFT-FAILURE')
  await page.locator('.editor-draft-failure').waitFor()
  await page.screenshot({ path: join(evidence, 'draft-failure.png') })
  await requestSwitch()
  await page
    .getByText(/草稿未能保存，已保留当前工作空间/)
    .first()
    .waitFor()
  await page.getByRole('button', { name: '关闭打开工作空间', exact: true }).click()
  assert((await editor().innerText()).includes('KEEP-DRAFT-FAILURE'))
  pass('A7 草稿主存储与 fallback 均不可写时，工作空间切换被阻止且内容保留')

  await app.evaluate(({ dialog, BrowserWindow }) => {
    globalThis.__autosaveClosePrompts = []
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__autosaveClosePrompts.push(options)
      return { response: 0, checkboxChecked: false }
    }
    BrowserWindow.getAllWindows()
      .find((window) => !window.isDestroyed())
      .close()
  })
  await waitFor(
    () => app.evaluate(() => globalThis.__autosaveClosePrompts.length > 0),
    'close protection dialog',
  )
  assert(!page.isClosed())
  assert((await editor().innerText()).includes('KEEP-DRAFT-FAILURE'))
  const prompt = await app.evaluate(() => globalThis.__autosaveClosePrompts[0])
  assert(prompt.buttons.includes('重试保存'))
  pass('A8 关闭窗口收到保存失败时提供继续编辑／重试／明确放弃，选择继续后内容仍在')

  await restorePermissions()
  await page.getByRole('button', { name: '重试保留草稿', exact: true }).click()
  await page.locator('.editor-draft-failure').waitFor({ state: 'hidden' })
  await app.close()
  app = null
  await launch()
  await openFile('auto.md')
  assert((await editor().innerText()).includes('KEEP-DRAFT-FAILURE'))
  assert(!(await readFile(join(workspace, 'auto.md'), 'utf8')).includes('KEEP-DRAFT-FAILURE'))
  pass('A9 草稿重试成功后退出并重启，恢复未保存正文且不谎报原文件已保存')
  await requestSwitch()
  await page
    .getByRole('button', { name: '关闭打开工作空间', exact: true })
    .waitFor({ state: 'hidden' })
  if (
    !(await page
      .locator('.file-tree-name')
      .getByText('other-workspace.md', { exact: true })
      .isVisible())
  )
    await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.locator('.file-tree-name').getByText('other-workspace.md', { exact: true }).waitFor()
  pass('A10 修复草稿存储后，工作空间切换可正常继续')
  await openFile('other-workspace.md')
  await page.locator('[title="定时任务"]').first().click()
  await page.locator('[aria-label="新建定时任务"]').click()
  await page.getByLabel('任务内容', { exact: true }).fill('UNSAVED-TASK-ASSESSMENT')
  const taskTabTitle = await page.locator('.tab.active .tab-title').innerText()
  await page.screenshot({ path: join(evidence, 'task-before-tab-switch.png') })
  await page.locator('.tab-title').getByText('other-workspace.md', { exact: true }).click()
  await page.locator('.tab-title').getByText(taskTabTitle, { exact: true }).click()
  const taskDraftPreserved = (
    await page.getByLabel('任务内容', { exact: true }).inputValue()
  ).includes('UNSAVED-TASK-ASSESSMENT')
  await page.screenshot({ path: join(evidence, 'task-after-tab-switch.png') })
  results.push({ assessment: 'scheduled-task draft across Tab switch', taskDraftPreserved })
  console.log('ASSESSMENT scheduled task draft preserved:', taskDraftPreserved)
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify({ results, verifiedAt: new Date().toISOString() }, null, 2),
  )
} catch (error) {
  console.error('Disk auto.md:', await readFile(join(workspace, 'auto.md'), 'utf8'))
  if (page && !page.isClosed())
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await restorePermissions()
  if (app) await app.close()
  await rm(root, { recursive: true, force: true })
}
