#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const baseRuntime = createSmokeRuntime(import.meta.url)
const fixtureRoot = await mkdtemp(join(homedir(), '.cclink-scheduled-task-sharing-'))
const workspaceA = join(fixtureRoot, 'computer-a', 'project')
const workspaceB = join(fixtureRoot, 'computer-b', 'cloned-project')
const remotePath = join(fixtureRoot, 'remote.git')
const rendererPort = Number(new URL(baseRuntime.rendererOrigin).port)
const runtimes = [createRuntime('computer-a'), createRuntime('computer-b')]
let activeRuntime = null
let browser = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function createRuntime(name) {
  const runDir = join(tmpdir(), `cclink-scheduled-task-sharing-${process.pid}-${name}`)
  const logFile = join(runDir, 'cclink-studio-dev.log')
  const env = {
    ...process.env,
    CCLINK_STUDIO_RUN_DIR: runDir,
    CCLINK_STUDIO_SCREEN_NAME: `cclink-sharing-${process.pid}-${name}`,
    CCLINK_STUDIO_DEV_PORTS: String(rendererPort),
    CCLINK_STUDIO_RENDERER_PORT: String(rendererPort),
    CCLINK_STUDIO_TEST_USER_DATA_PATH: join(runDir, 'user-data'),
  }
  return {
    name,
    runDir,
    logFile,
    initialized: false,
    run(action) {
      try {
        return execFileSync('bash', ['scripts/restart.sh', action], {
          cwd: baseRuntime.rootDir,
          env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        throw new Error(
          `${name} restart ${action} failed: ${String(error.stderr || error.message || error)}`,
        )
      }
    },
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

async function waitForCdpPort(runtime, previousLog = '', timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const completeLog = await readFile(runtime.logFile, 'utf8').catch(() => '')
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
  throw new Error(`CDP port not found for ${runtime.name}`)
}

async function start(runtime, workspacePath) {
  if (!runtime.initialized) {
    await rm(runtime.runDir, { recursive: true, force: true })
    await mkdir(join(runtime.runDir, 'user-data'), { recursive: true })
    await writeFile(
      join(runtime.runDir, 'user-data', 'workspace-state.json'),
      JSON.stringify({
        version: 2,
        workspaces: {},
        localWorkspaces: {
          smoke: {
            workspaceKey: workspacePath,
            workspacePath,
            ownerKey: null,
            updatedAt: Date.now(),
            storage: 'fallback',
            projectId: null,
          },
        },
      }),
      'utf8',
    )
    runtime.initialized = true
  }
  const previousLog = await readFile(runtime.logFile, 'utf8').catch(() => '')
  runtime.run('start')
  activeRuntime = runtime
  let cdpPort
  try {
    cdpPort = await waitForCdpPort(runtime, previousLog)
  } catch {
    // restart.sh may discover another dev Electron from this repository while switching the two
    // isolated runtimes. A forced retry makes this runtime own the renderer port and log again.
    runtime.run('restart')
    cdpPort = await waitForCdpPort(runtime)
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const page = await findRendererPage(browser)
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  const apiReadyStartedAt = Date.now()
  while (Date.now() - apiReadyStartedAt < 30_000) {
    const ready = await page.evaluate(async () => {
      try {
        await window.cclinkStudio.settings.getAll()
        await window.cclinkStudio.workspaceState.get()
        return true
      } catch {
        return false
      }
    })
    if (ready) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const configured = await page.evaluate(async (path) => {
    await window.cclinkStudio.workspaceState.listLocalWorkspaces()
    const resolved = await window.cclinkStudio.workspaceState.resolveLocalWorkspace(path)
    const active = await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(path)
    const settings = await window.cclinkStudio.settings.set({ recentWorkspacePaths: [path] })
    return { resolved, active, settings }
  }, workspacePath)
  assert(
    configured.resolved.valid &&
      configured.resolved.workspacePath === workspacePath &&
      configured.active.success &&
      configured.active.activeWorkspace?.workspacePath === workspacePath &&
      configured.settings.success,
    `${runtime.name} workspace setup failed: ${JSON.stringify(configured)}`,
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  return page
}

async function stop() {
  if (browser) await browser.close().catch(() => {})
  browser = null
  if (activeRuntime) activeRuntime.run('stop')
  activeRuntime = null
}

async function findRendererPage(connectedBrowser) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const page = connectedBrowser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(baseRuntime.rendererOrigin))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('renderer page not found')
}

async function waitForRuntime(page) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    const status = await page.evaluate(() => window.cclinkStudio.scheduledTasks.getRuntimeStatus())
    if (status.state === 'ready') return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('scheduled task runtime did not become ready')
}

async function waitForRun(page, workspacePath, taskId, timeoutMs = 180_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const result = await page.evaluate(
      ({ path, id }) => window.cclinkStudio.scheduledTasks.listRuns(path, id),
      { path: workspacePath, id: taskId },
    )
    assert(result.success, result.error?.message || 'run history failed')
    const run = result.runs[0]
    if (run && !['queued', 'running'].includes(run.status)) return run
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('shared task run timed out')
}

async function main() {
  await mkdir(workspaceA, { recursive: true })
  await writeFile(join(workspaceA, 'README.md'), '# Shared scheduled task smoke\n', 'utf8')
  git(fixtureRoot, ['init', '--bare', remotePath])
  git(workspaceA, ['init', '-b', 'main'])
  git(workspaceA, ['config', 'user.name', 'Smoke User'])
  git(workspaceA, ['config', 'user.email', 'smoke@example.com'])
  git(workspaceA, ['add', 'README.md'])
  git(workspaceA, ['commit', '-m', 'initial'])
  git(workspaceA, ['remote', 'add', 'origin', remotePath])

  const pageA = await start(runtimes[0], workspaceA)
  const savedA = await pageA.evaluate(
    (path) =>
      window.cclinkStudio.scheduledTasks.save({
        workspacePath: path,
        title: '跨电脑周报',
        instruction: '读取 README.md 并生成简短 Markdown 周报。',
        schedule: { kind: 'daily', time: '23:59', timezone: 'UTC' },
        resources: [{ kind: 'workspace' }, { kind: 'file', path: 'README.md' }],
        outputPolicy: {
          directory: '.cclink-studio/scheduled-task-results',
          fileNameTemplate: 'shared-{taskId}-{runId}.md',
          mode: 'create-only',
        },
        definitionSource: 'shared',
        enable: true,
      }),
    workspaceA,
  )
  assert(savedA.success && savedA.task.activation.enabled, 'computer A did not save shared task')
  const taskId = savedA.task.definition.id
  const sharedPath = `.cclink-studio/shared/scheduled-tasks/${taskId}.json`
  const sharedJson = await readFile(join(workspaceA, sharedPath), 'utf8')
  assert(!sharedJson.includes(workspaceA), 'computer A absolute path leaked into shared JSON')
  assert(
    git(workspaceA, ['status', '--porcelain', '--', sharedPath]).includes(sharedPath),
    'shared JSON is not visible to Git',
  )
  git(workspaceA, ['add', sharedPath])
  git(workspaceA, ['commit', '-m', 'share scheduled task'])
  git(workspaceA, ['push', '-u', 'origin', 'main'])
  await stop()

  await mkdir(join(fixtureRoot, 'computer-b'), { recursive: true })
  git(join(fixtureRoot, 'computer-b'), ['clone', remotePath, workspaceB])
  git(workspaceB, ['config', 'user.name', 'Smoke User'])
  git(workspaceB, ['config', 'user.email', 'smoke@example.com'])
  const pageB = await start(runtimes[1], workspaceB)
  const discoveredB = await pageB.evaluate(
    (path) => window.cclinkStudio.scheduledTasks.list(path),
    workspaceB,
  )
  assert(discoveredB.success && discoveredB.tasks.length === 1, 'computer B did not discover task')
  assert(
    discoveredB.tasks[0].definition.source === 'shared' &&
      discoveredB.tasks[0].definition.workspaceRef.path === workspaceB &&
      !discoveredB.tasks[0].activation.enabled,
    'computer B task was not rebound and paused by default',
  )
  await waitForRuntime(pageB)
  const blockedB = await pageB.evaluate(
    ({ path, id }) =>
      window.cclinkStudio.scheduledTasks.runNow({ workspacePath: path, taskId: id }),
    { path: workspaceB, id: taskId },
  )
  assert(
    !blockedB.success && blockedB.error?.code === 'SCHEDULED_TASK_CONFIRMATION_REQUIRED',
    'computer B ran the task before confirmation',
  )
  const enabledB = await pageB.evaluate(
    ({ path, id }) =>
      window.cclinkStudio.scheduledTasks.setEnabled({
        workspacePath: path,
        taskId: id,
        enabled: true,
      }),
    { path: workspaceB, id: taskId },
  )
  assert(
    enabledB.success &&
      enabledB.task.activation.confirmedTaskRevision === 1 &&
      enabledB.task.activation.confirmedExecutionDigest ===
        enabledB.task.definition.executionDigest,
    'computer B confirmation did not bind revision and digest',
  )
  const startedB = await pageB.evaluate(
    ({ path, id }) =>
      window.cclinkStudio.scheduledTasks.runNow({ workspacePath: path, taskId: id }),
    { path: workspaceB, id: taskId },
  )
  assert(startedB.success, startedB.error?.message || 'computer B run did not start')
  const completedB = await waitForRun(pageB, workspaceB, taskId)
  assert(completedB.status === 'completed', `computer B run ended as ${completedB.status}`)
  await stop()

  const pageAAgain = await start(runtimes[0], workspaceA)
  const stateA = await pageAAgain.evaluate(
    ({ path, id }) =>
      Promise.all([
        window.cclinkStudio.scheduledTasks.get(path, id),
        window.cclinkStudio.scheduledTasks.listRuns(path, id),
      ]),
    { path: workspaceA, id: taskId },
  )
  assert(stateA[0].task.activation.enabled, 'computer B changed computer A activation')
  assert(stateA[1].runs.length === 0, 'computer B history leaked into computer A userData')
  const updatedA = await pageAAgain.evaluate(
    ({ path, id }) =>
      window.cclinkStudio.scheduledTasks.save({
        workspacePath: path,
        taskId: id,
        expectedRevision: 1,
        title: '跨电脑周报',
        instruction: '读取 README.md 并生成更新后的简短 Markdown 周报。',
        schedule: { kind: 'daily', time: '23:59', timezone: 'UTC' },
        resources: [{ kind: 'workspace' }, { kind: 'file', path: 'README.md' }],
        outputPolicy: {
          directory: '.cclink-studio/scheduled-task-results',
          fileNameTemplate: 'shared-{taskId}-{runId}.md',
          mode: 'create-only',
        },
        definitionSource: 'shared',
        enable: true,
      }),
    { path: workspaceA, id: taskId },
  )
  assert(updatedA.success && updatedA.task.definition.revision === 2, 'computer A update failed')
  git(workspaceA, ['add', sharedPath])
  git(workspaceA, ['commit', '-m', 'update scheduled task'])
  git(workspaceA, ['push'])
  await stop()

  git(workspaceB, ['pull', '--ff-only'])
  const pageBAgain = await start(runtimes[1], workspaceB)
  const refreshedB = await pageBAgain.evaluate(
    (path) => window.cclinkStudio.scheduledTasks.list(path),
    workspaceB,
  )
  assert(
    refreshedB.success &&
      refreshedB.tasks[0].definition.revision === 2 &&
      !refreshedB.tasks[0].activation.enabled &&
      refreshedB.tasks[0].activation.suspensionReason === 'definition-changed',
    'computer B did not suspend after the Git-delivered update',
  )
  const blockedAfterUpdate = await pageBAgain.evaluate(
    ({ path, id }) =>
      window.cclinkStudio.scheduledTasks.runNow({ workspacePath: path, taskId: id }),
    { path: workspaceB, id: taskId },
  )
  assert(
    !blockedAfterUpdate.success &&
      blockedAfterUpdate.error?.code === 'SCHEDULED_TASK_CONFIRMATION_REQUIRED',
    'computer B reused stale confirmation after update',
  )
  const reconfirmedB = await pageBAgain.evaluate(
    ({ path, id }) =>
      window.cclinkStudio.scheduledTasks.setEnabled({
        workspacePath: path,
        taskId: id,
        enabled: true,
      }),
    { path: workspaceB, id: taskId },
  )
  assert(
    reconfirmedB.success && reconfirmedB.task.activation.confirmedTaskRevision === 2,
    'computer B could not confirm revision 2 before deletion',
  )
  await stop()

  const pageAForDelete = await start(runtimes[0], workspaceA)
  const deletedA = await pageAForDelete.evaluate(
    ({ path, id }) =>
      window.cclinkStudio.scheduledTasks.delete({
        workspacePath: path,
        taskId: id,
        expectedRevision: 2,
      }),
    { path: workspaceA, id: taskId },
  )
  assert(deletedA.success, deletedA.error?.message || 'computer A delete failed')
  git(workspaceA, ['add', sharedPath])
  git(workspaceA, ['commit', '-m', 'remove scheduled task'])
  git(workspaceA, ['push'])
  await stop()

  git(workspaceB, ['pull', '--ff-only'])
  const pageBAfterDelete = await start(runtimes[1], workspaceB)
  const removedB = await pageBAfterDelete.evaluate(
    ({ path, id }) =>
      Promise.all([
        window.cclinkStudio.scheduledTasks.list(path),
        window.cclinkStudio.scheduledTasks.listRuns(path, id),
      ]),
    { path: workspaceB, id: taskId },
  )
  assert(
    removedB[0].success &&
      removedB[0].tasks.length === 0 &&
      removedB[0].issues.some(
        (issue) => issue.taskId === taskId && issue.kind === 'definition-removed',
      ),
    'computer B did not expose the Git-delivered task deletion',
  )
  assert(
    removedB[1].success &&
      removedB[1].runs.some((run) => run.id === completedB.id && run.status === 'completed'),
    'computer B lost local run history after the shared definition was deleted',
  )

  console.log(
    `PASS scheduled task Git sharing - task=${taskId}, B-run=${completedB.id}, A-revision=2, B-suspended=definition-changed, B-removed=definition-removed`,
  )
}

try {
  await main()
} catch (error) {
  console.error(
    `FAIL scheduled task Git sharing - ${error.stack || error.message || String(error)}`,
  )
  process.exitCode = 1
} finally {
  await stop().catch(() => {})
  await Promise.all(runtimes.map((runtime) => rm(runtime.runDir, { recursive: true, force: true })))
  await rm(fixtureRoot, { recursive: true, force: true })
}
