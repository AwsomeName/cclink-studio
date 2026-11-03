#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

// Isolated Electron with injected Runtime failure events; no model-service requests.
const realRuntime = false
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR = await mkdtemp(
  join(tmpdir(), 'studio-compaction-recovery-'),
)
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= String(43500 + Math.floor(Math.random() * 1000))
const { runDir, logFile, rendererOrigin, rootDir } = createSmokeRuntime(import.meta.url)
const workspace = await mkdtemp(join(homedir(), '.cclink-studio-compaction-smoke-'))
const userData = join(runDir, 'user-data')
await mkdir(userData)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({ lastWorkspacePath: workspace, recentWorkspacePaths: [workspace] }),
)
let child
let browser
let page
const id = 'compaction-recovery-smoke'
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
    async ({ workspace, id }) => {
      const { openWorkspaceRef } =
        await import('/src/features/workspace-open/workspace-open-controller.ts')
      await openWorkspaceRef({ kind: 'local', path: workspace })
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      const { applyAgentErrorToStore } = await import('/src/bootstrap/use-agent-stream-events.ts')
      const store = useAgentStore.getState()
      store.createConversation({
        id,
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: { kind: 'local', path: workspace },
        },
      })
      store.renameConversation(id, '压缩失败前的旧会话')
      store.addUserMessage('保留的旧历史和任务目标', id)
      const runId = store.beginRun(id)
      applyAgentErrorToStore({
        conversationId: id,
        runId,
        operation: 'message',
        code: 'context_compaction_content_rejected',
        message:
          'Prompt is too long · automatic compaction failed: API Error: [1301][输入或生成内容可能包含不安全或敏感内容]',
      })
      useUIStore.getState().setAgentPanelMode('right', 'user')
    },
    { workspace, id },
  )
  const recover = page.getByRole('button', { name: '保留旧会话，新建对话继续', exact: true })
  await recover.waitFor({ state: 'visible' })
  const notice = page.locator('.agent-panel-notice').filter({ hasText: '上下文压缩失败' })
  assert(
    await notice
      .getByText('模型服务以内容安全或敏感内容为由拒绝了压缩请求', { exact: false })
      .isVisible(),
    'Classified cause is missing',
  )
  assert(
    (await notice.innerText()).includes('旧会话和消息已保留'),
    'Preservation guidance is missing',
  )
  assert(
    !(await page.locator('.agent-panel-header').innerText()).includes('连接错误'),
    'Misleading connection label remains',
  )
  await notice.locator('summary').click()
  assert(
    (await notice.locator('pre').innerText()).includes('[1301]'),
    'Original provider error is missing',
  )
  await page.screenshot({ path: join(runDir, 'failure-side.png') })
  await page.evaluate(async () => {
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    useUIStore.getState().setAgentPanelMode('center', 'user')
  })
  await recover.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(runDir, 'failure-center.png') })
  const before = await page.evaluate(async (id) => {
    const { useAgentStore } = await import('/src/stores/agent-store.ts')
    return JSON.stringify(useAgentStore.getState().conversations[id])
  }, id)
  await recover.click()
  await recover.waitFor({ state: 'hidden' })
  const result = await page.evaluate(
    async ({ id, before }) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const state = useAgentStore.getState()
      const fresh = state.conversations[state.activeConversationId]
      const preserved = JSON.stringify(state.conversations[id]) === before
      // Exercise the normal send controller with a capture-only Runtime, proving that old
      // history/session/attachments are absent without making any model-service request.
      const { createConversationRunController } =
        await import('/src/features/agent-conversations/conversation-run-controller.ts')
      let submitted
      const command = await createConversationRunController({
        conversationId: fresh.id,
        agentApi: {
          saveMessageImages: window.cclinkStudio.agent.saveMessageImages,
          sendMessage: async (conversationId, payload) => {
            submitted = payload
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
        },
      }).send('必要背景：修复诊断提示。下一步：检查恢复入口。')
      useAgentStore.getState().finishStreamingMessage(fresh.id)
      return {
        preserved,
        freshId: fresh.id,
        originalId: id,
        freshSession: fresh.sessionId,
        copiedHistory: fresh.messages.some((message) =>
          message.rawText.includes('保留的旧历史和任务目标'),
        ),
        automaticUserMessages: fresh.messages.filter((message) => message.role === 'user').length,
        command,
        submitted,
      }
    },
    { id, before },
  )
  assert(result.preserved, 'Recovery changed the source conversation')
  assert(result.freshId !== id && result.freshSession === null, 'Recovery reused the old session')
  assert(
    !result.copiedHistory && result.automaticUserMessages === 0,
    'Recovery copied or sent old history',
  )
  assert(result.command.status === 'accepted', 'New conversation could not submit a user message')
  assert(
    !JSON.stringify(result.submitted).includes('old-sdk-session'),
    'New send reused old Runtime session',
  )
  assert(
    !JSON.stringify(result.submitted).includes('保留的旧历史和任务目标'),
    'New send included old history',
  )
  await page.screenshot({ path: join(runDir, 'new-conversation.png') })
  await page.evaluate(async (id) => {
    const { useAgentStore } = await import('/src/stores/agent-store.ts')
    useAgentStore.getState().switchConversation(id)
  }, id)
  await recover.waitFor({ state: 'visible' })
  await writeFile(
    join(runDir, 'result.json'),
    JSON.stringify(
      {
        runtimeWasStubbed: true,
        checked: [
          'classified cause',
          'raw provider error',
          'side and center layout',
          'click recovery',
          'source preserved',
          'empty new session',
          'manual new send',
          'return to old conversation',
        ],
        ...result,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ ok: true, runtimeWasStubbed: true, runDir }))
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
