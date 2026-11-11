#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

// Real Electron + the existing native Codex file login. Uses two model turns,
// disposable workspace/userData, and no Claude API key or production task.
const runDir = await mkdtemp(join(tmpdir(), 'studio-scheduled-codex-'))
const workspace = await mkdtemp(join(homedir(), '.cclink-scheduled-codex-'))
const userData = join(runDir, 'user-data')
const marker = 'SCHEDULED_CODEX_READ_7319'
await mkdir(userData)
await writeFile(join(workspace, 'source.md'), marker)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
    componentSetupPageSeenVersion: 99,
    permissionMode: 'auto',
  }),
)
let app
let page
let mainOutput = ''
const result = { success: false, runDir }
async function waitForRun(taskId, expected = 'completed') {
  const deadline = Date.now() + 180_000
  let run
  while (Date.now() < deadline) {
    const history = await page.evaluate(
      ({ workspace, taskId }) => window.cclinkStudio.scheduledTasks.listRuns(workspace, taskId),
      { workspace, taskId },
    )
    assert(history.success, JSON.stringify(history.error))
    run = history.runs[0]
    if (run && !['queued', 'running'].includes(run.status)) break
    await page.waitForTimeout(500)
  }
  assert.equal(run?.status, expected, JSON.stringify(run?.error))
  const status = await page.evaluate(
    (id) => window.cclinkStudio.agent.getStatus(id),
    run.conversationId,
  )
  assert.equal(status.runtimeBinding.kind, 'codex')
  assert(status.sessionId, 'A real native Codex session must have been created')
  const content = await readFile(join(workspace, run.artifact.relativePath), 'utf8')
  assert(content.includes(marker), 'Generated Markdown must contain the file-only marker')
  const streams = await page.evaluate(() => window.__scheduledCodexStreams)
  assert(
    streams.some(
      (event) => event.runId === run.id && JSON.stringify(event).includes('editor_read'),
    ),
    'The run must use the restricted Studio read tool',
  )
  return { id: run.id, trigger: run.trigger, artifact: run.artifact.relativePath, runtime: 'codex' }
}
try {
  const env = { ...process.env, CCLINK_STUDIO_TEST_USER_DATA_PATH: userData }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  delete env.CCLINK_STUDIO_EXPERIMENTAL_AGENT_BACKEND
  app = await electron.launch({ args: [resolve('.')], env })
  app.process().stdout?.on('data', (chunk) => {
    mainOutput += chunk.toString()
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  await page.evaluate(() => {
    window.__scheduledCodexStreams = []
    window.cclinkStudio.agent.onStreamEvent((event) => window.__scheduledCodexStreams.push(event))
  })
  await app.evaluate(({ dialog }, workspace) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] })
  }, workspace)
  await page.getByRole('button', { name: '打开工作空间', exact: true }).click()
  await page.getByRole('button', { name: /本地文件夹/ }).click()
  await page.locator('[title="定时任务"]').first().click()
  await page.getByRole('button', { name: '新建定时任务', exact: true }).first().click()
  await page.getByLabel('任务名称', { exact: true }).fill('Codex 定时简报验收')
  await page
    .getByLabel('任务内容')
    .fill(
      '用 editor_read 读取工作空间 source.md，把文件中的标记作为 Markdown 正文原样返回。不要使用其他工具。',
    )
  await page.getByLabel('结果保存方式').selectOption('workspace-file')
  await page.getByLabel('工作空间内目录').fill('reports')
  await page.getByLabel('文件名模板').fill('manual.md')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('已保存，当前设备保持暂停', { exact: true }).waitFor()
  const saved = await page.evaluate(
    (path) => window.cclinkStudio.scheduledTasks.list(path),
    workspace,
  )
  assert(saved.success)
  const task = saved.tasks[0].definition
  await page.locator('.scheduled-task-sidebar-run').click()
  result.manual = await waitForRun(task.id)
  assert.equal(result.manual.trigger, 'manual')
  await page.screenshot({ path: join(runDir, 'manual-completed.png') })
  await page.getByRole('button', { name: `打开 ${result.manual.artifact}`, exact: true }).click()
  await page.getByText(marker, { exact: false }).first().waitFor()
  await page.screenshot({ path: join(runDir, 'artifact-opened.png') })
  console.log('PASS manual UI run, restricted editor_read and opened Markdown')

  const scheduled = await page.evaluate(
    ({ workspace, instruction }) =>
      window.cclinkStudio.scheduledTasks.save({
        workspacePath: workspace,
        title: 'Codex 到点简报验收',
        instruction,
        schedule: { kind: 'once', runAt: Date.now() + 3_000, timezone: 'Asia/Shanghai' },
        resources: [{ kind: 'workspace' }, { kind: 'file', path: 'source.md' }],
        outputPolicy: {
          directory: 'reports',
          fileNameTemplate: 'scheduled.md',
          mode: 'create-only',
        },
        enable: true,
      }),
    { workspace, instruction: task.instruction },
  )
  assert(scheduled.success, JSON.stringify(scheduled.error))
  result.scheduled = await waitForRun(scheduled.task.definition.id)
  assert.equal(result.scheduled.trigger, 'scheduled')
  await page.locator('.scheduled-task-sidebar-item', { hasText: 'Codex 到点简报验收' }).click()
  await page
    .getByRole('button', { name: `打开 ${result.scheduled.artifact}`, exact: true })
    .waitFor()
  await page.screenshot({ path: join(runDir, 'scheduled-completed.png') })
  if (process.argv.includes('--internal-tasks')) {
    const sourcePath = join(workspace, 'video-source.md')
    await writeFile(
      sourcePath,
      '# 测试视频\n\n演示在工作空间记录每日工作：先读取原稿，再整理成简短摘要。只使用这些事实。',
    )
    const created = await page.evaluate(
      (input) => window.cclinkStudio.mediaProjects.create(input),
      {
        workspacePath: workspace,
        sourcePath,
        platform: 'web',
        aspectRatio: '16:9',
        targetDurationSeconds: 15,
      },
    )
    assert(created.success, JSON.stringify(created.error))
    const storyboard = await page.evaluate(
      (input) => window.cclinkStudio.mediaProjects.proposeStoryboard(input),
      {
        workspacePath: workspace,
        project: created.project,
      },
    )
    assert(storyboard.success, JSON.stringify(storyboard.error))
    assert(storyboard.proposal.scenes.length >= 2)
    result.storyboardScenes = storyboard.proposal.scenes.length
    console.log('PASS real Codex internal storyboard proposal')
    const narration = await page.evaluate(
      (input) => window.cclinkStudio.mediaProjects.generateNarration(input),
      {
        workspacePath: workspace,
        projectId: created.project.id,
        expectedRevision: created.project.revision,
        mode: 'generate',
      },
    )
    assert(narration.success, JSON.stringify(narration.error))
    assert.equal(narration.project.narration.generation.status, 'succeeded')
    assert(narration.project.narration.proposal.segments.length > 0)
    result.narrationSegments = narration.project.narration.proposal.segments.length
    console.log('PASS real Codex internal narration proposal')
    const csvPath = join(workspace, 'test-transactions.csv')
    await writeFile(
      csvPath,
      '交易时间,收支类型,金额,账户,交易对方,备注,交易单号\n2026-11-11 10:20:00,支出,10.00,测试账户,文具店,办公文具,TEST-001\n',
    )
    const initialized = await page.evaluate(() =>
      window.cclinkStudio.companyAccounts.initialize('2026-11'),
    )
    assert(initialized.success, JSON.stringify(initialized.error))
    const imported = await page.evaluate(
      (file) =>
        window.cclinkStudio.companyAccounts.importFiles({ month: '2026-11', filePaths: [file] }),
      csvPath,
    )
    assert(imported.success, JSON.stringify(imported.error))
    const snapshot = await page.evaluate(() =>
      window.cclinkStudio.companyAccounts.getSnapshot('2026-11'),
    )
    assert(snapshot.success)
    const record = snapshot.data.records[0]
    assert(record)
    const classified = await page.evaluate(
      (id) => window.cclinkStudio.companyAccounts.proposeRecord(id),
      record.id,
    )
    assert(classified.success, JSON.stringify(classified.error))
    assert(classified.data.category)
    result.accountClassification = 'proposal returned; no confirmation or posting'
    for (const purpose of [
      'media-storyboard',
      'media-narration',
      'company-accounts-classification',
    ]) {
      assert(
        mainOutput
          .split('\n')
          .some(
            (line) =>
              line.includes(`conversation=internal-${purpose}-`) && line.includes('selected=codex'),
          ),
        `Missing actual selection evidence for ${purpose}`,
      )
    }
    console.log('PASS real Codex internal account classification proposal')
  }
  result.success = true
  await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await page?.screenshot({ path: join(runDir, 'failure.png') }).catch(() => {})
  await writeFile(join(runDir, 'failure.txt'), String(error))
  console.error('Scheduled Codex smoke failed', runDir, error)
  process.exitCode = 1
} finally {
  await app?.close()
  await rm(workspace, { recursive: true, force: true })
}
