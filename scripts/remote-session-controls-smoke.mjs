import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

// Real isolated Electron + current service/store/preload; only the remote transport is a fixture.
// Never reads, stops or deletes a user's remote session.
const root = fileURLToPath(new URL('..', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'studio-session-controls-'))
const origin =
  process.argv.find((arg) => arg.startsWith('--renderer='))?.slice(11) || 'http://localhost:5173'
await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir')
await mkdir(join(dir, 'user-data'))
await writeFile(
  join(dir, 'entry.ts'),
  `export { CclinkRemoteService } from ${JSON.stringify(join(root, 'src/main/cclink-remote/cclink-remote-service.ts'))};`,
)
await build({
  configFile: false,
  root,
  logLevel: 'warn',
  build: {
    ssr: join(dir, 'entry.ts'),
    outDir: dir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'service.cjs' } },
  },
})
await writeFile(
  join(dir, 'setup.cjs'),
  `globalThis.controlsModule = require(${JSON.stringify(join(dir, 'service.cjs'))});`,
)
const ref = {
  kind: 'remote',
  transport: 'cclink',
  endpointId: 'controls-agent',
  endpointName: '验收设备',
  workspaceId: 'controls-project',
  path: '/controls-fixture',
}
let app
try {
  app = await _electron.launch({
    executablePath: electronPath,
    args: ['-r', join(dir, 'setup.cjs'), root],
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: origin,
      CCLINK_STUDIO_TEST_USER_DATA_PATH: join(dir, 'user-data'),
      CLAUDE_CONFIG_DIR: join(dir, 'claude'),
    },
    timeout: 30000,
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.waitForSelector('.main-window')
  await app.evaluate(async ({ ipcMain, BrowserWindow }, ref) => {
    const sessions = [
      ['running', '查清楚了，两个问题都有明确答案：' + '很长的标题'.repeat(25)],
      ['idle', '找到了。你上一个会话（工作目录）' + '不可撑宽列表'.repeat(25)],
      ['archived', '已归档的会话'],
    ].map(([id, name]) => ({
      id,
      name,
      serverId: ref.endpointId,
      workspaceId: ref.workspaceId,
      workspacePath: ref.path,
      status: id === 'archived' ? 'archived' : 'idle',
      createdAt: 1,
      updatedAt: 1,
      messageCount: 1,
      contextUsage: 0,
    }))
    const remote = new Map(
      sessions.map((s) => [
        s.id,
        {
          session_id: s.id,
          workspace_id: s.workspaceId,
          workspace_path: s.workspacePath,
          active_turn: s.id === 'running' ? { request_id: 'turn-1', status: 'running' } : null,
        },
      ]),
    )
    const service = new globalThis.controlsModule.CclinkRemoteService({}, null, {
      load: async () => ({
        version: 1,
        sessions,
        messages: Object.fromEntries(
          sessions.map((s) => [
            s.id,
            [{ type: 'agentText', id: `${s.id}-message`, content: '会话正文验收', timestamp: 1 }],
          ]),
        ),
      }),
      save: async () => {},
    })
    await service.initialize()
    service.connect = async () => ({ state: 'online' })
    service.requireOnline = async () => {
      if (globalThis.controlsOffline) throw new Error('远程设备离线，请重连后重试')
    }
    const listeners = new Set()
    globalThis.controlsSent = []
    const receive = (message) => {
      for (const listener of listeners)
        listener({ serverId: ref.endpointId, message: { v: 2, min_v: 2, ...message } })
    }
    service.getRequestRouter().attach({
      onMessage: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      sendMessage: async (_serverId, message) => {
        globalThis.controlsSent.push(message)
        if (message.cc_type === 'session_sync_request')
          receive({
            cc_type: 'session_sync_response',
            request_id: message.request_id,
            sessions: [...remote.values()],
          })
        if (message.cc_type === 'cancel_generation') {
          globalThis.finishControlsStop = () => {
            remote.get(message.session_id).active_turn = null
            receive({
              cc_type: 'agent_status',
              session_id: message.session_id,
              request_id: message.target_request_id,
              status: 'stopped',
            })
          }
          receive({
            cc_type: 'cancel_generation_ack',
            request_id: message.request_id,
            session_id: message.session_id,
            target_request_id: message.target_request_id,
            status: 'accepted',
          })
        }
        if (message.cc_type === 'session_delete') remote.delete(message.session_id)
      },
    })
    service.onRealtimeEvent((event) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send('cclink:realtimeEvent', event)
    })
    const handle = (channel, fn) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, input) => fn(input))
    }
    handle('cclink:connectRealtime', () => ({ state: 'online' }))
    handle('cclink:listSessions', (ref) => service.listSessions(ref))
    handle('cclink:listMessages', (id) => service.listMessages(id))
    handle('cclink:stopAgentRun', ({ ref, sessionId }) => service.stopAgentRun(ref, sessionId))
    handle('cclink:deleteSession', ({ ref, sessionId }) => service.deleteSession(ref, sessionId))
    handle('cclink:setSessionArchived', ({ sessionId, archived }) =>
      service.setSessionArchived(sessionId, archived),
    )
    handle('remote:getStatus', () => ({
      ref,
      state: 'online',
      compatibility: 'compatible',
      workspacePath: ref.path,
      capabilities: { file: {}, agent: { session: true, stream: true }, shell: {} },
    }))
  }, ref)
  await page.evaluate(async (ref) => {
    const source = await (await fetch('/src/bootstrap/use-remote-conversation-restore.ts')).text()
    const { useCclinkStore } = await import(
      source.match(/from "([^"]*\/cclink-store\.ts[^"]*)"/)[1]
    )
    const { useWorkspaceStore } = await import(
      source.match(/from "([^"]*\/workspace-store\.ts[^"]*)"/)[1]
    )
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    window.controlsSmoke = { useCclinkStore, useUIStore }
    window.cclinkStudio.cclink.onRealtimeEvent((event) =>
      useCclinkStore.getState().handleRealtimeEvent(event),
    )
    useCclinkStore.setState({ initialized: true, realtime: { state: 'online' } })
    useWorkspaceStore.getState().commitActiveWorkspace(ref)
    useUIStore.getState().setAgentPanelMode('right', 'user')
    useUIStore.getState().setAgentPanelWidth(700)
    useUIStore.getState().setAgentContentMode('split')
    useUIStore.getState().setAgentListWidth(200)
    await useCclinkStore.getState().loadSessions(ref)
  }, ref)
  const list = page.locator('.agent-navigation-list')
  const running = list.locator('[data-session-id="running"]')
  await running.getByRole('button', { name: '停止', exact: true }).waitFor()
  assert(await running.getByRole('button', { name: '删除', exact: true }).isDisabled())
  const geometry = await list.evaluate((list) => {
    const bounds = list.getBoundingClientRect()
    return {
      width: bounds.width,
      contentWidth: list.scrollWidth,
      rows: [...list.querySelectorAll('.remote-session-row')].map((row) => ({
        height: row.getBoundingClientRect().height,
        buttonsInside: [...row.querySelectorAll('button')].every(
          (b) => b.getBoundingClientRect().right <= bounds.right + 1,
        ),
        titleEllipsis:
          getComputedStyle(row.querySelector('.remote-session-title')).textOverflow === 'ellipsis',
      })),
    }
  })
  assert(
    geometry.rows.every((row) => row.height < 85 && row.buttonsInside && row.titleEllipsis),
    JSON.stringify(geometry),
  )
  assert(geometry.contentWidth <= geometry.width + 1, JSON.stringify(geometry))
  await list.locator('.remote-sessions-sidebar').screenshot({ path: join(dir, 'session-list.png') })
  await page.screenshot({ path: join(dir, 'sessions-before.png') })
  for (const width of [180, 280]) {
    await page.evaluate(
      (width) => window.controlsSmoke.useUIStore.getState().setAgentListWidth(width),
      width,
    )
    await page.waitForFunction(
      (width) =>
        document.querySelector('.agent-navigation-list')?.getBoundingClientRect().width === width,
      width,
    )
    assert(
      await list.evaluate((list) =>
        [...list.querySelectorAll('.remote-session-actions button')].every(
          (button) =>
            button.getBoundingClientRect().right <= list.getBoundingClientRect().right + 1,
        ),
      ),
    )
  }
  await page.evaluate(() => window.controlsSmoke.useUIStore.getState().setAgentListWidth(200))
  await running.getByRole('button', { name: '停止', exact: true }).click()
  await page.getByText('远端已接受停止请求，等待任务结束', { exact: true }).waitFor()
  assert(await running.getByRole('button', { name: '删除', exact: true }).isDisabled())
  assert.equal(
    await app.evaluate(
      () => globalThis.controlsSent.filter((m) => m.cc_type === 'cancel_generation').length,
    ),
    1,
  )
  await app.evaluate(() => globalThis.finishControlsStop())
  await page.waitForFunction(
    () =>
      window.controlsSmoke.useCclinkStore.getState().sessions.find((s) => s.id === 'running')
        ?.status === 'idle',
  )
  const idle = list.locator('[data-session-id="idle"]')
  await idle.getByRole('button', { name: '删除', exact: true }).click()
  await idle.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(
    await app.evaluate(
      () => globalThis.controlsSent.filter((m) => m.cc_type === 'session_delete').length,
    ),
    0,
  )
  await idle.getByRole('button', { name: '删除', exact: true }).click()
  await app.evaluate(() => {
    globalThis.controlsOffline = true
  })
  await idle.getByRole('button', { name: '确认删除', exact: true }).click()
  await list.getByRole('alert').filter({ hasText: '远程设备离线' }).waitFor()
  assert.equal(await idle.count(), 1)
  await app.evaluate(() => {
    globalThis.controlsOffline = false
  })
  await idle.getByRole('button', { name: '确认删除', exact: true }).click()
  await idle.waitFor({ state: 'detached' })
  assert.equal(
    await app.evaluate(
      () => globalThis.controlsSent.filter((m) => m.cc_type === 'session_delete').length,
    ),
    1,
  )
  await list.getByRole('button', { name: '查看已归档会话', exact: true }).click()
  await list
    .locator('[data-session-id="archived"]')
    .getByRole('button', { name: '恢复', exact: true })
    .click()
  await list.getByRole('button', { name: '返回当前会话', exact: true }).click()
  await list.locator('[data-session-id="archived"]').waitFor()
  await page.screenshot({ path: join(dir, 'sessions-after.png') })
  console.log(JSON.stringify({ ok: true, geometry, artifacts: dir }, null, 2))
} finally {
  await app?.close()
}
