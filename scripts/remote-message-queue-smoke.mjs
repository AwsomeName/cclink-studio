#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, chromium } from 'playwright-core'
import electronPath from 'electron'

// Requires a running dev renderer. Fixtures run in an isolated Electron/profile and replace
// only its remote IPC responses. --real uses an explicitly selected signed-in dev instance.
const real = process.argv.includes('--real')
const arg = (name) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const rendererOrigin = arg('renderer') || 'http://localhost:5173'
const rootDir = fileURLToPath(new URL('..', import.meta.url))
const runDir = await mkdtemp(join(tmpdir(), 'studio-remote-queue-'))
const ref = real
  ? JSON.parse(arg('workspace-ref') || 'null')
  : {
      kind: 'remote',
      transport: 'cclink',
      endpointId: 'queue-fixture-agent',
      workspaceId: 'queue-fixture-workspace',
      path: '/queue-fixture',
    }
assert(ref?.kind === 'remote', '--real requires --workspace-ref=<RemoteWorkspaceRef JSON>')
let app, browser, page
try {
  if (real) {
    assert(arg('cdp-url'), '--real requires --cdp-url=http://127.0.0.1:<port>')
    browser = await chromium.connectOverCDP(arg('cdp-url'))
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(rendererOrigin))
    assert(page, 'Studio renderer not found')
  } else {
    const userData = join(runDir, 'user-data')
    await mkdir(userData)
    app = await _electron.launch({
      executablePath: electronPath,
      args: [rootDir],
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
    await page.waitForSelector('.main-window', { timeout: 30_000 })
    await app.evaluate(({ ipcMain, BrowserWindow }, ref) => {
      const session = {
        id: 'remote-queue-fixture',
        name: '队列验收',
        serverId: ref.endpointId,
        workspaceId: ref.workspaceId,
        workspacePath: ref.path,
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        messageCount: 0,
        contextUsage: 0,
      }
      const messages = []
      const sent = []
      const emit = (phase, message) => {
        if (message) messages.push(message)
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send('cclink:realtimeEvent', {
            type: 'conversation',
            serverId: ref.endpointId,
            sessionId: session.id,
            phase,
            ...(message ? { message } : {}),
          })
      }
      const handle = (channel, fn) => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (_event, input) => fn(input))
      }
      handle('remote:getStatus', () => ({
        ref,
        state: 'online',
        compatibility: 'compatible',
        workspacePath: ref.path,
        capabilities: {
          file: { tree: true, read: true },
          shell: { pty: false },
          agent: { session: true, stream: true, imageInput: true },
        },
      }))
      handle('cclink:listMessages', () => messages)
      handle('cclink:createSession', () => session)
      handle('cclink:sendAgentMessage', (input) => {
        assertIdle()
        sent.push(input.content)
        session.status = 'active'
        emit('started', {
          type: 'user',
          id: `user-${sent.length}`,
          timestamp: sent.length,
          content: input.content,
        })
        return { success: true }
      })
      function assertIdle() {
        if (session.status === 'active') throw new Error('Duplicate active remote dispatch')
      }
      handle('cclink:stopTrackingAgentRun', () => {
        session.status = 'idle'
        emit('untracked')
        return { success: true }
      })
      globalThis.remoteQueueSmoke = {
        sent,
        session,
        complete() {
          session.status = 'idle'
          emit('completed', {
            type: 'agentText',
            id: `reply-${sent.length}`,
            timestamp: sent.length + 1,
            content: `REMOTE_QUEUE_${sent.length}`,
          })
        },
        fail() {
          session.status = 'idle'
          emit('error', {
            type: 'system',
            id: `error-${sent.length}`,
            timestamp: sent.length + 1,
            content: '夹具：远程任务失败',
          })
        },
      }
    }, ref)
  }
  await page.evaluate(
    async ({ ref, real }) => {
      const queueModule = await (
        await fetch('/src/features/cclink-remote/remote-message-queue.ts')
      ).text()
      const storeUrl = queueModule.match(/from "([^"]*\/cclink-store\.ts[^"]*)"/)[1]
      const { useCclinkStore } = await import(storeUrl)
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      await useCclinkStore.getState().initialize()
      if (real) {
        if (!useCclinkStore.getState().session.loggedIn)
          throw new Error('请先在 Studio 登录 CCLink')
        if (!(await useCclinkStore.getState().connectRealtime()))
          throw new Error('CCLink 实时连接未就绪')
        const { openWorkspaceRef } =
          await import('/src/features/workspace-open/workspace-open-controller.ts')
        await openWorkspaceRef(ref)
        await useCclinkStore.getState().createSession(ref, '消息队列验收（纯文本）')
      } else {
        const session = await window.cclinkStudio.cclink.createSession({ ref, name: '队列验收' })
        useCclinkStore.setState({
          initialized: true,
          realtime: { state: 'online' },
          session: { loggedIn: true, user: { id: 'fixture-account' } },
          sessions: [session],
          selectedSessionId: session.id,
          activeSessionsRef: ref,
          connectRealtime: async () => {
            useCclinkStore.setState({ realtime: { state: 'online' } })
            return true
          },
        })
        useWorkspaceStore.getState().commitActiveWorkspace(ref)
      }
      useUIStore.getState().setAgentPanelMode('right', 'user')
    },
    { ref, real },
  )
  const panel = page.locator('[data-agent-panel-runtime="remote"]').first()
  const input = panel.locator('textarea')
  await input.waitFor({ state: 'visible' })
  for (const number of [1, 2, 3]) {
    await input.fill(`请只回复 REMOTE_QUEUE_${number}，不要调用工具。`)
    await input.press('Enter')
  }
  const queue = panel.getByRole('region', { name: '待发送消息' })
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-agent-panel-runtime="remote"] .agent-message-queue li')
        .length === 2,
  )
  await page.screenshot({ path: join(runDir, 'remote-queue-side.png') })
  if (!real) {
    await queue.getByRole('button', { name: '暂停队列', exact: true }).click()
    await app.evaluate(() => globalThis.remoteQueueSmoke.complete())
    assert.equal(await app.evaluate(() => globalThis.remoteQueueSmoke.sent.length), 1)
    await queue.getByRole('button', { name: '继续队列', exact: true }).click()
    await page.waitForFunction(
      () => document.querySelectorAll('.agent-message-queue li').length === 1,
    )
    await app.evaluate(() => globalThis.remoteQueueSmoke.complete())
    await page.waitForFunction(
      () => document.querySelectorAll('.agent-message-queue li').length === 0,
    )
    await app.evaluate(() => globalThis.remoteQueueSmoke.complete())
  }
  await page.waitForFunction(
    async () => {
      const queueModule = await (
        await fetch('/src/features/cclink-remote/remote-message-queue.ts')
      ).text()
      const storeUrl = queueModule.match(/from "([^"]*\/cclink-store\.ts[^"]*)"/)[1]
      const { useCclinkStore } = await import(storeUrl)
      const s = useCclinkStore.getState(),
        id = s.selectedSessionId
      return (
        s.sessions.find((session) => session.id === id)?.status === 'idle' &&
        (s.messages[id] ?? []).filter(
          (message) => message.type === 'agentText' && /REMOTE_QUEUE_[123]/.test(message.content),
        ).length === 3 &&
        Object.values(s.remoteMessageQueues).every((queue) => !queue.items.length)
      )
    },
    null,
    { timeout: 180_000 },
  )
  const result = await page.evaluate(async () => {
    const queueModule = await (
      await fetch('/src/features/cclink-remote/remote-message-queue.ts')
    ).text()
    const storeUrl = queueModule.match(/from "([^"]*\/cclink-store\.ts[^"]*)"/)[1]
    const { useCclinkStore } = await import(storeUrl)
    const s = useCclinkStore.getState()
    return {
      messages: s.messages[s.selectedSessionId],
      status: s.sessions.find((session) => session.id === s.selectedSessionId)?.status,
    }
  })
  if (!real) {
    await input.fill('第四条测试消息')
    await input.press('Enter')
    await input.fill('第五条待修改')
    await input.press('Enter')
    await queue.getByRole('button', { name: '编辑', exact: true }).last().click()
    assert.equal(await input.inputValue(), '第五条待修改')
    await input.fill('第五条修改后')
    await input.press('Enter')
    await panel.getByRole('button', { name: '停止等待', exact: true }).click()
    await page.waitForFunction(() =>
      document.querySelector('.agent-message-queue')?.textContent.includes('不代表远端已取消'),
    )
    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      useUIStore.getState().setAgentPanelMode('center', 'user')
    })
    await page.screenshot({ path: join(runDir, 'remote-queue-center-paused.png') })
    await page
      .getByRole('region', { name: '待发送消息' })
      .getByRole('button', { name: '删除', exact: true })
      .last()
      .click()
  }
  await writeFile(
    join(runDir, 'result.json'),
    JSON.stringify({ ok: true, runtimeWasStubbed: !real, ...result }, null, 2),
  )
  console.log(JSON.stringify({ ok: true, runtimeWasStubbed: !real, runDir }))
} catch (error) {
  await page?.screenshot({ path: join(runDir, 'failure.png') }).catch(() => {})
  await writeFile(join(runDir, 'failure.txt'), String(error))
  console.error(
    JSON.stringify({ ok: false, runtimeWasStubbed: !real, runDir, error: String(error) }),
  )
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  await browser?.close().catch(() => {})
}
