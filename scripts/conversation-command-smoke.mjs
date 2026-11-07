#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

// Use an isolated App profile; never restart the user's running Studio instance.
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR = await mkdtemp(join(tmpdir(), 'studio-command-run-smoke-'))
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= String(42000 + Math.floor(Math.random() * 1500))
const { runDir, logFile, rendererOrigin, rootDir } = createSmokeRuntime(import.meta.url)
const workspace = await mkdtemp(join(homedir(), '.cclink-studio-command-run-smoke-'))
const userData = join(runDir, 'user-data')
await mkdir(userData)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
  }),
)
await writeFile(
  join(userData, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: {
      'command-run-smoke': {
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
let browser
let runtimeChild

function startRuntime() {
  const fd = openSync(logFile, 'w')
  try {
    runtimeChild = spawn('bash', ['scripts/dev.sh'], {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
        CCLINK_STUDIO_RENDERER_PORT: new URL(rendererOrigin).port,
        CLAUDE_CONFIG_DIR: join(runDir, 'claude-config'),
      },
      detached: true,
      stdio: ['ignore', fd, fd],
    })
  } finally {
    closeSync(fd)
  }
}

async function stopRuntime() {
  if (!runtimeChild) return
  // Only stop this smoke's process group; restart.sh can reuse/stop the user's Studio.
  const pid = runtimeChild.pid
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // The isolated runtime already exited.
  }
  runtimeChild = null
}

function assert(value, message) {
  if (!value) throw new Error(message)
}
async function connect() {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const log = await readFile(logFile, 'utf8').catch(() => '')
    const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
    if (match) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${match[1]}`)
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith(rendererOrigin))
      if (page) {
        await page.waitForSelector('.main-window', { timeout: 30000 })
        return page
      }
      await browser.close()
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('Isolated Studio renderer did not become ready')
}

const results = []
let page
async function seedMessage(id, source, streaming = false) {
  await page.evaluate(
    async ({ id, source, streaming }) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const store = useAgentStore.getState()
      const conversation = store.conversations['command-run-smoke']
      const message = {
        id,
        role: 'assistant',
        content: [{ type: 'text', text: source }],
        rawText: source,
        timestamp: Date.now(),
        isStreaming: streaming,
      }
      useAgentStore.setState({
        conversations: {
          ...store.conversations,
          [conversation.id]: { ...conversation, messages: [message] },
        },
        messages: [message],
      })
    },
    { id, source, streaming },
  )
  await page.locator('.conversation-markdown-code-block').first().waitFor({ state: 'visible' })
}
async function sessions() {
  return page.evaluate(() => window.cclinkStudio.terminal.listSessions())
}
async function waitSession(messageId, predicate) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const session = (await sessions()).find((item) => item.codeBlockSource?.messageId === messageId)
    if (session && predicate(session)) return session
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Session condition failed: ${messageId}`)
}
function output(session) {
  return (session.outputBuffer ?? []).map((line) => line.text).join('')
}
async function activeTab() {
  return page.evaluate(async () => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    const state = useTabStore.getState()
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null
  })
}
async function waitForTerminalView(sessionId) {
  await page.waitForFunction(
    async (id) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const state = useTabStore.getState()
      const active = state.tabs.find((tab) => tab.id === state.activeTabId)
      return (
        active?.terminal?.sessionId === id &&
        Boolean(document.querySelector(`[data-terminal-session-id="${id}"] .xterm-helper-textarea`))
      )
    },
    sessionId,
    { timeout: 15000 },
  )
}

