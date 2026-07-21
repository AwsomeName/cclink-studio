#!/usr/bin/env node
import { rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const keepRunning = process.argv.includes('--keep-running')
const results = []
let startedBySmoke = false
let browserRef = null
let pageRef = null
let workspaceDir = null
let originalWorkspaceSettings = null

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

async function connectRenderer() {
  const cdpPort = await waitForCdpPort()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const page = await findRendererPage(browser)
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.main-window', { timeout: 15_000 })
  browserRef = browser
  pageRef = page
  return { browser, page }
}

async function closeRenderer() {
  if (!browserRef) return
  await browserRef.close().catch(() => {})
  browserRef = null
  pageRef = null
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

async function restoreWorkspaceSettings() {
  if (!pageRef || !originalWorkspaceSettings) return
  await pageRef.evaluate((settings) => window.cclinkStudio.settings.set(settings), {
    lastWorkspacePath: originalWorkspaceSettings.lastWorkspacePath,
    recentWorkspacePaths: originalWorkspaceSettings.recentWorkspacePaths,
  })
}

function cleanupWorkspaceDir() {
  if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true })
}

async function restartAndReconnect() {
  await closeRenderer()
  runRestart('restart')
  return connectRenderer()
}

async function main() {
  runRestart('restart')
  startedBySmoke = true

  const { page } = await connectRenderer()
  let workspaceName = null

  await runCheck('prepare persisted startup workspace', async () => {
    const setup = await page.evaluate(async () => {
      const settings = await window.cclinkStudio.settings.getAll()
      const home = await window.cclinkStudio.fs.getHomePath()
      const workspacePath = `${home}/cclink-studio-restore-smoke-${Date.now()}`
      await window.cclinkStudio.fs.mkdir(workspacePath)
      await window.cclinkStudio.fs.writeFile(
        `${workspacePath}/restored.md`,
        '# Restore Smoke\n\nstartup restore target',
      )
      const recentWorkspacePaths = [
        workspacePath,
        ...settings.recentWorkspacePaths.filter((path) => path !== workspacePath),
      ].slice(0, 8)
      const result = await window.cclinkStudio.settings.set({
        lastWorkspacePath: workspacePath,
        recentWorkspacePaths,
      })
      return {
        result,
        workspacePath,
        original: {
          lastWorkspacePath: /\/\.?cclink-studio-(workflow-|restore-)?smoke/.test(
            settings.lastWorkspacePath,
          )
            ? ''
            : settings.lastWorkspacePath,
          recentWorkspacePaths: settings.recentWorkspacePaths.filter(
            (path) => !/\/\.?cclink-studio-(workflow-|restore-)?smoke/.test(path),
          ),
        },
      }
    })
    assert(setup.result.success, setup.result.error || 'failed to persist last workspace')
    workspaceDir = setup.workspacePath
    workspaceName = basename(workspaceDir)
    originalWorkspaceSettings = setup.original
    return workspaceName
  })

  await runCheck('restart restores last workspace automatically', async () => {
    const { page: restoredPage } = await restartAndReconnect()
    try {
      await restoredPage.waitForFunction(
        async ({ name, path }) => {
          const titleRestored = document
            .querySelector('.app-topbar-title')
            ?.textContent?.includes(name)
          if (!titleRestored) return false
          const entries = await window.cclinkStudio.fs.readDir(path)
          return entries.some((entry) => entry.name === 'restored.md')
        },
        { name: workspaceName, path: workspaceDir },
        { timeout: 20_000 },
      )
    } catch (error) {
      const diagnostics = await restoredPage.evaluate(async (path) => {
        let entries = null
        let readDirError = null
        try {
          entries = await window.cclinkStudio.fs.readDir(path)
        } catch (err) {
          readDirError = err instanceof Error ? err.message : String(err)
        }
        const settings = await window.cclinkStudio.settings.getAll()
        return {
          title: document.querySelector('.app-topbar-title')?.textContent ?? '',
          bodyText: document.body.innerText.slice(0, 500),
          settingsLastWorkspacePath: settings.lastWorkspacePath,
          entries,
          readDirError,
        }
      }, workspaceDir)
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} ${JSON.stringify(diagnostics)}`,
      )
    }
    return workspaceName
  })

  await runCheck('restored file tree is usable without manual project open', async () => {
    await ensureSidebarVisible(pageRef)
    await clickByTitle(pageRef, '文件')
    const fileItem = pageRef.locator('.file-tree-item.file', { hasText: 'restored.md' }).first()
    await fileItem.waitFor({ timeout: 10_000 })
    await fileItem.evaluate((element) => element.click())
    await pageRef.waitForSelector('.markdown-editor-wrapper', { timeout: 15_000 })
    const title = await pageRef
      .locator('.tab-title', { hasText: 'restored.md' })
      .first()
      .innerText()
    assert(title.includes('restored.md'), 'restored markdown tab did not open')
    return 'restored.md opened'
  })

  await runCheck('startup restore keeps last workspace setting', async () => {
    const settings = await pageRef.evaluate(() => window.cclinkStudio.settings.getAll())
    assert(settings.lastWorkspacePath === workspaceDir, 'lastWorkspacePath was cleared on startup')
    assert(
      settings.recentWorkspacePaths.includes(workspaceDir),
      'restored workspace missing from recent projects',
    )
    return 'settings retained'
  })

  await restoreWorkspaceSettings()
  if (keepRunning || !startedBySmoke) {
    await restartAndReconnect()
    await closeRenderer()
  } else {
    await closeRenderer()
    runRestart('stop')
  }
  cleanupWorkspaceDir()

  const failed = results.filter((result) => result.status === 'fail')
  if (failed.length > 0) {
    console.error(`\nRestore smoke failed: ${failed.length}/${results.length}`)
    process.exit(1)
  }
  console.log(`\nRestore smoke passed: ${results.length}/${results.length}`)
}

main().catch(async (error) => {
  try {
    await restoreWorkspaceSettings()
  } catch {
    // best effort restore
  }
  await closeRenderer()
  cleanupWorkspaceDir()
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
