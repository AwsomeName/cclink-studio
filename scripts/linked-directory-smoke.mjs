#!/usr/bin/env node
// Real built Studio + isolated profile. Only the native permission response is automated.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rename, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { _electron } from 'playwright-core'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
// WorkspaceState accepts local workspaces under the user's home, unlike OS temp directories.
const fixture = await realpath(await mkdtemp(join(homedir(), '.cclink-linked-directory-smoke-')))
const workspace = join(fixture, 'workspace')
const outside = join(fixture, 'notes')
const profile = join(fixture, 'profile')
const link = join(workspace, '研发日记')
await Promise.all([mkdir(workspace), mkdir(outside), mkdir(profile)])
await writeFile(join(outside, 'linked-note.md'), '# Original linked note\n')
await symlink(outside, link)
await symlink(join(fixture, 'missing'), join(workspace, 'broken-link'))
await symlink(workspace, join(workspace, 'cycle-link'))
await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
    componentSetupPageSeenVersion: 2,
  }),
)
await writeFile(
  join(profile, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: {
      fixture: {
        workspaceKey: workspace,
        workspacePath: workspace,
        ownerKey: null,
        updatedAt: Date.now(),
        storage: 'fallback',
        projectId: null,
      },
    },
  }),
)

let app
async function launch() {
  const env = { ...process.env, CCLINK_STUDIO_TEST_USER_DATA_PATH: profile }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  app = await _electron.launch({
    executablePath: require('electron'),
    args: [join(root, 'out/main/index.js')],
    env,
    timeout: 30000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30000 })
  await app.evaluate(({ dialog }, workspacePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspacePath] })
  }, workspace)
  await app.evaluate(({ dialog }) => {
    globalThis.linkSmokePrompts = []
    globalThis.linkSmokeResponse = 0
    dialog.showMessageBox = async (_owner, options) => {
      if (options.title !== '允许访问链接目录')
        throw new Error(`Unexpected dialog: ${options.title}`)
      globalThis.linkSmokePrompts.push(options)
      return { response: globalThis.linkSmokeResponse, checkboxChecked: false }
    }
  })
  if (!(await page.locator('.file-tree-item').filter({ hasText: '研发日记' }).count())) {
    await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
    await page.getByRole('button', { name: /本地文件夹/ }).click()
  }
  await page.locator('.file-tree-item').filter({ hasText: '研发日记' }).waitFor({ timeout: 30000 })
  return page
}

try {
  let page = await launch()
  let row = page.locator('.file-tree-item').filter({ hasText: '研发日记' })
  assert.equal(await row.getAttribute('aria-expanded'), 'false')
  assert.equal(await row.locator('[aria-label="符号链接"]').count(), 1)
  await row.click()
  await page.waitForTimeout(300)
  assert.equal(await row.getAttribute('aria-expanded'), 'false')
  assert.equal(await app.evaluate(() => globalThis.linkSmokePrompts.length), 1)
  console.log('PASS directory classification and cancel without expansion')

  await app.evaluate(() => {
    globalThis.linkSmokeResponse = 1
  })
  await row.click()
  const note = page.locator('.file-tree-item').filter({ hasText: 'linked-note.md' })
  await note.waitFor()
  const prompts = await app.evaluate(() => globalThis.linkSmokePrompts)
  assert.ok(prompts[1].detail.includes(outside))
  assert.ok(prompts[1].detail.includes('修改会作用于原目录'))
  await note.click()
  const editor = page.locator('.tiptap[contenteditable="true"]')
  await editor.waitFor()
  assert.ok((await editor.innerText()).includes('Original linked note'))
  await editor.fill('Edited through linked directory')
  await editor.press('Meta+s')
  await page.waitForFunction(
    async (filePath) => {
      const value = await window.cclinkStudio.fs.readTextDocument(filePath)
      return value.content.includes('Edited through linked directory')
    },
    join(link, 'linked-note.md'),
  )
  assert.match(
    await readFile(join(outside, 'linked-note.md'), 'utf8'),
    /Edited through linked directory/,
  )
  await page.screenshot({ path: join(fixture, 'linked-directory-edit.png') })
  console.log('PASS real file-tree click, editor load and keyboard save to original target')
  await app.close()
  app = null

  page = await launch()
  row = page.locator('.file-tree-item').filter({ hasText: '研发日记' })
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click()
  await page.locator('.file-tree-item').filter({ hasText: 'linked-note.md' }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.linkSmokePrompts.length), 0)
  assert.ok((await page.locator('body').innerText()).includes('链接目标不存在'))
  assert.ok((await page.locator('body').innerText()).includes('链接循环或目标不可访问'))
  console.log('PASS restart retains authorization; broken and cyclic links show inline reasons')

  const other = join(fixture, 'other')
  await mkdir(other)
  await writeFile(join(other, 'secret.txt'), 'unchanged')
  await rename(link, `${link}-old`)
  await symlink(other, link)
  const denied = await page.evaluate(
    async (path) => {
      try {
        await window.cclinkStudio.fs.writeFile(path, 'must not write')
        return false
      } catch {
        return true
      }
    },
    join(link, 'secret.txt'),
  )
  assert.ok(denied)
  assert.equal(await readFile(join(other, 'secret.txt'), 'utf8'), 'unchanged')
  await page.evaluate(
    async ({ workspace, link }) => {
      await window.cclinkStudio.fs.trashPath({ workspacePath: workspace, targetPath: link })
    },
    { workspace, link },
  )
  assert.equal(await readFile(join(other, 'secret.txt'), 'utf8'), 'unchanged')
  console.log('PASS changed target rejected and native Trash removes only link')
  console.log(`Evidence: ${fixture}`)
} finally {
  await app?.close()
}
