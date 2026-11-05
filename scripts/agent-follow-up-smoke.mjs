#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

// Isolated Electron using the existing local Claude configuration. No Runtime stubs.
// Default: stop and replace. --supplement: Cmd/Ctrl+Enter steers the same Run.
const supplement = process.argv.includes('--supplement')
const center = process.argv.includes('--center')
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR = await mkdtemp(join(tmpdir(), 'studio-follow-up-'))
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
const id = 'follow-up-smoke'
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
    async ({ workspace, id, center }) => {
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
      useUIStore.getState().setAgentPanelMode(center ? 'center' : 'right', 'user')
    },
    { workspace, id, center },
  )
  const composer = page.locator('[data-agent-panel-runtime="local"] textarea').first()
  await composer.waitFor({ state: 'visible' })

  await page.evaluate(() => {
    window.followUpRunEvents = []
    window.cclinkStudio.agent.onRunStatus((record) =>
      window.followUpRunEvents.push({ ...record, observedAt: Date.now() }),
    )
  })
  await composer.fill(
    '请使用 Bash 执行 sleep 30，等待结束后回复 ORIGINAL_DONE。仅执行这条等待命令，不读取或修改文件。',
  )
  await composer.press('Enter')
  await page.waitForFunction(
    async (id) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      return useAgentStore.getState().conversations[id]?.runStatus === 'running'
    },
    id,
    { timeout: 45000 },
  )
  await composer.fill('请只回复 QUEUE_B，不调用工具。')
  await composer.press('Enter')
  await composer.fill('请只回复 QUEUE_C，不调用工具。')
  await composer.press('Enter')
  const readyDeadline = Date.now() + 60000
  let ready = false
  while (Date.now() < readyDeadline) {
    ready = await page.evaluate(async (id) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const c = useAgentStore.getState().conversations[id]
      return Boolean(
        c.supplementSupported &&
        c.messages.some((m) => m.content.some((b) => b.type === 'tool_use')),
      )
    }, id)
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  assert(ready, 'Runtime supplement capability/tool boundary not reached')
  if (supplement) {
    await page.getByRole('button', { name: '暂停队列', exact: true }).click()
    await composer.fill(
      '补充当前任务：最终只回复 STEER_OK，不要回复 ORIGINAL_DONE，不要再调用新工具。',
    )
    await page.getByRole('button', { name: '更多发送方式' }).click()
    await page.screenshot({ path: join(runDir, 'supplement-menu.png') })
    await composer.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  } else {
    await composer.fill('请只回复 REPLACEMENT_OK，不调用工具。')
    await page.getByRole('button', { name: '更多发送方式' }).click()
    await page.screenshot({ path: join(runDir, 'follow-up-menu.png') })
    await page.getByRole('button', { name: '停止并执行这条', exact: false }).click()
  }
  await composer.fill('操作期间继续输入的草稿')
  const replacementDeadline = Date.now() + 120000
  let complete = false
  while (Date.now() < replacementDeadline) {
    complete = await page.evaluate(
      async ({ id, supplement }) => {
        const { useAgentStore } = await import('/src/stores/agent-store.ts')
        const c = useAgentStore.getState().conversations[id]
        return Boolean(
          c &&
          !c.loading &&
          c.messages.some(
            (m) =>
              m.role === 'assistant' &&
              (supplement ? /STEER_OK/ : /REPLACEMENT_OK/).test(m.rawText || ''),
          ),
        )
      },
      { id, supplement },
    )
    if (complete) break
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  const result = await page.evaluate(async (id) => {
    const { useAgentStore } = await import('/src/stores/agent-store.ts')
    const c = useAgentStore.getState().conversations[id]
    return {
      runStatus: c.runStatus,
      input: c.input,
      queued: c.queuedMessages.map((x) => x.content),
      pause: c.messageQueuePauseReason,
      messages: c.messages.map((m) => ({
        role: m.role,
        text: m.rawText,
        supplement: m.supplement,
      })),
      events: window.followUpRunEvents,
    }
  }, id)
  await writeFile(join(runDir, 'observed.json'), JSON.stringify(result, null, 2))
  assert(complete, 'Follow-up task did not complete')
  assert(
    result.queued.length === 2 &&
      result.queued[0].includes('QUEUE_B') &&
      result.queued[1].includes('QUEUE_C'),
    'Original queue not preserved',
  )
  assert(result.pause, 'Original queue not paused')
  assert(result.input === '操作期间继续输入的草稿', 'Later draft overwritten')
  if (supplement) {
    assert(
      result.messages.some((m) => m.supplement?.status === 'received'),
      'Supplement receipt missing',
    )
    assert(
      new Set(result.events.filter((e) => e.conversationId === id).map((e) => e.runId)).size === 1,
      'Supplement started another Studio Run',
    )
  } else {
    const cancelled = result.events.find((e) => e.conversationId === id && e.status === 'cancelled')
    const replacement = result.events.find(
      (e) => e.conversationId === id && e.status === 'running' && e.runId !== cancelled?.runId,
    )
    assert(
      cancelled && replacement && replacement.observedAt >= cancelled.observedAt,
      'Replacement preceded Runtime cancellation',
    )
    assert(
      result.messages.filter((m) => m.role === 'user' && m.text.includes('REPLACEMENT_OK'))
        .length === 1,
      'Replacement sent more than once',
    )
  }
  await page.screenshot({
    path: join(runDir, supplement ? 'supplement-complete.png' : 'replacement-complete.png'),
  })
  await writeFile(
    join(runDir, 'result.json'),
    JSON.stringify({ runtimeWasStubbed: false, supplement, center, ...result }, null, 2),
  )
  console.log(JSON.stringify({ ok: true, runtimeWasStubbed: false, runDir }))
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
