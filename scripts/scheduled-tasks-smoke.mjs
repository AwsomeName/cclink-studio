#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const workspacePath = join(
  homedir(),
  `.cclink-studio-scheduled-task-smoke-${process.pid}-${Date.now()}`,
)
let browser = null
let started = false

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(timeoutMs = 30_000, previousLog = '') {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const completeLog = await readLog()
    const log =
      previousLog && completeLog.startsWith(previousLog)
        ? completeLog.slice(previousLog.length)
        : completeLog
    const match =
      log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//) ||
      log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`CDP port not found in ${logFile}`)
}

async function findRendererPage() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Renderer page ${rendererOrigin}/ not found`)
}

async function openScheduledTaskPanel(page) {
  const current = await page.evaluate(() => ({
    active: document.querySelector('.activity-bar-icon.active')?.getAttribute('aria-label') ?? null,
    sidebarVisible: Boolean(document.querySelector('.sidebar')),
  }))
  if (current.active !== '定时任务' || !current.sidebarVisible) {
    await page.locator('[title="定时任务"]').first().click()
    await page.waitForTimeout(500)
  }
}

async function waitForTerminalRun(page, taskId, timeoutMs = 180_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const result = await page.evaluate(
      ({ path, id }) => window.cclinkStudio.scheduledTasks.listRuns(path, id),
      { path: workspacePath, id: taskId },
    )
    assert(result.success, result.error?.message || 'scheduled-task run history failed')
    const run = result.runs[0]
    if (run && !['queued', 'running'].includes(run.status)) return run
    await page.waitForTimeout(500)
  }
  throw new Error('scheduled task run did not reach a terminal state')
}

async function assertFileMissing(filePath, message) {
  try {
    await readFile(filePath, 'utf8')
    throw new Error(message)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

async function main() {
  await mkdir(workspacePath, { recursive: true })
  await writeFile(join(workspacePath, 'README.md'), '# Scheduled task smoke\n', 'utf8')
  runRestart('stop')
  await rm(join(dirname(logFile), 'user-data'), { recursive: true, force: true })
  await rm(logFile, { force: true })

  const previousLog = await readLog()
  runRestart('start')
  started = true
  browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${await waitForCdpPort(30_000, previousLog)}`,
  )
  let page = await findRendererPage()
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForSelector('.main-window', { timeout: 30_000 })

  const configured = await page.evaluate(async (path) => {
    const settings = await window.cclinkStudio.settings.set({
      lastWorkspacePath: path,
      recentWorkspacePaths: [path],
    })
    return settings.success
  }, workspacePath)
  assert(configured, 'failed to configure smoke workspace')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.main-window', { timeout: 30_000 })

  await openScheduledTaskPanel(page)
  const sidebarState = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar')
    return {
      visible: Boolean(sidebar),
      title: document.querySelector('.sidebar-header-title')?.textContent?.trim() ?? null,
      text: sidebar?.textContent?.trim().slice(0, 500) ?? null,
      activeActivity:
        document.querySelector('.activity-bar-icon.active')?.getAttribute('aria-label') ?? null,
    }
  })
  assert(
    sidebarState.activeActivity === '定时任务',
    `scheduled-task activity did not activate: ${JSON.stringify(sidebarState)}`,
  )
  assert(
    sidebarState.visible && sidebarState.title === '定时任务',
    `scheduled-task sidebar did not open: ${JSON.stringify(sidebarState)}`,
  )
  await page
    .locator(
      '.scheduled-task-sidebar-empty, .scheduled-task-sidebar-message, .scheduled-task-sidebar-list',
    )
    .first()
    .waitFor({ timeout: 10_000 })

  await page.locator('[aria-label="新建定时任务"]').click()
  await page.waitForSelector('.scheduled-task-tab', { timeout: 10_000 })
  await page.getByLabel('任务名称').fill('Smoke 每周工作总结')
  await page.getByLabel('任务内容').fill('读取当前工作空间资料，并生成 create-only Markdown 周报。')
  await page.getByRole('button', { name: '保存并在此设备启用' }).click()
  await page.getByText(/已在此设备启用/).waitFor({ timeout: 10_000 })

  const saved = await page.evaluate(
    (path) => window.cclinkStudio.scheduledTasks.list(path),
    workspacePath,
  )
  assert(saved.success, saved.error?.message || 'scheduled-task list failed')
  assert(saved.tasks.length === 1, `expected one task, got ${saved.tasks.length}`)
  assert(saved.tasks[0].definition.revision === 1, 'first revision should be 1')
  assert(saved.tasks[0].activation.enabled, 'task should be enabled on this device')

  const taskId = saved.tasks[0].definition.id
  await page.getByRole('button', { name: '立即运行' }).click()
  const run = await waitForTerminalRun(page, taskId)
  assert(
    run.status === 'completed',
    `scheduled task run failed: ${run.status} ${run.error?.code || ''} ${run.error?.message || ''}`,
  )
  assert(run.taskRevision === 1, 'run did not pin the saved revision')
  assert(run.artifact?.relativePath, 'completed run did not expose an artifact')
  const artifactContent = await readFile(join(workspacePath, run.artifact.relativePath), 'utf8')
  assert(artifactContent.trim().length > 0, 'generated Markdown is empty')
  await page.getByRole('button', { name: new RegExp(`打开 ${run.artifact.relativePath}`) }).click()
  await page
    .locator('.tab-title', { hasText: run.artifact.relativePath.split('/').at(-1) })
    .waitFor({
      timeout: 10_000,
    })

  await page.locator('.tab-title', { hasText: 'Smoke 每周工作总结' }).click()
  await page.getByRole('button', { name: '暂停' }).click()
  await page.getByText('已保存 · 此设备已暂停').waitFor({ timeout: 10_000 })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  await openScheduledTaskPanel(page)
  const taskRow = page.locator('.scheduled-task-sidebar-item', {
    hasText: 'Smoke 每周工作总结',
  })
  await taskRow.waitFor({ timeout: 10_000 })
  assert(
    (await taskRow.innerText()).includes('已在此设备暂停'),
    'paused activation was not restored',
  )
  await page.getByLabel('搜索定时任务').fill('不存在的任务')
  await page.getByText('没有符合条件的定时任务').waitFor({ timeout: 5_000 })
  await page.getByLabel('搜索定时任务').fill('')
  await page.getByLabel('筛选定时任务状态').selectOption('enabled')
  await page.getByText('没有符合条件的定时任务').waitFor({ timeout: 5_000 })
  await page.getByLabel('筛选定时任务状态').selectOption('paused')
  await taskRow.waitFor({ timeout: 5_000 })
  await taskRow.click()
  assert(
    (await page.locator('.tab-title', { hasText: 'Smoke 每周工作总结' }).count()) === 1,
    'opening a saved task created a duplicate logical tab',
  )

  const definition = JSON.parse(
    await readFile(
      join(workspacePath, '.cclink-studio', 'scheduled-tasks', `${taskId}.json`),
      'utf8',
    ),
  )
  assert(definition.workspaceRef.path === workspacePath, 'definition workspace binding mismatch')
  assert(!('enabled' in definition), 'device activation leaked into workspace definition')

  const outsideRejected = await page.evaluate((path) => {
    return window.cclinkStudio.scheduledTasks.save({
      workspacePath: path,
      title: 'Smoke 越界输出',
      instruction: '生成 Markdown。',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      resources: [{ kind: 'workspace' }],
      outputPolicy: {
        directory: '../outside',
        fileNameTemplate: 'escaped.md',
        mode: 'create-only',
      },
      enable: false,
    })
  }, workspacePath)
  assert(
    !outsideRejected.success && outsideRejected.error?.code === 'SCHEDULED_TASK_INVALID',
    'workspace traversal output was not rejected',
  )

  const unsupportedSaved = await page.evaluate((path) => {
    return window.cclinkStudio.scheduledTasks.save({
      workspacePath: path,
      title: 'Smoke 禁止 Terminal',
      instruction: '运行 Terminal 命令并生成 Markdown。',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      resources: [{ kind: 'workspace' }],
      outputPolicy: {
        directory: 'docs/定时任务',
        fileNameTemplate: 'terminal-must-not-run.md',
        mode: 'create-only',
      },
      enable: false,
    })
  }, workspacePath)
  assert(
    unsupportedSaved.success,
    unsupportedSaved.error?.message || 'unsupported task save failed',
  )
  await page.evaluate(
    ({ path, taskId: id }) =>
      window.cclinkStudio.scheduledTasks.runNow({ workspacePath: path, taskId: id }),
    { path: workspacePath, taskId: unsupportedSaved.task.definition.id },
  )
  const unsupportedRun = await waitForTerminalRun(page, unsupportedSaved.task.definition.id)
  assert(
    unsupportedRun.status === 'failed' && unsupportedRun.error?.message.includes('不支持 Terminal'),
    'unsupported Terminal action did not fail closed',
  )

  const cancelSaved = await page.evaluate((path) => {
    return window.cclinkStudio.scheduledTasks.save({
      workspacePath: path,
      title: 'Smoke 立即取消',
      instruction: '读取 README.md 并生成 Markdown。',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      resources: [{ kind: 'workspace' }],
      outputPolicy: {
        directory: 'docs/定时任务',
        fileNameTemplate: 'cancelled-must-not-exist.md',
        mode: 'create-only',
      },
      enable: false,
    })
  }, workspacePath)
  assert(cancelSaved.success, cancelSaved.error?.message || 'cancel task save failed')
  const cancelStarted = await page.evaluate(
    ({ path, taskId: id }) =>
      window.cclinkStudio.scheduledTasks.runNow({ workspacePath: path, taskId: id }),
    { path: workspacePath, taskId: cancelSaved.task.definition.id },
  )
  assert(cancelStarted.success, cancelStarted.error?.message || 'cancel task did not start')
  const cancelled = await page.evaluate(
    ({ path, runId }) =>
      window.cclinkStudio.scheduledTasks.cancelRun({ workspacePath: path, runId }),
    { path: workspacePath, runId: cancelStarted.run.id },
  )
  assert(cancelled.success && cancelled.run.status === 'cancelled', 'run did not cancel')

  const autoRunAt = Date.now() + 4_000
  const autoSaved = await page.evaluate(
    ({ path, runAt }) =>
      window.cclinkStudio.scheduledTasks.save({
        workspacePath: path,
        title: 'Smoke 到点自动执行',
        instruction: '读取 README.md 并生成一份简短的 Markdown 摘要。',
        schedule: { kind: 'once', runAt, timezone: 'UTC' },
        resources: [{ kind: 'workspace' }, { kind: 'file', path: 'README.md' }],
        outputPolicy: {
          directory: 'docs/定时任务',
          fileNameTemplate: 'auto-scheduled.md',
          mode: 'create-only',
        },
        enable: true,
      }),
    { path: workspacePath, runAt: autoRunAt },
  )
  assert(autoSaved.success, autoSaved.error?.message || 'failed to save automatic task')
  const autoRun = await waitForTerminalRun(page, autoSaved.task.definition.id)
  assert(
    autoRun.status === 'completed' && autoRun.trigger === 'scheduled',
    `automatic run failed: ${autoRun.status} ${autoRun.error?.message || ''}`,
  )
  assert(
    (await readFile(join(workspacePath, 'docs/定时任务/auto-scheduled.md'), 'utf8')).trim(),
    'automatic run did not create Markdown',
  )

  const exitRunAt = Date.now() + 4_000
  const exitSaved = await page.evaluate(
    ({ path, runAt }) =>
      window.cclinkStudio.scheduledTasks.save({
        workspacePath: path,
        title: 'Smoke 退出后不得执行',
        instruction: '读取 README.md 并生成 Markdown。',
        schedule: { kind: 'once', runAt, timezone: 'UTC' },
        resources: [{ kind: 'workspace' }],
        outputPolicy: {
          directory: 'docs/定时任务',
          fileNameTemplate: 'exit-should-not-exist.md',
          mode: 'create-only',
        },
        enable: true,
      }),
    { path: workspacePath, runAt: exitRunAt },
  )
  assert(exitSaved.success, exitSaved.error?.message || 'failed to save exit task')
  await browser.close()
  browser = null
  runRestart('stop')
  started = false
  await new Promise((resolve) => setTimeout(resolve, 6_000))
  await assertFileMissing(
    join(workspacePath, 'docs/定时任务/exit-should-not-exist.md'),
    'App exit task created a file while Studio was stopped',
  )
  assert(
    runRestart('status').includes('not running'),
    'Studio still has a managed background process after stop',
  )

  const restartLog = await readLog()
  runRestart('start')
  started = true
  browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${await waitForCdpPort(30_000, restartLog)}`,
  )
  page = await findRendererPage()
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  const missedRun = await waitForTerminalRun(page, exitSaved.task.definition.id, 30_000)
  assert(
    missedRun.status === 'missed',
    `exit occurrence did not reconcile to missed: ${missedRun.status}`,
  )
  const runtimeStatus = await page.evaluate(() =>
    window.cclinkStudio.scheduledTasks.getRuntimeStatus(),
  )
  assert(runtimeStatus.systemScheduler === 'none', 'unexpected system scheduler registration')
  await assertFileMissing(
    join(workspacePath, 'docs/定时任务/terminal-must-not-run.md'),
    'unsupported Terminal task created an artifact',
  )
  await assertFileMissing(
    join(workspacePath, 'docs/定时任务/cancelled-must-not-exist.md'),
    'cancelled task produced a late artifact',
  )

  console.log(
    `PASS scheduled task M8.2 - manual=${run.id}, automatic=${autoRun.id}, cancelled=${cancelStarted.run.id}, denied=${unsupportedRun.id}, missed=${missedRun.id}, artifact=${run.artifact.relativePath}, systemScheduler=none`,
  )
}

try {
  await main()
} catch (error) {
  console.error(`FAIL scheduled task M8.2 - ${error.message || String(error)}`)
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (started) {
    try {
      runRestart('stop')
    } catch {
      // The smoke result above is more actionable than a redundant shutdown error.
    }
  }
  await rm(workspacePath, { recursive: true, force: true })
}
