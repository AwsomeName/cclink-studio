#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

// Isolated Electron, real input/UI/store/controller; deterministic Runtime completion by default.
// --real-runtime uses the existing local Claude configuration for three harmless text-only turns.
const realRuntime = process.argv.includes('--real-runtime')
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR = await mkdtemp(join(tmpdir(), 'studio-message-queue-'))
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= String(43500 + Math.floor(Math.random() * 1000))
const { runDir, logFile, rendererOrigin, rootDir } = createSmokeRuntime(import.meta.url)
const workspace = await mkdtemp(join(homedir(), '.cclink-studio-queue-smoke-'))
const userData = join(runDir, 'user-data')
await mkdir(userData)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({ lastWorkspacePath: workspace, recentWorkspacePaths: [workspace] }),
)
let child
let browser
let page
const id = 'message-queue-smoke'
const assert = (value, message) => {
  if (!value) throw new Error(message)
}

try {
  const fd = openSync(logFile, 'w')
  try {
    child = spawn('bash', ['scripts/dev.sh'], {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
        CCLINK_STUDIO_RENDERER_PORT: new URL(rendererOrigin).port,
        ...(!realRuntime ? { CLAUDE_CONFIG_DIR: join(runDir, 'claude-config') } : {}),
      },
      detached: true,
      stdio: ['ignore', fd, fd],
    })
  } finally {
    closeSync(fd)
  }
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const log = await readFile(logFile, 'utf8').catch(() => '')
    const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
    if (match) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${match[1]}`)
      page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith(rendererOrigin))
      if (page) break
      await browser.close()
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  assert(page, 'Studio renderer did not start')
  await page.waitForSelector('.main-window', { timeout: 30000 })
  await page.evaluate(
    async ({ workspace, id, realRuntime }) => {
      const { openWorkspaceRef } =
        await import('/src/features/workspace-open/workspace-open-controller.ts')
      await openWorkspaceRef({ kind: 'local', path: workspace })
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      useAgentStore.getState().createConversation({
        id,
        activate: true,
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: { kind: 'local', path: workspace },
        },
      })
      useUIStore.getState().setAgentPanelMode('right', 'user')
      if (!realRuntime) {
        const { createConversationRunController } =
          await import('/src/features/agent-conversations/conversation-run-controller.ts')
        // Pause the app consumer during setup; test the same dispatcher with a deterministic backend.
        useAgentStore.getState().setMessageQueuePauseReason('smoke setup', id)
        window.queueSmokeSent = []
        window.queueSmokeApi = {
          saveMessageImages: window.cclinkStudio.agent.saveMessageImages,
          sendMessage: async (conversationId, payload) => {
            window.queueSmokeSent.push(payload.message)
            return {
              success: true,
              configurationReceipt: {
                conversationId,
                runId: payload.runId,
                roleRef: payload.configuration.roleRef,
                configurationRevision: payload.configuration.revision,
                configurationFingerprint: null,
                runtimeSessionMode: 'new',
                skills: [],
              },
            }
          },
          abort: async () => ({ accepted: true }),
          compactConversation: async () => ({ success: true }),
        }
        // Keep the app consumer paused in deterministic mode. Unit tests cover automatic
        // scheduling; this UI smoke dispatches through the production send controller.
        window.queueSmokeDispatch = () => {
          const item = useAgentStore.getState().conversations[id].queuedMessages?.[0]
          return createConversationRunController({
            conversationId: id,
            agentApi: window.queueSmokeApi,
          }).sendQueued(item)
        }
        useAgentStore.getState().beginRun(id)
      }
    },
    { workspace, id, realRuntime },
  )
  const composer = page.locator('[data-agent-panel-runtime="local"] textarea').first()
  await composer.waitFor({ state: 'visible' })
  const messages = realRuntime
    ? [
        '请只回复 QUEUE_ONE，不调用工具。',
        '请只回复 QUEUE_TWO，不调用工具。',
        '请只回复 QUEUE_THREE，不调用工具。',
      ]
    : ['先整理当前工作空间', '然后检查修改结果', '最后给出验证摘要']
  if (realRuntime) {
    await composer.fill(messages[0])
    await composer.press('Enter')
  }
  await composer.fill(messages[1])
  await composer.press('Enter')
  await composer.fill(messages[2])
  await composer.press('Enter')
  const queue = page.getByRole('region', { name: '待发送消息' })
  // section has an accessible name and maps to region.
  await queue.waitFor({ state: 'visible' })
  assert((await queue.locator('li').count()) === 2, 'Expected two queued messages')
  await page.screenshot({ path: join(runDir, 'queue-side.png') })
  if (realRuntime) {
    const completeDeadline = Date.now() + 120000
    while (Date.now() < completeDeadline) {
      const status = await page.evaluate(async (id) => {
        const { useAgentStore } = await import('/src/stores/agent-store.ts')
        const c = useAgentStore.getState().conversations[id]
        return {
          loading: c.loading,
          queued: c.queuedMessages?.length ?? 0,
          pause: c.messageQueuePauseReason,
          userMessages: c.messages.filter((message) => message.role === 'user').length,
        }
      }, id)
      if (status.pause) throw new Error(status.pause)
      if (!status.loading && status.queued === 0 && status.userMessages === 3) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const result = await page.evaluate(async (id) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const c = useAgentStore.getState().conversations[id]
      return {
        runStatus: c.runStatus,
        messages: c.messages.map((message) => ({ role: message.role, text: message.rawText })),
      }
    }, id)
    await writeFile(
      join(runDir, 'result.json'),
      JSON.stringify({ runtimeWasStubbed: false, ...result }, null, 2),
    )
    assert(
      result.runStatus === 'completed' &&
        result.messages.filter(
          (message) => message.role === 'assistant' && /QUEUE_(ONE|TWO|THREE)/.test(message.text),
        ).length === 3,
      'Real Runtime did not complete all three text turns',
    )
  } else {
    // Edit returns the original item to the composer and keeps the queue paused.
    await queue.locator('li').first().getByRole('button', { name: '编辑' }).click()
    assert((await composer.inputValue()) === messages[1], 'Editing lost the original text')
    await composer.fill('检查修改并运行验证')
    await composer.press('Enter')
    await queue.locator('li').first().getByRole('button', { name: '删除' }).click()
    assert((await queue.locator('li').count()) === 1, 'Delete did not remove only the target entry')
    await page.evaluate(async (id) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      useAgentStore.getState().finishStreamingMessage(id)
      await window.queueSmokeDispatch()
      useAgentStore.getState().finishStreamingMessage(id)
    }, id)
    await queue.waitFor({ state: 'hidden' })
    // Re-open two rows in the center layout and verify the controls fit.
    await page.evaluate(async (id) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      useAgentStore.getState().beginRun(id)
      useUIStore.getState().setAgentPanelMode('center', 'user')
    }, id)
    const centerComposer = page.locator('[data-agent-panel-runtime="local"] textarea').first()
    await centerComposer.fill('排队任务 A')
    await centerComposer.press('Enter')
    await centerComposer.fill('排队任务 B')
    await centerComposer.press('Enter')
    await page.screenshot({ path: join(runDir, 'queue-center.png') })
    const sent = await page.evaluate(() => window.queueSmokeSent)
    assert(
      sent.length === 1 && sent[0] === '检查修改并运行验证',
      'Wrong queued message was dispatched',
    )
    await writeFile(
      join(runDir, 'result.json'),
      JSON.stringify(
        {
          runtimeWasStubbed: true,
          checked: [
            'Enter enqueue',
            'FIFO display',
            'edit to composer',
            'delete',
            'queued send controller',
            'side and center layout',
          ],
          sent,
          runDir,
        },
        null,
        2,
      ),
    )
  }
  console.log(JSON.stringify({ ok: true, runtimeWasStubbed: !realRuntime, runDir }))
} catch (error) {
  await page?.screenshot({ path: join(runDir, 'failure.png') }).catch(() => {})
  console.error(JSON.stringify({ ok: false, error: error.message, runDir }))
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }
}
