#!/usr/bin/env node
import { readFile, rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const keepRunning = process.argv.includes('--keep-running')
const results = []
let startedBySmoke = false
let workspaceDir = null
let originalWorkspaceSettings = null
let pageRef = null
const workspaceDirsToCleanup = new Set()

function pass(name, detail = '') {
  results.push({ name, status: 'pass', detail })
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`)
}

function fail(name, error) {
  results.push({ name, status: 'fail', detail: error.message || String(error) })
  console.error(`FAIL ${name} - ${error.message || String(error)}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const log = await readLog()
    const portMatch =
      log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//) ||
      log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)
    if (portMatch) return portMatch[1]
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`CDP port not found in ${logFile}`)
}

async function findRendererPage(browser) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    const page = pages.find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Renderer page ${rendererOrigin}/ not found`)
}

async function runCheck(name, fn) {
  try {
    const detail = await fn()
    pass(name, detail)
  } catch (error) {
    fail(name, error)
  }
}

async function clickByTitle(page, title) {
  await page.locator(`[title="${title}"]`).first().click()
}

async function ensureSidebarVisible(page) {
  const expandButton = page.locator('[title="展开左侧栏"]').first()
  if ((await expandButton.count()) > 0) {
    await expandButton.click()
    await page.waitForTimeout(350)
  }
}

async function createTabFromMenu(page, label) {
  await page.locator('.tab-new-button').first().click()
  const menu = page.locator('.tab-create-menu')
  await menu.waitFor({ timeout: 10_000 })
  await menu.locator('button', { hasText: label }).first().click()
}

async function restoreWorkspaceSettings() {
  if (!pageRef || !originalWorkspaceSettings) return
  await pageRef.evaluate((settings) => window.cclinkStudio.settings.set(settings), {
    lastWorkspacePath: originalWorkspaceSettings.lastWorkspacePath,
    recentWorkspacePaths: originalWorkspaceSettings.recentWorkspacePaths,
  })
}

async function closeTemporaryWorkspaces() {
  if (!pageRef) return
  const smokeProjectPaths = await pageRef
    .locator('.project-strip-item')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute('data-project-path'))
        .filter((path) => path?.includes('/.cclink-studio-workflow-smoke-')),
    )

  for (const path of smokeProjectPaths) {
    workspaceDirsToCleanup.add(path)
    const projectItem = pageRef.locator(`.project-strip-item[data-project-path="${path}"]`).first()
    if ((await projectItem.count()) === 0) continue
    await projectItem.click({ button: 'right' })
    const closeAction = pageRef.locator('[data-context-action="project.close"]', {
      hasText: '关闭项目',
    })
    await closeAction.waitFor({ timeout: 10_000 })
    await closeAction.click()
    await pageRef.waitForFunction(
      (projectPath) =>
        !Array.from(document.querySelectorAll('.project-strip-item')).some(
          (element) => element.getAttribute('data-project-path') === projectPath,
        ),
      path,
      { timeout: 15_000 },
    )
  }
}

async function cleanupWorkspaceDir() {
  for (const path of workspaceDirsToCleanup) {
    let lastError = null
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
        const remaining = await stat(path).catch(() => null)
        if (!remaining) break
        lastError = new Error(`temporary workspace was recreated after cleanup attempt ${attempt}`)
      } catch (error) {
        lastError = error
      }
    }
    const remaining = await stat(path).catch(() => null)
    if (remaining) throw lastError ?? new Error(`failed to remove temporary workspace: ${path}`)
  }
}

async function main() {
  runRestart('restart')
  startedBySmoke = true

  const cdpPort = await waitForCdpPort()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const page = await findRendererPage(browser)
  pageRef = page
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.main-window', { timeout: 15_000 })

  let markdownPath = null
  let workspaceName = null

  await runCheck('prepare temporary local workspace', async () => {
    const setup = await page.evaluate(async () => {
      const settings = await window.cclinkStudio.settings.getAll()
      const home = await window.cclinkStudio.fs.getHomePath()
      const workspacePath = `${home}/.cclink-studio-workflow-smoke-${Date.now()}`
      const markdownPath = `${workspacePath}/notes.md`
      await window.cclinkStudio.fs.mkdir(workspacePath)
      await window.cclinkStudio.fs.writeFile(markdownPath, '# Workflow Smoke\n\ninitial')
      await window.cclinkStudio.fs.writeFile(`${workspacePath}/todo.txt`, 'todo')
      await window.cclinkStudio.fs.writeFile(
        `${workspacePath}/cclink-accounts.json`,
        JSON.stringify(
          {
            version: 1,
            platforms: [
              {
                id: 'smoke-platform',
                name: 'Smoke Platform',
                url: 'https://example.com',
                account: 'smoke',
                notes: 'Workflow smoke only',
                browserProfile: 'smoke-profile',
              },
            ],
          },
          null,
          2,
        ),
      )
      const recentWorkspacePaths = [
        workspacePath,
        ...settings.recentWorkspacePaths.filter((path) => path !== workspacePath),
      ].slice(0, 8)
      const result = await window.cclinkStudio.settings.set({
        lastWorkspacePath: '',
        recentWorkspacePaths,
      })
      return {
        result,
        workspacePath,
        markdownPath,
        original: {
          lastWorkspacePath: /cclink-studio-(workflow-)?smoke/.test(settings.lastWorkspacePath)
            ? ''
            : settings.lastWorkspacePath,
          recentWorkspacePaths: settings.recentWorkspacePaths.filter(
            (path) => !/cclink-studio-(workflow-)?smoke/.test(path),
          ),
        },
      }
    })
    assert(setup.result.success, setup.result.error || 'failed to persist smoke workspace setting')
    workspaceDir = setup.workspacePath
    workspaceDirsToCleanup.add(workspaceDir)
    markdownPath = setup.markdownPath
    workspaceName = basename(workspaceDir)
    originalWorkspaceSettings = setup.original
    return workspaceName
  })

  await runCheck('recent project opens the local workspace', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.main-window', { timeout: 15_000 })
    await ensureSidebarVisible(page)
    await clickByTitle(page, '历史项目')
    const projectItem = page.locator(`.project-history-item[title="${workspaceDir}"]`).first()
    await projectItem.waitFor({ timeout: 10_000 })
    await projectItem.click()
    await page
      .locator(`.project-strip-item.active[data-project-path="${workspaceDir}"]`)
      .waitFor({ timeout: 20_000 })
    return workspaceName
  })

  await runCheck('file tree opens markdown and editor saves changes', async () => {
    await ensureSidebarVisible(page)
    await clickByTitle(page, '文件')
    const fileItem = page.locator('.file-tree-item.file', { hasText: 'notes.md' }).first()
    await fileItem.waitFor({ timeout: 10_000 })
    await fileItem.evaluate((element) => element.click())
    await page.waitForSelector('.markdown-editor-wrapper', { timeout: 15_000 })
    const editor = page.locator('.tiptap').first()
    await editor.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.type('# Workflow Smoke\n\nsaved through editor')
    await page.locator('.toolbar-save').click()
    await page.waitForFunction(
      () => document.querySelector('.toolbar-save')?.textContent?.includes('已保存'),
      null,
      { timeout: 10_000 },
    )
    const file = await page.evaluate((path) => window.cclinkStudio.fs.readFile(path), markdownPath)
    assert(
      file.content.includes('saved through editor'),
      'saved markdown content not found on disk',
    )
    return 'notes.md saved'
  })

  await runCheck('browser tab is available from the workbench', async () => {
    await page.locator('.tab-new-browser-button').click()
    await page.waitForSelector('.browser-toolbar .url-input', { timeout: 15_000 })
    const url = await page.evaluate(() => window.cclinkStudio.browser.getCurrentURL('browser'))
    assert(typeof url === 'string', 'browser current URL should be readable')
    return url || 'blank'
  })

  await runCheck('workbench frame context actions bind the intended target', async () => {
    await ensureSidebarVisible(page)

    const verifyMouseAndKeyboardMenu = async (target, actionId) => {
      await target.click({ button: 'right' })
      await page.locator(`[data-context-action="${actionId}"]`).waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await target.focus()
      await page.keyboard.press('Shift+F10')
      await page.locator(`[data-context-action="${actionId}"]`).waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
    }

    const fileItem = page.locator('.file-tree-item.file', { hasText: 'todo.txt' }).first()
    if (!(await fileItem.isVisible())) await clickByTitle(page, '文件')
    await fileItem.waitFor({ timeout: 10_000 })
    await verifyMouseAndKeyboardMenu(fileItem, 'file.reveal')
    await fileItem.click({ button: 'right' })
    assert(
      (await page.locator('[data-context-action="file.trash"]').count()) === 1,
      'generic file trash action is missing',
    )
    await page.keyboard.press('Escape')

    const activity = page.locator('.activity-bar-icon[title="文件"]').first()
    await verifyMouseAndKeyboardMenu(activity, 'activity.open')
    await activity.click({ button: 'right' })
    assert(
      (await page.locator('[data-context-action="activity.sidebar"]').count()) === 1,
      'activity layout action is missing',
    )
    await page.keyboard.press('Escape')

    const sidebar = page.locator('.sidebar').first()
    const sidebarBox = await sidebar.boundingBox()
    assert(sidebarBox, 'sidebar bounds are unavailable')
    await sidebar.click({
      button: 'right',
      position: { x: 4, y: Math.max(4, sidebarBox.height - 4) },
    })
    await page.locator('[data-context-action="sidebar.hide"]').waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await sidebar.focus()
    await page.keyboard.press('Shift+F10')
    await page.locator('[data-context-action="sidebar.hide"]').waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')

    const layoutHandle = page.locator('[data-layout-area="sidebar"]').first()
    await verifyMouseAndKeyboardMenu(layoutHandle, 'layout.reset-size')

    const workspaceStatus = page.locator('[data-status-item="workspace"]')
    await verifyMouseAndKeyboardMenu(workspaceStatus, 'status.copy')
    await workspaceStatus.click({ button: 'right' })
    assert(
      (await page.locator('[data-context-action="status.diagnostics"]').count()) === 1,
      'workspace diagnostics action is missing',
    )
    await page.keyboard.press('Escape')

    const project = page.locator(`.project-strip-item[data-project-path="${workspaceDir}"]`).first()
    await verifyMouseAndKeyboardMenu(project, 'project.copy-path')
    await project.click({ button: 'right' })
    assert(
      (await page.locator('[data-context-action="project.diagnostics"]').count()) === 1,
      'project diagnostics action is missing',
    )
    await page.keyboard.press('Escape')

    const tab = page.locator('.tab').first()
    await verifyMouseAndKeyboardMenu(tab, 'tab.close-others')
    await tab.click({ button: 'right' })
    await page.locator('[data-context-action="tab.close-right"]').waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    return 'file/activity/status/project/tab'
  })

  await runCheck(
    'core content context actions bind editor, Terminal, and Agent targets',
    async () => {
      const editorTab = page.locator('.tab', { hasText: 'notes.md' }).first()
      await editorTab.click()
      const editor = page.locator('.tiptap').first()
      await editor.waitFor({ timeout: 10_000 })
      await editor.click({ button: 'right' })
      await page.locator('[data-context-action="editor.paste"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')

      const message = page.locator('.agent-message').first()
      await message.waitFor({ timeout: 10_000 })
      await message.click({ button: 'right' })
      await page.locator('[data-context-action="message.quote"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await message.focus()
      await page.keyboard.press('Shift+F10')
      await page.locator('[data-context-action="message.copy"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')

      await createTabFromMenu(page, 'Terminal')
      const terminal = page.locator('.terminal-pty-shell').first()
      await terminal.waitFor({ timeout: 15_000 })
      await terminal.click({ button: 'right' })
      await page.locator('[data-context-action="terminal.paste"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await terminal.focus()
      await page.keyboard.press('Shift+F10')
      await page.locator('[data-context-action="terminal.clear"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      return 'editor/message/terminal mouse+keyboard'
    },
  )

  await runCheck(
    'domain context actions bind Operations, Production, and Settings targets',
    async () => {
      const verifyMouseAndKeyboardMenu = async (target, mouseActionId, keyboardActionId) => {
        await target.click({ button: 'right' })
        await page.locator(`[data-context-action="${mouseActionId}"]`).waitFor({ timeout: 10_000 })
        await page.keyboard.press('Escape')
        await target.focus()
        await page.keyboard.press('Shift+F10')
        await page
          .locator(`[data-context-action="${keyboardActionId}"]`)
          .waitFor({ timeout: 10_000 })
        await page.keyboard.press('Escape')
      }

      await ensureSidebarVisible(page)
      await clickByTitle(page, '运营')
      const operationsPlatform = page.locator('[data-context-target="operations-platform"]').first()
      await operationsPlatform.waitFor({ timeout: 15_000 })
      await verifyMouseAndKeyboardMenu(
        operationsPlatform,
        'operations.prepare-session',
        'operations.open-config',
      )

      await clickByTitle(page, '生产')
      const production = page.locator('[data-context-target="production"]').first()
      await production.waitFor({ timeout: 15_000 })
      await verifyMouseAndKeyboardMenu(production, 'production.scan', 'production.copy-status')

      await clickByTitle(page, '设置')
      const setting = page.locator('[data-context-target="setting"]').first()
      await setting.waitFor({ timeout: 15_000 })
      await verifyMouseAndKeyboardMenu(setting, 'settings.copy-key', 'settings.reset-current')
      return 'operations/production/settings mouse+keyboard'
    },
  )

  await runCheck('terminal can execute a command in the local workspace', async () => {
    const result = await page.evaluate(async (workspacePath) => {
      const sessionId = `workflow-terminal-${Date.now()}`
      const runtime = {
        location: 'local',
        transport: 'local',
        backend: 'local-shell',
        workspaceRef: { kind: 'local', path: workspacePath },
        cwd: workspacePath,
      }
      const events = []
      const off = window.cclinkStudio.terminal.onExecutionEvent((event) => {
        if (event.sessionId === sessionId) events.push(event)
      })
      const started = await window.cclinkStudio.terminal.startPty({
        terminalSessionId: sessionId,
        runtime,
        size: { columns: 80, rows: 24 },
      })
      if (started.success) {
        const startedAt = Date.now()
        while (Date.now() - startedAt < 5000 && !events.some((event) => event.kind === 'started')) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        const promptStartedAt = Date.now()
        while (
          Date.now() - promptStartedAt < 5000 &&
          !events.some((event) => event.kind === 'output')
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        await window.cclinkStudio.terminal.writePty({
          terminalSessionId: sessionId,
          data: 'pwd\rprintf "workflow-smoke-terminal\\n"\rexit\r',
        })
      }
      const startedAt = Date.now()
      while (Date.now() - startedAt < 5000) {
        const output = events
          .filter((event) => event.kind === 'output')
          .map((event) => event.data)
          .join('')
        if (output.includes('workflow-smoke-terminal')) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      await window.cclinkStudio.terminal.terminatePty(sessionId)
      off()
      return { started, events }
    }, workspaceDir)
    assert(result.started.success, result.started.error || 'terminal failed to start')
    const output = result.events
      .filter((event) => event.kind === 'output')
      .map((event) => event.data)
      .join('')
    assert(output.includes('workflow-smoke-terminal'), 'terminal output missing marker')
    assert(output.includes(workspaceDir), `terminal did not run in smoke workspace: ${output}`)
    return `pid=${result.started.processId ?? 'unknown'}`
  })

  await closeTemporaryWorkspaces()
  await restoreWorkspaceSettings()
  await cleanupWorkspaceDir()
  await browser.close()

  const failed = results.filter((result) => result.status === 'fail')
  if (startedBySmoke && !keepRunning) runRestart('stop')
  if (failed.length > 0) {
    console.error(`\nWorkflow smoke failed: ${failed.length}/${results.length}`)
    process.exit(1)
  }
  console.log(`\nWorkflow smoke passed: ${results.length}/${results.length}`)
}

main().catch(async (error) => {
  try {
    await closeTemporaryWorkspaces()
  } catch {
    // best effort project close
  }
  try {
    await restoreWorkspaceSettings()
  } catch {
    // best effort restore
  }
  try {
    await cleanupWorkspaceDir()
  } catch (cleanupError) {
    console.error(`Workflow smoke cleanup failed: ${cleanupError.message || String(cleanupError)}`)
  }
  if (startedBySmoke && !keepRunning) {
    try {
      runRestart('stop')
    } catch {
      // best effort cleanup
    }
  }
  console.error(error)
  process.exit(1)
})
