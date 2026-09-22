#!/usr/bin/env node
// Real Electron UI + local rejecting model endpoint; no live model credentials required.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from 'playwright-core'

const require = createRequire(import.meta.url)
const root = await mkdtemp(join(homedir(), '.cclink-studio-fallback-smoke-'))
const workspace = join(root, 'workspace')
await mkdir(workspace)
await mkdir(join(root, 'claude-config'))
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
let requests = 0
const server = createServer((_request, response) => {
  requests++
  response.writeHead(400, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'API Error: [1301][系统检测到输入或生成内容可能包含不安全或敏感内容][local-smoke]',
      },
    }),
  )
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
let app
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [resolve('out/main/index.js')],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: join(root, 'user-data'),
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
    },
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  const configured = await page.evaluate(
    async ({ workspace, apiBaseUrl }) => {
      await window.cclinkStudio.workspaceState.listLocalWorkspaces()
      const resolved = await window.cclinkStudio.workspaceState.resolveLocalWorkspace(workspace)
      const active = await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(workspace)
      if (!resolved.valid || !active.success)
        throw new Error(`Workspace setup failed: ${JSON.stringify({ resolved, active })}`)
      await window.cclinkStudio.settings.setSecret('apiKey', 'local-smoke-placeholder')
      return window.cclinkStudio.settings.set({
        recentWorkspacePaths: [workspace],
        apiBaseUrl,
        modelName: 'claude-sonnet-4-6',
      })
    },
    { workspace, apiBaseUrl: `http://127.0.0.1:${server.address().port}` },
  )
  assert(configured.success, configured.error)
  console.log('Configured isolated workspace and local provider')
  await page.reload()
  await page.waitForSelector('.main-window')
  await page.locator('[title="定时任务"]').first().click()
  await page.getByRole('button', { name: '新建定时任务', exact: true }).first().click()
  await page.getByLabel('任务名称').fill('每日日志容错验收')
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
  await page.getByRole('button', { name: '立即运行', exact: true }).click()
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
  console.log('Terminal:', JSON.stringify({ requests, status: run?.status, error: run?.error }))
  if (run?.artifact && run.status !== 'failed') {
    console.log(
      'Unexpected artifact:',
      (await readFile(join(workspace, run.artifact.relativePath), 'utf8')).slice(0, 800),
    )
  }
  assert.equal(run?.status, 'failed')
  assert(run.artifact, JSON.stringify(run.error))
  assert.equal(run.error.code, 'SCHEDULED_TASK_CONTENT_REJECTED')
  assert(requests > 0, 'local provider was not called')
  const content = await readFile(join(workspace, run.artifact.relativePath), 'utf8')
  assert(content.startsWith(template.trim()))
  assert(content.includes('本次 AI 补充失败，仅保存预设模板'))
  assert(!content.includes('[1301]'))
  await page.getByText('模板已保存，AI 补充失败；可打开文件继续填写', { exact: true }).waitFor()
  await page.getByRole('button', { name: `打开 ${run.artifact.relativePath}`, exact: true }).click()
  await page.getByText('今日体重：', { exact: false }).first().waitFor()
  console.log(
    'PASS: daily template saved via UI, local provider refusal, failed run with verified file, open file action',
  )
} finally {
  if (app) await app.close()
  await new Promise((done) => server.close(done))
  await rm(root, { recursive: true, force: true })
}
