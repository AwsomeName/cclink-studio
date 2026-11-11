#!/usr/bin/env node
// Real Electron UI + a rejecting Codex protocol fixture; no live model credentials required.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const claudeFallback = process.argv.includes('--claude-fallback')
let requests = 0
const provider = claudeFallback
  ? createServer((_request, response) => {
      requests++
      response.writeHead(400, { 'content-type': 'application/json' })
      setTimeout(
        () =>
          response.end(
            JSON.stringify({
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message:
                  'API Error: [1301][系统检测到输入或生成内容可能包含不安全或敏感内容][local-smoke]',
              },
            }),
          ),
        2000,
      )
    })
  : null
if (provider) await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve))
const root = await mkdtemp(join(homedir(), '.cclink-studio-fallback-smoke-'))
const workspace = join(root, 'workspace')
await mkdir(workspace)
await mkdir(join(root, 'bin'))
await mkdir(join(root, 'codex-home'))
await mkdir(join(root, 'user-data'))
await writeFile(
  join(root, 'user-data/workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: {
      smoke: {
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
  join(root, 'bin/codex'),
  `#!${process.execPath}
const { createInterface } = require('node:readline')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line)
  if (id === undefined) return
  let result = {}
  if (method === 'account/read') result = { account: { type: 'chatgpt' }, requiresOpenaiAuth: true }
  if (method === 'config/read') result = { config: {} }
  if (method === 'thread/start') {
    if (params.sandbox !== 'read-only' || params.config['features.shell_tool'] !== false)
      throw new Error('Scheduled tools were not restricted')
    result = {
      thread: { id: 'fallback-fixture' }, modelProvider: 'openai',
      approvalPolicy: 'untrusted', approvalsReviewer: 'user',
      sandbox: { type: 'readOnly', networkAccess: false }
    }
  }
  if (method === 'mcpServerStatus/list') result = { data: [{ name: 'cclink_studio' }] }
  if (method === 'turn/start') {
    writeFileSync(join(process.env.CODEX_HOME, 'turn-started'), 'yes')
    result = { turn: { id: 'fallback-turn' } }
    setTimeout(() => emit({ method: 'turn/completed', params: {
      threadId: 'fallback-fixture', turn: { id: 'fallback-turn', status: 'failed',
        error: { message: 'API Error: [1301][系统检测到输入或生成内容可能包含不安全或敏感内容][local-smoke]' } }
    } }), 2000)
  }
  emit({ id, result })
})
`,
  { mode: 0o700 },
)
let app
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [resolve('out/main/index.js')],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: join(root, 'user-data'),
      CODEX_HOME: join(root, 'codex-home'),
      PATH: claudeFallback ? process.env.PATH : `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
    },
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  const configured = await page.evaluate(async (workspace) => {
    await window.cclinkStudio.workspaceState.listLocalWorkspaces()
    const resolved = await window.cclinkStudio.workspaceState.resolveLocalWorkspace(workspace)
    const active = await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(workspace)
    if (!resolved.valid || !active.success)
      throw new Error(`Workspace setup failed: ${JSON.stringify({ resolved, active })}`)
    return window.cclinkStudio.settings.set({
      recentWorkspacePaths: [workspace],
    })
  }, workspace)
  assert(configured.success, configured.error)
  if (provider) {
    const configuredClaude = await page.evaluate(async (apiBaseUrl) => {
      await window.cclinkStudio.settings.setSecret('apiKey', 'local-smoke-placeholder')
      return window.cclinkStudio.settings.set({ apiBaseUrl, modelName: 'claude-sonnet-4-6' })
    }, `http://127.0.0.1:${provider.address().port}`)
    assert(configuredClaude.success, JSON.stringify(configuredClaude.error))
  }
  console.log(
    claudeFallback
      ? 'Configured empty native Codex login + Claude local provider'
      : 'Configured isolated workspace and rejecting Codex fixture',
  )
  await page.reload()
  await page.waitForSelector('.main-window')
  await page.locator('[title="定时任务"]').first().click()
  await page.getByRole('button', { name: '新建定时任务', exact: true }).first().click()
  const taskTitle = '每日日志容错验收 · 用于验证窄侧栏的长任务名称'
  await page.getByLabel('任务名称', { exact: true }).fill(taskTitle)
  await page.getByLabel('任务内容').fill('初始化每日日志。未知事实留空，不要编造。')
  await page.getByLabel('结果保存方式').selectOption('workspace-file')
  await page.getByLabel('工作空间内目录').fill('日志')
  await page.getByLabel('文件名模板').fill('daily-{date}.md')
  await page.getByRole('button', { name: '填入每日日志模板', exact: true }).click()
  const template = await page.getByLabel('AI 失败时保存的 Markdown 模板（可选）').inputValue()
  assert(template.startsWith('今日体重：'))
  assert(template.includes('昨日收入：'))
  assert(template.includes('## 今日打卡'))
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('已保存，当前设备保持暂停', { exact: true }).waitFor({ timeout: 10_000 })
  const saved = await page.evaluate(
    (path) => window.cclinkStudio.scheduledTasks.list(path),
    workspace,
  )
  assert(saved.success)
  const taskId = saved.tasks[0].definition.id
  assert.equal(saved.tasks[0].definition.outputPolicy.failureTemplate, template)
  const row = page.locator('.scheduled-task-sidebar-row', { hasText: taskTitle })
  const runButton = row.locator('.scheduled-task-sidebar-run')
  await runButton.waitFor()
  assert(!(await runButton.isDisabled()), 'a paused local task should allow a manual run')
  await page.getByLabel('任务内容').fill('尚未保存的修改')
  await page.waitForFunction(() => document.querySelector('.scheduled-task-sidebar-run')?.disabled)
  assert.equal(await runButton.getAttribute('title'), '请先保存修改')
  await page.getByLabel('任务内容').fill('初始化每日日志。未知事实留空，不要编造。')
  await page.waitForFunction(() => !document.querySelector('.scheduled-task-sidebar-run')?.disabled)

  // Keep another detail tab active while starting the saved task from its list row.
  await page.locator('[aria-label="新建定时任务"]').click()
  await page.getByLabel('任务名称', { exact: true }).fill('当前详情必须保持不变')
  const activeTabBefore = await page.locator('.tab.active').innerText()
  const tabCountBefore = await page.locator('.tab').count()
  await runButton.evaluate((button) => {
    button.click()
    button.click()
  })
  await page.waitForFunction(() => {
    const button = document.querySelector('.scheduled-task-sidebar-run')
    return button?.disabled && /启动中|排队中|运行中/.test(button.textContent)
  })
  assert.equal(await page.locator('.tab.active').innerText(), activeTabBefore)
  assert.equal(await page.locator('.tab').count(), tabCountBefore)
  assert.equal(
    await page.getByLabel('任务名称', { exact: true }).inputValue(),
    '当前详情必须保持不变',
  )
  await page.waitForFunction(() => {
    const button = document.querySelector('.scheduled-task-sidebar-run')
    return button?.disabled && /运行中/.test(button.textContent)
  })
  await runButton.evaluate((button) => button.click())
  const runningHistory = await page.evaluate(
    ({ workspace, taskId }) => window.cclinkStudio.scheduledTasks.listRuns(workspace, taskId),
    { workspace, taskId },
  )
  assert.equal(runningHistory.runs.length, 1, 'repeated list clicks started more than one run')
  const layout = await row.evaluate((element) => {
    const button = element.querySelector('.scheduled-task-sidebar-run').getBoundingClientRect()
    const title = element.querySelector('strong').getBoundingClientRect()
    return {
      rowRight: element.getBoundingClientRect().right,
      buttonRight: button.right,
      buttonLeft: button.left,
      titleRight: title.right,
      titleOverflow: getComputedStyle(element.querySelector('strong')).textOverflow,
    }
  })
  assert(layout.buttonRight <= layout.rowRight, 'run button overflows the sidebar')
  assert(layout.titleRight <= layout.buttonLeft, 'long title overlaps the run button')
  assert.equal(layout.titleOverflow, 'ellipsis')
  if (process.env.CCLINK_STUDIO_SIDEBAR_SCREENSHOT) {
    await page.screenshot({ path: process.env.CCLINK_STUDIO_SIDEBAR_SCREENSHOT })
  }
  const deadline = Date.now() + 90_000
  let run
  while (Date.now() < deadline) {
    const history = await page.evaluate(
      ({ workspace, taskId }) => window.cclinkStudio.scheduledTasks.listRuns(workspace, taskId),
      { workspace, taskId },
    )
    run = history.runs[0]
    if (run && !['queued', 'running'].includes(run.status)) break
    await page.waitForTimeout(300)
  }
  console.log('Terminal:', JSON.stringify({ status: run?.status, error: run?.error }))
  if (run?.artifact && run.status !== 'failed') {
    console.log(
      'Unexpected artifact:',
      (await readFile(join(workspace, run.artifact.relativePath), 'utf8')).slice(0, 800),
    )
  }
  assert.equal(run?.status, 'failed')
  assert(run.artifact, JSON.stringify(run.error))
  assert.equal(run.error.code, 'SCHEDULED_TASK_CONTENT_REJECTED')
  if (claudeFallback)
    assert(requests > 0, 'Configured Claude provider must receive the fallback request')
  else assert.equal(await readFile(join(root, 'codex-home/turn-started'), 'utf8'), 'yes')
  const status = await page.evaluate(
    (id) => window.cclinkStudio.agent.getStatus(id),
    run.conversationId,
  )
  assert.equal(status.runtimeBinding.kind, claudeFallback ? 'claude-code' : 'codex')
  console.log(`PASS actual selected Agent: ${status.runtimeBinding.kind}`)
  const content = await readFile(join(workspace, run.artifact.relativePath), 'utf8')
  assert(content.startsWith(template.trim()))
  assert(content.includes('本次 AI 补充失败，仅保存预设模板'))
  assert(!content.includes('[1301]'))
  await page.waitForFunction(() => !document.querySelector('.scheduled-task-sidebar-run')?.disabled)
  assert.equal(await page.locator('.tab.active').innerText(), activeTabBefore)
  assert.equal(
    await page.getByLabel('任务名称', { exact: true }).inputValue(),
    '当前详情必须保持不变',
  )
  await row.locator('.scheduled-task-sidebar-item').click()
  await page.getByText('模板已保存，AI 补充失败；可打开文件继续填写', { exact: true }).waitFor()
  await page.getByRole('button', { name: `打开 ${run.artifact.relativePath}`, exact: true }).click()
  await page.getByText('今日体重：', { exact: false }).first().waitFor()
  console.log(
    'PASS: sidebar run preserves active tab and draft, blocks repeated clicks and unsaved changes, fits a narrow row, restores after completion; daily fallback file verified and opened',
  )
} finally {
  if (app) await app.close()
  if (provider) await new Promise((resolve) => provider.close(resolve))
  await rm(root, { recursive: true, force: true })
}
