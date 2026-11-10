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
      const answers = []
      let holdSend = false
      let releaseSendReceipt
      let pendingAnswer
      let answerReady
      let signalAnswerReady
      const prepareAnswer = () => {
        answerReady = new Promise((resolve) => {
          signalAnswerReady = resolve
        })
      }
      const emit = (phase, message) => {
        if (message) {
          const index = messages.findIndex((item) => item.id === message.id)
          if (index >= 0) messages[index] = message
          else messages.push(message)
        }
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
      handle('cclink:listSessions', () => [session])
      handle('cclink:createSession', () => session)
      handle('cclink:answerQuestion', (input) => {
        answers.push(input)
        return new Promise((resolve) => {
          pendingAnswer = { input, resolve }
          signalAnswerReady()
        })
      })
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
        if (holdSend) {
          holdSend = false
          return new Promise((resolve) => {
            releaseSendReceipt = resolve
          })
        }
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
      handle('cclink:stopAgentRun', () => {
        session.status = 'idle'
        emit('completed')
        return { success: true }
      })
      globalThis.remoteQueueSmoke = {
        sent,
        answers,
        session,
        holdNextSend() {
          holdSend = true
        },
        acceptSend() {
          if (!releaseSendReceipt) throw new Error('No pending send receipt')
          const resolve = releaseSendReceipt
          releaseSendReceipt = null
          resolve({ success: true })
        },
        ask() {
          prepareAnswer()
          emit('message', {
            type: 'userQuestion',
            id: `question-${sent.length}`,
            timestamp: sent.length + 1,
            requestId: `question-request-${sent.length}`,
            toolUseId: `question-tool-${sent.length}`,
            questions: [
              {
                id: 'market',
                header: '大盘链',
                question: '恢复大盘研判链？',
                options: [{ label: '恢复' }, { label: '暂停' }],
              },
              {
                id: 'breadth',
                header: '宽度数据',
                question: '保留宽度数据？',
                options: [{ label: '保留' }, { label: '停掉' }],
              },
            ],
          })
        },
        async confirmAnswer(success) {
          await answerReady
          const pending = pendingAnswer
          pendingAnswer = null
          prepareAnswer()
          if (success) {
            const question = messages.find(
              (message) =>
                message.type === 'userQuestion' && message.toolUseId === pending.input.toolUseId,
            )
            emit('message', {
              ...question,
              answered: true,
              status: 'resolved',
              resolution: 'original_turn',
            })
          }
          pending.resolve(
            success ? { success: true } : { success: false, error: '夹具：回复未确认，请重试' },
          )
        },
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
  const queue = panel.getByRole('region', { name: '待发送消息' })
  const sendDirect = async (text, screenshotName) => {
    if (!real) await app.evaluate(() => globalThis.remoteQueueSmoke.holdNextSend())
    await input.fill(text)
    await input.press('Enter')
    if (!real) {
      await panel.getByRole('button', { name: '发送中…', exact: true }).waitFor()
      assert.equal(
        await queue.count(),
        0,
        'The current direct submission must never be a waiting item',
      )
      assert.equal(
        await panel.locator('.agent-composer-queue-hint').innerText(),
        '正在发送当前消息…',
      )
      await page.screenshot({ path: join(runDir, screenshotName) })
      await app.evaluate(() => globalThis.remoteQueueSmoke.acceptSend())
    }
  }
  await input.waitFor({ state: 'visible' })
  for (const number of [1, 2, 3]) {
    const text = `请只回复 REMOTE_QUEUE_${number}，不要调用工具。`
    if (number === 1) await sendDirect(text, 'remote-first-direct.png')
    else {
      await input.fill(text)
      await input.press('Enter')
    }
  }
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-agent-panel-runtime="remote"] .agent-message-queue li')
        .length === 2,
  )
  await page.screenshot({ path: join(runDir, 'remote-queue-side.png') })
  await panel.getByRole('button', { name: '更多发送方式', exact: true }).click()
  assert.equal(
    await panel.getByRole('button', { name: '补充当前任务', exact: false }).isDisabled(),
    true,
  )
  assert.equal(
    await panel.getByRole('button', { name: '停止并执行这条', exact: false }).isDisabled(),
    true,
  )
  await page.screenshot({ path: join(runDir, 'remote-follow-up-unavailable.png') })
  await panel.getByRole('button', { name: '更多发送方式', exact: true }).press('Escape')

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
    for (const mode of ['right', 'center']) {
      await page.evaluate(async (mode) => {
        const { useUIStore } = await import('/src/stores/ui-store.ts')
        useUIStore.getState().setAgentPanelMode(mode, 'user')
      }, mode)
      const sentBeforeFailure = await app.evaluate(() => globalThis.remoteQueueSmoke.sent.length)
      await sendDirect(`FAIL_THEN_RETRY_${mode}`, `remote-direct-${mode}.png`)
      await panel.getByRole('button', { name: '停止', exact: true }).waitFor()
      await page.waitForFunction(
        () => document.querySelectorAll('.agent-message-queue li').length === 0,
      )
      await app.evaluate(() => globalThis.remoteQueueSmoke.fail())
      await panel.getByRole('button', { name: '发送', exact: true }).waitFor()
      assert.equal(await queue.count(), 0, 'A failed single message must not leave a paused queue')
      assert.equal(
        await panel.locator('.agent-composer-queue-hint').innerText(),
        'Enter 发送 · Shift+Enter 换行',
      )
      assert.equal(
        await app.evaluate(() => globalThis.remoteQueueSmoke.sent.length),
        sentBeforeFailure + 1,
        'A failure must not retry automatically',
      )
      await page.screenshot({ path: join(runDir, `remote-failure-ready-${mode}.png`) })
      await input.fill(`MANUAL_RETRY_${mode}`)
      if (mode === 'right') await input.press('Enter')
      else await panel.getByRole('button', { name: '发送', exact: true }).click()
      await panel.getByRole('button', { name: '停止', exact: true }).waitFor()
      await page.waitForFunction(
        () => document.querySelectorAll('.agent-message-queue li').length === 0,
      )
      assert.equal(
        await app.evaluate(() => globalThis.remoteQueueSmoke.sent.length),
        sentBeforeFailure + 2,
      )
      assert.equal(
        await app.evaluate(() => globalThis.remoteQueueSmoke.sent.at(-1)),
        `MANUAL_RETRY_${mode}`,
      )
      await page.screenshot({ path: join(runDir, `remote-failure-retry-${mode}.png`) })
      await app.evaluate(() => globalThis.remoteQueueSmoke.complete())
      await panel.getByRole('button', { name: '发送', exact: true }).waitFor()
    }
    for (const mode of ['right', 'center']) {
      await page.evaluate(async (mode) => {
        const { useUIStore } = await import('/src/stores/ui-store.ts')
        useUIStore.getState().setAgentPanelMode(mode, 'user')
      }, mode)
      await input.fill(`QUESTION_${mode}`)
      await input.press('Enter')
      await panel.getByRole('button', { name: '停止', exact: true }).waitFor()
      await page.waitForFunction(
        () => document.querySelectorAll('.agent-message-queue li').length === 0,
      )
      const sentBeforeReply = await app.evaluate(() => globalThis.remoteQueueSmoke.sent.length)
      const text = '先全部停掉，后面需要恢复哪个我再说。'
      if (mode === 'center') {
        await input.fill(text)
        await input.press('Enter')
        await queue.waitFor()
      }
      await app.evaluate(() => globalThis.remoteQueueSmoke.ask())
      const card = panel.locator('.agent-question-card').last()
      await card.getByRole('button', { name: '直接用文字回复', exact: true }).waitFor()
      assert.equal(
        await card.getByRole('button', { name: '提交回答', exact: true }).isDisabled(),
        true,
      )
      if (mode === 'right') {
        await card.getByRole('button', { name: '直接用文字回复', exact: true }).click()
        assert.equal(await input.evaluate((element) => element === document.activeElement), true)
        await input.fill(text)
        await input.press('Enter')
      } else {
        await queue.getByRole('button', { name: '用此消息回复', exact: true }).click()
      }
      await panel.getByRole('button', { name: '等待确认', exact: true }).waitFor()
      assert.equal(
        await card.getByRole('button', { name: '等待 Agent 确认…', exact: true }).isDisabled(),
        true,
      )
      if (mode === 'right') {
        assert.equal(await input.inputValue(), text)
        await app.evaluate(() => globalThis.remoteQueueSmoke.confirmAnswer(false))
        await card.getByText('夹具：回复未确认，请重试', { exact: true }).waitFor()
        assert.equal(await input.inputValue(), text)
        await panel.getByRole('button', { name: '直接回复', exact: true }).click()
      } else {
        assert.equal(await queue.locator('li').count(), 1)
        assert.equal(
          await queue.getByRole('button', { name: '删除', exact: true }).isDisabled(),
          true,
        )
        await app.evaluate(() => globalThis.remoteQueueSmoke.confirmAnswer(false))
        await card.getByText('夹具：回复未确认，请重试', { exact: true }).waitFor()
        assert.equal(await queue.locator('li').count(), 1)
        await queue.getByRole('button', { name: '用此消息回复', exact: true }).click()
      }
      await page.screenshot({ path: join(runDir, `remote-question-reply-pending-${mode}.png`) })
      await app.evaluate(() => globalThis.remoteQueueSmoke.confirmAnswer(true))
      await card.getByRole('button', { name: '已回答', exact: true }).waitFor()
      await page.waitForFunction(
        () => document.querySelectorAll('.agent-message-queue li').length === 0,
      )
      assert.equal(await input.inputValue(), '')
      assert.equal(
        await app.evaluate(() => globalThis.remoteQueueSmoke.sent.length),
        sentBeforeReply,
      )
      assert.deepEqual(
        await app.evaluate(() => globalThis.remoteQueueSmoke.answers.at(-1).answers),
        { market: text, breadth: text },
      )
      assert.equal(await card.getByLabel('大盘链').inputValue(), '')
      assert.equal(await card.getByLabel('宽度数据').inputValue(), '')
      await page.screenshot({ path: join(runDir, `remote-question-replied-${mode}.png`) })
      await app.evaluate(() => globalThis.remoteQueueSmoke.complete())
      await panel.getByRole('button', { name: '发送', exact: true }).waitFor()
    }
    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      useUIStore.getState().setAgentPanelMode('right', 'user')
    })
    await input.fill('第四条测试消息')
    await input.press('Enter')
    await input.fill('第五条待修改')
    await input.press('Enter')
    await queue.getByRole('button', { name: '编辑', exact: true }).last().click()
    assert.equal(await input.inputValue(), '第五条待修改')
    await input.fill('第五条修改后')
    await input.press('Enter')
    await panel.getByRole('button', { name: '停止', exact: true }).click()
    await page.waitForFunction(() =>
      document.querySelector('.agent-message-queue')?.textContent.includes('已请求停止任务'),
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
    JSON.stringify(
      {
        ok: true,
        runtimeWasStubbed: !real,
        ...result,
        ...(!real
          ? {
              failureRetryVerified: ['right-enter', 'center-button'],
              directSendVerified: [
                'first-message-no-queue',
                'right-no-queue-during-receipt',
                'center-no-queue-during-receipt',
                'only-follow-ups-queued',
              ],
              questionReplyVerified: [
                'right-enter',
                'rejection-preserves-draft',
                'button-retry',
                'center-queued-reply',
                'queued-reply-retry-clears-empty-pause',
                'ack-before-removal',
                'no-option-selected',
                'no-duplicate-normal-message',
              ],
            }
          : {}),
      },
      null,
      2,
    ),
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
