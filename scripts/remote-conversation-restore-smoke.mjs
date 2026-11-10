import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

// Real Electron UI + current service/store + real disk state. The network is offline;
// this verifies history recovery without a login, remote Agent, or renderer history injection.
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const rendererOrigin =
  process.argv.find((value) => value.startsWith('--renderer='))?.slice('--renderer='.length) ||
  'http://localhost:5173'
const runDir = await mkdtemp(join(tmpdir(), 'studio-remote-history-'))
const userData = join(runDir, 'user-data')
const stateRoot = join(userData, 'cclink-remote')
await mkdir(stateRoot, { recursive: true })
await symlink(join(rootDir, 'node_modules'), join(runDir, 'node_modules'), 'dir')
const entry = join(runDir, 'entry.ts')
const bundle = join(runDir, 'history.cjs')
const setup = join(runDir, 'setup.cjs')
await writeFile(
  entry,
  `export { CclinkRemoteService } from ${JSON.stringify(join(rootDir, 'src/main/cclink-remote/cclink-remote-service.ts'))};
export { CclinkRuntimeStateStore } from ${JSON.stringify(join(rootDir, 'src/main/cclink-remote/runtime-state-store.ts'))};`,
)
await build({
  configFile: false,
  root: rootDir,
  logLevel: 'warn',
  build: {
    ssr: entry,
    outDir: runDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'history.cjs' } },
  },
})
await writeFile(setup, `globalThis.historySmokeModule = require(${JSON.stringify(bundle)});`)
const ref = {
  kind: 'remote',
  transport: 'cclink',
  endpointId: 'history-smoke-agent',
  workspaceId: 'history-smoke-workspace',
  path: '/history-smoke',
}
const otherRef = { ...ref, workspaceId: 'history-smoke-other', path: '/history-other' }
const sessions = ['idle', 'idle', 'idle', 'archived', 'archived', 'idle'].map((status, index) => ({
  id: `history-${index}`,
  name: `历史验收 ${index}`,
  status,
  serverId: ref.endpointId,
  workspaceId: index === 5 ? otherRef.workspaceId : ref.workspaceId,
  workspacePath: index === 5 ? otherRef.path : ref.path,
  createdAt: 1,
  updatedAt: 10 - index,
  messageCount: 1,
  contextUsage: 0,
}))
await writeFile(
  join(stateRoot, 'cclink-runtime-state.json'),
  JSON.stringify({
    version: 1,
    sessions,
    messages: Object.fromEntries(
      sessions.map((session) => [
        session.id,
        [
          {
            type: 'agentText',
            id: `message-${session.id}`,
            content: `恢复正文 ${session.id}`,
            timestamp: 2,
          },
        ],
      ]),
    ),
  }),
  { mode: 0o600 },
)
let app
let page
async function launch() {
  app = await _electron.launch({
    executablePath: electronPath,
    args: ['-r', setup, rootDir],
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: rendererOrigin,
      CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
      CLAUDE_CONFIG_DIR: join(runDir, 'claude-config'),
    },
    timeout: 30_000,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  await app.evaluate(async ({ ipcMain }, stateRoot) => {
    const { CclinkRemoteService, CclinkRuntimeStateStore } = globalThis.historySmokeModule
    const service = new CclinkRemoteService({}, null, new CclinkRuntimeStateStore(stateRoot))
    await service.initialize()
    service.connect = async () => ({ state: 'offline' })
    globalThis.historySmokeCalls = 0
    ipcMain.removeHandler('cclink:listSessions')
    ipcMain.handle('cclink:listSessions', (_event, ref) => {
      globalThis.historySmokeCalls += 1
      return service.listSessions(ref)
    })
    ipcMain.removeHandler('cclink:listMessages')
    ipcMain.handle('cclink:listMessages', (_event, sessionId) => service.listMessages(sessionId))
  }, stateRoot)
  await page.evaluate(async () => {
    const source = await (await fetch('/src/bootstrap/use-remote-conversation-restore.ts')).text()
    const cclinkUrl = source.match(/from "([^"]*\/cclink-store\.ts[^"]*)"/)[1]
    const workspaceUrl = source.match(/from "([^"]*\/workspace-store\.ts[^"]*)"/)[1]
    const { useCclinkStore } = await import(cclinkUrl)
    const { useWorkspaceStore } = await import(workspaceUrl)
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    window.historySmoke = { useCclinkStore, useWorkspaceStore, useUIStore }
    // Set only connection/UI state. History must come through the real restoration hook.
    useCclinkStore.setState({ initialized: true })
    useUIStore.getState().setAgentPanelMode('hidden', 'user')
  })
}
async function openWorkspace(target) {
  await page.evaluate((target) => {
    window.historySmoke.useWorkspaceStore.getState().commitActiveWorkspace(target)
  }, target)
  await page.waitForFunction((target) => {
    const state = window.historySmoke.useCclinkStore.getState()
    return (
      !state.loading &&
      state.sessions.length > 0 &&
      state.sessions.every((session) => session.workspaceId === target.workspaceId)
    )
  }, target)
}
async function verifyHistory(label) {
  await openWorkspace(ref)
  const counts = await page.evaluate(() => {
    const sessions = window.historySmoke.useCclinkStore.getState().sessions
    return {
      idle: sessions.filter((s) => s.status === 'idle').length,
      archived: sessions.filter((s) => s.status === 'archived').length,
    }
  })
  assert.deepEqual(counts, { idle: 3, archived: 2 })
  assert.equal(await page.locator('.conversation-quick-switcher').count(), 0)
  await page.evaluate(() => {
    const ui = window.historySmoke.useUIStore.getState()
    ui.setAgentPanelMode('right', 'user')
    ui.setAgentContentMode('list')
  })
  const list = page.locator('.agent-navigation-list')
  await list.locator('[data-conversation-id="history-0"]').waitFor({ state: 'visible' })
  assert.equal(await list.locator('[data-conversation-id]').count(), 3)
  await list.getByRole('button', { name: '查看已归档会话', exact: true }).click()
  await list.locator('[data-conversation-id="history-3"]').waitFor({ state: 'visible' })
  assert.equal(await list.locator('[data-conversation-id]').count(), 2)
  await page.screenshot({ path: join(runDir, `${label}-archived.png`) })
  await list.getByRole('button', { name: '返回当前会话', exact: true }).click()
  await list.locator('[data-conversation-id="history-0"]').click()
  await page.getByText('恢复正文 history-0', { exact: true }).waitFor({ state: 'visible' })
  await page.screenshot({ path: join(runDir, `${label}-messages.png`) })
}
try {
  await launch()
  await verifyHistory('before-crash')
  await openWorkspace(otherRef)
  assert.deepEqual(
    await page.evaluate(() =>
      window.historySmoke.useCclinkStore.getState().sessions.map((s) => s.id),
    ),
    ['history-5'],
  )
  const calls = await app.evaluate(() => globalThis.historySmokeCalls)
  await page.evaluate(() => {
    window.historySmoke.useCclinkStore.setState({ realtime: { state: 'online' } })
  })
  await page.waitForFunction(() => !window.historySmoke.useCclinkStore.getState().loading)
  assert.ok((await app.evaluate(() => globalThis.historySmokeCalls)) > calls)

  const child = app.process()
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  app = undefined
  await launch()
  await verifyHistory('after-crash')
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('cclink:listSessions')
    ipcMain.handle('cclink:listSessions', () => {
      throw new Error('远程会话历史恢复失败：原文件已保留')
    })
  })
  await page.evaluate((ref) => {
    const { useWorkspaceStore, useUIStore } = window.historySmoke
    useUIStore.getState().setAgentContentMode('list')
    useWorkspaceStore
      .getState()
      .commitActiveWorkspace({ ...ref, workspaceId: 'unreadable-history' })
  }, ref)
  await page.locator('.agent-navigation-list').getByRole('alert').waitFor({ state: 'visible' })
  assert.equal(await page.getByText('当前远程项目暂无会话', { exact: true }).count(), 0)
  console.log(
    JSON.stringify(
      {
        success: true,
        beforeAndAfterSigkill: { idle: 3, archived: 2, messagesVisible: true },
        workspaceSwitch: true,
        reconnectRefresh: true,
        unreadableHistoryShowsError: true,
        rendererHistoryInjected: false,
        evidence: runDir,
      },
      null,
      2,
    ),
  )
} finally {
  await app?.close().catch(() => undefined)
}