async function approve() {
  const button = page.getByRole('button', { name: '允许一次', exact: true })
  await button.waitFor({ state: 'visible' })
  await button.click()
}
async function run(id, command) {
  await seedMessage(id, `\`\`\`sh\n${command}\n\`\`\``)
  await page.getByRole('button', { name: '运行代码块', exact: true }).click()
}
async function terminalInput(text) {
  const input = page.locator('.xterm-helper-textarea').last()
  await input.waitFor({ state: 'attached' })
  await input.focus()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
function pass(name) {
  results.push({ name, status: 'pass' })
  console.log(`PASS ${name}`)
}

try {
  await writeFile(
    join(workspace, 'prompt.py'),
    "answer = input('Enter code: ')\nprint('ACK=' + answer, flush=True)\n",
  )
  await writeFile(
    join(workspace, 'password.py'),
    "import getpass\ngetpass.getpass('Password: ')\nprint('PASSWORD-ACCEPTED', flush=True)\n",
  )
  await writeFile(
    join(workspace, 'background.py'),
    "import time\nprint('BACKGROUND-START', flush=True)\ntime.sleep(3)\nprint('BACKGROUND-END', flush=True)\n",
  )
  startRuntime()
  page = await connect()
  await page.evaluate(async (path) => {
    const { openWorkspaceRef } =
      await import('/src/features/workspace-open/workspace-open-controller.ts')
    await openWorkspaceRef({ kind: 'local', path })
    const { useAgentStore } = await import('/src/stores/agent-store.ts')
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    useAgentStore.getState().createConversation({
      id: 'command-run-smoke',
      activate: true,
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: { kind: 'local', path },
      },
    })
    useUIStore.getState().setAgentPanelMode('right', 'user')
  }, workspace)

  await seedMessage('streaming', '```sh\npwd\n```', true)
  assert(
    await page.getByRole('button', { name: '运行代码块' }).isDisabled(),
    'Streaming command is executable',
  )
  await seedMessage('incomplete', '```sh\necho incomplete')
  assert(
    (await page.locator('.conversation-markdown-code-run').count()) === 0,
    'Incomplete command is executable',
  )
  await seedMessage('non-shell', '```ts\nconst value = 1\n```')
  assert(
    (await page.locator('.conversation-markdown-code-run').count()) === 0,
    'Non-shell code is executable',
  )
  pass('streaming / incomplete / non-shell blocks cannot run')

  const before = await activeTab()
  await seedMessage('background-pwd', '```sh\npwd\n```')
  // Two user clicks in one frame exercise the action's concurrency guard.
  await page.locator('.conversation-markdown-code-run').evaluate((button) => {
    button.click()
    button.click()
  })
  const pwd = await waitSession(
    'background-pwd',
    (s) => s.commandHistory?.length === 1 && output(s).includes(workspace),
  )
  assert((await activeTab())?.id === before?.id, 'Background run stole the workbench')
  assert(
    (await sessions()).filter((s) => s.codeBlockSource?.messageId === 'background-pwd').length ===
      1,
    'Duplicate session created',
  )
  await page.getByRole('button', { name: '查看终端代码块' }).waitFor()
  await page.screenshot({ path: join(runDir, 'background-command.png') })
  await page.getByRole('button', { name: '查看终端代码块' }).click()
  await page.locator('.xterm').waitFor()
  assert(
    (await activeTab()).terminal.sessionId === pwd.sessionId,
    'View did not attach the original PTY',
  )
  pass('pwd uses conversation cwd, stays in background, deduplicates and can be viewed')

  const originalTab = await activeTab()
  await run('background-long', 'python3 background.py')
  await approve()
  await waitSession('background-long', (s) => output(s).includes('BACKGROUND-END'))
  assert(
    (await activeTab()).id === originalTab.id,
    'Ordinary background command opened a new terminal',
  )
  pass('long command keeps running in background after permission approval')

  await run('dynamic-prompt', 'python3 prompt.py')
  await approve()
  const prompt = await waitSession('dynamic-prompt', (s) => output(s).includes('Enter code:'))
  await waitForTerminalView(prompt.sessionId)
  assert(
    (await activeTab())?.terminal?.sessionId === prompt.sessionId,
    'Dynamic prompt did not reveal its terminal',
  )
  await terminalInput('READY')
  await waitSession('dynamic-prompt', (s) => output(s).includes('ACK=READY'))
  await page.screenshot({ path: join(runDir, 'interactive-command.png') })
  pass('runtime input prompt opens the terminal and accepts real keyboard input')

  await run('password-prompt', 'python3 password.py')
  await approve()
  const password = await waitSession('password-prompt', (s) => output(s).includes('Password:'))
  await waitForTerminalView(password.sessionId)
  assert(
    (await activeTab())?.terminal?.sessionId === password.sessionId,
    'Password prompt did not reveal its terminal',
  )
  await terminalInput('studio-smoke-disposable-secret')
  const passwordDone = await waitSession('password-prompt', (s) =>
    output(s).includes('PASSWORD-ACCEPTED'),
  )
  assert(
    !JSON.stringify(passwordDone).includes('studio-smoke-disposable-secret'),
    'Raw password input was persisted',
  )
  pass('password prompt opens terminal; typed password is not persisted')

  await run('known-interactive', 'read answer; printf "READ=%s\\n" "$answer"')
  await approve()
  const read = await waitSession('known-interactive', (s) => s.status === 'running')
  await waitForTerminalView(read.sessionId)
  assert(
    (await activeTab())?.terminal?.sessionId === read.sessionId,
    'Silent interactive read did not open terminal',
  )
  await terminalInput('LOCAL')
  await waitSession('known-interactive', (s) => output(s).includes('READ=LOCAL'))
  pass('known interactive command opens terminal even without a prompt')

  await run('denied', 'mkdir denied-marker')
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  await page.getByRole('button', { name: '运行代码块', exact: true }).waitFor()
  const denied = await waitSession('denied', (s) => s.status === 'idle')
  assert(!denied.processId && !denied.commandHistory?.length, 'Denied command started a process')
  pass('permission rejection does not execute')

  await run('missing-directory', 'mkdir never-created')
  await page.getByRole('button', { name: '允许一次', exact: true }).waitFor()
  await rename(workspace, workspace + '-away')
  try {
    await approve()
    const failed = await waitSession('missing-directory', (s) => s.status === 'error')
    assert(!failed.processId, 'Missing cwd fell back to another directory')
    await page.screenshot({ path: join(runDir, 'failed-command.png') })
  } finally {
    await rename(workspace + '-away', workspace)
  }
  pass('directory removed during confirmation fails without a cwd fallback')

  await seedMessage('background-pwd', '```sh\npwd\n```')
  await page.evaluate(async () => {
    const { flushAgentConversationWorkspaceState } = await import('/src/stores/agent-store.ts')
    await flushAgentConversationWorkspaceState()
  })
  await page.reload()
  const restoredButton = page.locator('[data-code-command*="background-pwd"]')
  await restoredButton.waitFor({ timeout: 15000 })
  await restoredButton.click()
  assert(
    (await sessions()).find((s) => s.sessionId === pwd.sessionId)?.commandHistory.length === 1,
    'Reload reran the command',
  )
  pass('renderer reload recovers the original session without rerunning')
  await page.screenshot({ path: join(runDir, 'verified-studio.png') })
  console.log(JSON.stringify({ runDir, workspace, results }, null, 2))
} catch (error) {
  console.error(error)
  if (page) await page.screenshot({ path: join(runDir, 'failure.png') }).catch(() => {})
  console.error(`Evidence: ${runDir}`)
  process.exitCode = 1
} finally {
  if (page && !process.env.CCLINK_COMMAND_SMOKE_KEEP_OPEN)
    for (const session of await sessions().catch(() => [])) {
      await page
        .evaluate((id) => window.cclinkStudio.terminal.terminatePty(id), session.sessionId)
        .catch(() => {})
    }
  if (browser) await browser.close()
  if (!process.env.CCLINK_COMMAND_SMOKE_KEEP_OPEN) await stopRuntime()
  else runtimeChild?.unref()
}
