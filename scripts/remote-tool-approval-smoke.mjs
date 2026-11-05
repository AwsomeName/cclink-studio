#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

// Real Electron, service, IPC and controller; only the remote transport is a fixture.
// Uses an existing dev renderer and a separate profile, without signing in or sending remote work.
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const rendererOrigin =
  process.argv.find((value) => value.startsWith('--renderer='))?.slice('--renderer='.length) ||
  'http://localhost:5173'
const runDir = await mkdtemp(join(tmpdir(), 'studio-tool-approval-'))
const bundlePath = join(runDir, 'remote-service.cjs')
const setupPath = join(runDir, 'setup.cjs')
const entryPath = join(runDir, 'remote-service-entry.ts')
const userData = join(runDir, 'user-data')
await mkdir(userData)
await symlink(join(rootDir, 'node_modules'), join(runDir, 'node_modules'), 'dir')
await writeFile(
  entryPath,
  `export { CclinkRemoteService } from ${JSON.stringify(join(rootDir, 'src/main/cclink-remote/cclink-remote-service.ts'))};
export { createCclinkEnvelope } from ${JSON.stringify(join(rootDir, 'src/shared/cclink.ts'))};`,
)
await build({
  configFile: false,
  root: rootDir,
  logLevel: 'warn',
  build: {
    ssr: entryPath,
    outDir: runDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: { output: { format: 'cjs', entryFileNames: 'remote-service.cjs' } },
  },
})
await writeFile(
  setupPath,
  `globalThis.toolApprovalModule = require(${JSON.stringify(bundlePath)});`,
)
let app, page
try {
  app = await _electron.launch({
    executablePath: electronPath,
    args: ['-r', setupPath, rootDir],
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
  const fixture = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const { CclinkRemoteService, createCclinkEnvelope } = globalThis.toolApprovalModule
    const ref = {
      kind: 'remote',
      transport: 'cclink',
      endpointId: 'approval-fixture-agent',
      workspaceId: 'approval-fixture-workspace',
      path: '/approval-fixture',
    }
    const session = {
      id: 'approval-fixture-session',
      name: '计划审批回归',
      serverId: ref.endpointId,
      workspaceId: ref.workspaceId,
      workspacePath: ref.path,
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
      messageCount: 0,
      contextUsage: 0,
    }
    const service = new CclinkRemoteService({}, null, {
      load: async () => ({ version: 1, sessions: [session], messages: {} }),
      save: async () => {},
    })
    await service.initialize()
    service.connect = async () => ({ state: 'online' })
    service.getStatus = async () => ({
      ref,
      state: 'online',
      compatibility: 'compatible',
      workspacePath: ref.path,
      capabilities: {
        file: { tree: false, read: false },
        shell: { pty: false },
        agent: { session: true, stream: true },
      },
    })
    const sent = []
    const listeners = new Set()
    service.getRequestRouter().attach({
      sendMessage: async (serverId, message) => sent.push({ serverId, message }),
      onMessage: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
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
    handle('remote:getStatus', () => service.getStatus())
    handle('cclink:listSessions', () => [session])
    handle('cclink:listMessages', () => service.listMessages(session.id))
    handle('cclink:resolveToolApproval', (input) => service.resolveToolApproval(input))
    const emit = (message) => service.handleProtocolMessage(ref.endpointId, message)
    const event = {
      ...createCclinkEnvelope('agent_tool', { request_id: 'plan-request' }),
      session_id: session.id,
      msg_id: 'plan-message',
      tool: 'ExitPlanMode',
      tool_use_id: 'plan-tool',
      input: { plan: '仅验证审批卡，不运行远程命令。' },
      state: 'pending',
      requires_approval: true,
    }
    globalThis.toolApprovalSmoke = {
      sent,
      async requestApproval() {
        await emit({ ...event, cc_type: 'stream_start' })
        await emit({ ...event, state: 'executing', requires_approval: undefined })
        await emit(event)
      },
      ack() {
        const response = {
          ...createCclinkEnvelope('tool_approval_ack', {
            request_id: sent[0].message.request_id,
          }),
          session_id: session.id,
          tool_use_id: event.tool_use_id,
          approved: true,
          status: 'accepted',
        }
        for (const listener of listeners) listener({ serverId: ref.endpointId, message: response })
      },
      async replay() {
        await emit({
          ...event,
          request_id: undefined,
          state: 'executing',
          requires_approval: false,
        })
        await emit(event)
      },
      async complete() {
        await emit({ ...event, state: 'completed', requires_approval: false, output: '计划已确认' })
        await emit({
          ...event,
          cc_type: 'stream_end',
          exit_code: 0,
          final_text: 'APPROVAL_SMOKE_COMPLETED',
        })
      },
      snapshot: () => service.listMessages(session.id),
    }
    return { ref, session }
  })
  await page.evaluate(async ({ ref, session }) => {
    const queueModule = await (
      await fetch('/src/features/cclink-remote/remote-message-queue.ts')
    ).text()
    const storeUrl = queueModule.match(/from "([^"]*\/cclink-store\.ts[^"]*)"/)[1]
    const { useCclinkStore } = await import(storeUrl)
    const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    await useCclinkStore.getState().initialize()
    useCclinkStore.setState({
      initialized: true,
      realtime: { state: 'online' },
      session: { loggedIn: true, user: { id: 'fixture-account' } },
      sessions: [session],
      selectedSessionId: session.id,
      activeSessionsRef: ref,
      connectRealtime: async () => true,
    })
    useWorkspaceStore.getState().commitActiveWorkspace(ref)
    useUIStore.getState().setAgentPanelMode('right', 'user')
  }, fixture)
  const panel = page.locator('[data-agent-panel-runtime="remote"]').first()
  await panel.locator('textarea').waitFor({ state: 'visible' })
  await app.evaluate(() => globalThis.toolApprovalSmoke.requestApproval())
  const approve = panel.getByRole('button', { name: '允许本次操作', exact: true })
  await approve.waitFor()
  assert.equal(await approve.count(), 1)
  assert.equal(await app.evaluate(() => globalThis.toolApprovalSmoke.sent.length), 0)
  await page.screenshot({ path: join(runDir, 'approval-visible.png') })
  await approve.click()
  const waiting = panel.getByRole('button', { name: '等待 Agent 确认…', exact: true })
  await waiting.waitFor()
  assert(await waiting.isDisabled())
  assert.equal(await app.evaluate(() => globalThis.toolApprovalSmoke.sent.length), 1)
  await app.evaluate(() => globalThis.toolApprovalSmoke.ack())
  await waiting.waitFor({ state: 'hidden' })
  await app.evaluate(() => globalThis.toolApprovalSmoke.replay())
  assert.equal(await approve.count(), 0)
  assert.equal(await app.evaluate(() => globalThis.toolApprovalSmoke.sent.length), 1)
  await app.evaluate(() => globalThis.toolApprovalSmoke.complete())
  await panel.getByText('APPROVAL_SMOKE_COMPLETED', { exact: true }).waitFor()
  await page.screenshot({ path: join(runDir, 'approval-completed.png') })
  const messages = await app.evaluate(() => globalThis.toolApprovalSmoke.snapshot())
  assert.equal(messages.find((message) => message.type === 'agentTool').tool.state, 'completed')
  await writeFile(
    join(runDir, 'result.json'),
    JSON.stringify({ ok: true, remoteTransportStubbed: true, messages }, null, 2),
  )
  console.log(JSON.stringify({ ok: true, remoteTransportStubbed: true, runDir }))
} catch (error) {
  await page?.screenshot({ path: join(runDir, 'failure.png') }).catch(() => {})
  await writeFile(join(runDir, 'failure.txt'), String(error))
  console.error(JSON.stringify({ ok: false, runDir, error: String(error) }))
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
}
