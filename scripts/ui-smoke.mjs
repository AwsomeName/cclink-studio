#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const rootDir = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const logFile = process.env.CCLINK_STUDIO_LOG_FILE || '/tmp/cclink-studio-dev/cclink-studio-dev.log'
const keepRunning = process.argv.includes('--keep-running')
const uiReadyTimeoutMs = 30_000
const results = []
let startedBySmoke = false

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

function runRestart(action) {
  return execFileSync('bash', ['scripts/restart.sh', action], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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
    const page = pages.find((candidate) => candidate.url().startsWith('http://localhost:5173/'))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Renderer page http://localhost:5173/ not found')
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

async function createTabFromMenu(page, label) {
  await page.locator('.tab-new-button').first().click()
  const menu = page.locator('.tab-create-menu')
  await menu.waitFor({ timeout: 10_000 })
  await menu.locator('button', { hasText: label }).first().click()
}

async function main() {
  const statusOutput = runRestart('status')
  const wasRunning = statusOutput.includes('CCLink Studio is running')
  if (!wasRunning) {
    runRestart('start')
    startedBySmoke = true
  }

  const cdpPort = await waitForCdpPort()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const page = await findRendererPage(browser)
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })

  await runCheck('first screen has no login wall', async () => {
    await page.locator('.app-topbar').waitFor({ state: 'visible', timeout: uiReadyTimeoutMs })
    const primarySurface = page.locator('.workbench, .agent-panel-center-shell')
    await primarySurface.waitFor({ state: 'visible', timeout: uiReadyTimeoutMs })
    const text = await page.locator('body').innerText()
    assert(await page.locator('.main-window').isVisible(), 'main window is not visible')
    assert(
      !(await page.locator('.runtime-unavailable').count()),
      'runtime unavailable screen visible',
    )
    assert(await page.locator('.app-topbar').isVisible(), 'topbar is not visible')
    assert((await primarySurface.count()) === 1, 'expected exactly one primary work surface')
    assert(
      await primarySurface.isVisible(),
      'workbench or empty-session agent surface is not visible',
    )
    assert(!text.includes('登录 CCLink'), 'login copy should not block the shell')
    return 'main window ready'
  })

  await runCheck('activity bar switches local panels', async () => {
    await clickByTitle(page, '浏览器')
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === '浏览器',
      'browser panel missing',
    )
    await clickByTitle(page, 'Terminal')
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === 'Terminal',
      'terminal panel missing',
    )
    await clickByTitle(page, '文件')
    await page.waitForTimeout(200)
    const filesState = page
      .locator(
        '.project-files-empty, .project-files-section .file-tree-shell, .project-files-section .file-tree-loading, .project-files-section .file-tree-empty, .project-files-section > .project-panel-empty',
      )
      .first()
    await filesState.waitFor({ state: 'visible', timeout: 10_000 })
    return 'browser/terminal/files'
  })

  await runCheck('settings page opens and searches locally', async () => {
    await clickByTitle(page, '设置')
    await page.waitForSelector('.settings-page', { timeout: 10_000 })
    assert(
      await page.getByRole('heading', { name: '设置' }).isVisible(),
      'settings heading missing',
    )
    await page.locator('.settings-search input').fill('agent')
    await page.waitForTimeout(200)
    const agentSearchResult = page.locator('.settings-search-result', { hasText: 'Agent 后端' })
    assert(await agentSearchResult.isVisible(), 'settings search result missing')
    await agentSearchResult.click()
    await page.waitForTimeout(200)
    assert(
      await page.getByRole('heading', { name: 'Agent' }).isVisible(),
      'agent settings section missing',
    )
    return 'settings search'
  })

  await runCheck('tab create menu opens editor, browser, and terminal tabs', async () => {
    const initialEditorCount = await page.locator('.tab-title', { hasText: '未命名.md' }).count()
    await createTabFromMenu(page, 'Markdown 草稿')
    await page.waitForFunction(
      (count) =>
        Array.from(document.querySelectorAll('.tab-title')).filter((node) =>
          node.textContent?.includes('未命名.md'),
        ).length > count,
      initialEditorCount,
      { timeout: 10_000 },
    )
    assert(await page.locator('.markdown-editor-wrapper').count(), 'markdown editor did not open')

    const initialBrowserCount = await page.locator('.tab-title', { hasText: '浏览器' }).count()
    await page.locator('.tab-new-browser-button').click()
    await page.waitForFunction(
      (count) =>
        Array.from(document.querySelectorAll('.tab-title')).filter((node) =>
          node.textContent?.includes('浏览器'),
        ).length > count,
      initialBrowserCount,
      { timeout: 10_000 },
    )

    const initialTerminalCount = await page.locator('.tab-title', { hasText: 'Terminal' }).count()
    await createTabFromMenu(page, 'Terminal')
    await page.waitForFunction(
      (count) =>
        Array.from(document.querySelectorAll('.tab-title')).filter((node) =>
          node.textContent?.includes('Terminal'),
        ).length > count,
      initialTerminalCount,
      { timeout: 10_000 },
    )
    return 'editor/browser/terminal'
  })

  await runCheck('no paid or account UI appears during smoke', async () => {
    const text = await page.locator('body').innerText()
    const blockedCopy = ['登录 CCLink', '订阅', '配额', `Remote ${'Workspace'}`]
    assert(
      blockedCopy.every((item) => !text.includes(item)),
      'paid/account copy leaked into UI',
    )
    return 'clean UI boundary'
  })

  await browser.close()

  const failed = results.filter((result) => result.status === 'fail')
  if (startedBySmoke && !keepRunning) runRestart('stop')
  if (failed.length > 0) {
    console.error(`\nUI smoke failed: ${failed.length}/${results.length}`)
    process.exit(1)
  }
  console.log(`\nUI smoke passed: ${results.length}/${results.length}`)
}

main().catch((error) => {
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
