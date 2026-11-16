#!/usr/bin/env node
// Run after pnpm build. All history and deletions use an isolated test profile.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const root = await realpath(await mkdtemp(join(tmpdir(), 'studio-local-delete-')))
const profile = join(root, 'profile')
const home = join(root, 'home')
const documents = join(root, 'documents')
await Promise.all([profile, home, documents].map((path) => mkdir(path)))
const workspace = join(home, 'project')
await mkdir(workspace)
await writeFile(
  join(profile, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: {
      [workspace]: {
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
await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({
    startupWorkspaceTarget: 'resume',
    lastWorkspacePath: workspace,
    componentSetupPageSeenVersion: 2,
    claudeRuntimeSource: 'system',
  }),
)
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron');
app.setPath('home',${JSON.stringify(home)});
app.setPath('documents',${JSON.stringify(documents)});
app.setAppPath(${JSON.stringify(repository)});
require(${JSON.stringify(join(repository, 'out/main/index.js'))});`,
)

async function launch() {
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [launcher],
    cwd: repository,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
    },
    timeout: 30000,
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.waitForSelector('.main-window')
  if (!(await page.locator('.session-sidebar-row').first().isVisible())) {
    await page.getByRole('button', { name: '会话', exact: true }).click()
  }
  await page.locator('.session-sidebar-row').first().waitFor()
  return { app, page }
}

async function snapshot(page) {
  return page.evaluate(async (workspace) => {
    const identity = await window.cclinkStudio.identity.getLocalIdentity()
    const state = await window.cclinkStudio.workspaceState.get(
      workspace,
      `local:${identity.localId}`,
    )
    return state.sections.agentConversations
  }, workspace)
}

let { app, page } = await launch()
try {
  await page.evaluate(async (workspace) => {
    const identity = await window.cclinkStudio.identity.getLocalIdentity()
    const owner = `local:${identity.localId}`
    const state = await window.cclinkStudio.workspaceState.get(workspace, owner)
    const globalState = await window.cclinkStudio.workspaceState.get(null, owner)
    const value = state.sections.agentConversations ?? globalState.sections.agentConversations
    for (const conversation of Object.values(value.conversations)) {
      conversation.runtime = {
        ...conversation.runtime,
        workspaceRef: { kind: 'local', path: workspace },
      }
    }
    const template = value.conversations[value.conversationOrder[0]]
    for (const id of ['delete-a', 'delete-b', 'keep-c']) {
      value.conversations[id] = { ...template, id, title: id, archivedAt: 1, createdAt: 1 }
      value.conversationOrder.push(id)
    }
    const result = await window.cclinkStudio.workspaceState.setSection(
      workspace,
      'agentConversations',
      value,
      owner,
    )
    if (!result.success) throw new Error(result.error)
  }, workspace)
} finally {
  await app.close()
}

;({ app, page } = await launch())
try {
  await page.getByTitle('展开已关闭').click()
  const row = (id) => page.locator(`.session-sidebar-row[data-conversation-id="${id}"]`).first()
  await row('delete-a').hover()
  page.once('dialog', (dialog) => dialog.dismiss())
  await row('delete-a').getByTitle('删除本地会话历史', { exact: true }).click()
  assert.equal(await row('delete-a').count(), 1, 'Cancel must keep history')
  for (const id of ['delete-a', 'delete-b']) {
    await row(id).hover()
    page.once('dialog', (dialog) => dialog.accept())
    await row(id).getByTitle('删除本地会话历史', { exact: true }).click()
    await row(id).waitFor({ state: 'detached' })
    await page.getByText('会话已删除', { exact: true }).waitFor()
  }
  const saved = await snapshot(page)
  assert.ok(!saved.conversations['delete-a'])
  assert.ok(!saved.conversations['delete-b'])
  assert.ok(saved.conversations['keep-c'])
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('workspaceState:setSection')
    ipcMain.removeHandler('workspaceState:setSection')
    ipcMain.handle('workspaceState:setSection', (event, ...args) => {
      if (args[4]?.conversationHistoryMutation?.conversationId === 'keep-c') {
        return { success: false, error: 'SMOKE: disk full', errorCode: 'workspace_flush_failed' }
      }
      return original(event, ...args)
    })
  })
  await row('keep-c').hover()
  page.once('dialog', (dialog) => dialog.accept())
  await row('keep-c').getByTitle('删除本地会话历史', { exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '删除会话失败：SMOKE: disk full' }).waitFor()
  await row('keep-c').waitFor()
  assert.ok((await snapshot(page)).conversations['keep-c'])
  await page.screenshot({ path: join(root, 'deleted.png') })
  console.log(
    'PASS cancel, confirmed deletion, persisted removal, failed deletion restores row and shows error',
  )
} finally {
  await app.close()
}

;({ app, page } = await launch())
try {
  await page.getByTitle('展开已关闭').click()
  assert.equal(await page.locator('[data-conversation-id="delete-a"]').count(), 0)
  assert.equal(await page.locator('[data-conversation-id="delete-b"]').count(), 0)
  await page.locator('[data-conversation-id="keep-c"]').first().waitFor()
  const saved = await snapshot(page)
  assert.ok(!saved.conversations['delete-a'])
  assert.ok(!saved.conversations['delete-b'])
  assert.ok(saved.conversations['keep-c'])
  await page.screenshot({ path: join(root, 'restarted.png') })
  console.log('PASS restart preserves deletion and unrelated history')
} finally {
  await app.close()
}
console.log(`Evidence: ${root}`)
