#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
let browser = null
let page = null
let workspacePath = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(previousLog, timeoutMs = 30_000) {
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
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`CDP port not found in ${logFile}`)
}

async function findRendererPage(timeoutMs = 20_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const found = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Studio renderer page not found')
}

async function waitForBrowserPage(url, timeoutMs = 10_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const found = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url() === url)
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Browser page not found: ${url}`)
}

async function browserTabCount() {
  return page.evaluate(async () => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    return useTabStore.getState().tabs.filter((tab) => tab.type === 'browser').length
  })
}

async function waitForNewBrowserTab(previousCount, timeoutMs = 10_000) {
  await page.waitForFunction(
    async (count) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      return useTabStore.getState().tabs.filter((tab) => tab.type === 'browser').length > count
    },
    previousCount,
    { timeout: timeoutMs },
  )
}

async function restoreSourceTab(sourceTabId) {
  await page.evaluate(async (tabId) => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    const store = useTabStore.getState()
    for (const tab of [...store.tabs]) {
      if (tab.type === 'browser' && tab.id !== tabId) store.closeTab(tab.id)
    }
    useTabStore.getState().activateTab(tabId)
  }, sourceTabId)
  await page.waitForFunction(async (tabId) => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    return useTabStore.getState().activeTabId === tabId
  }, sourceTabId)
}

async function main() {
  const initialLog = await readLog()
  runRestart('restart')
  const cdpPort = await waitForCdpPort(initialLog)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  page = await findRendererPage()
  await page.waitForSelector('.main-window', { timeout: 20_000 })

  const setup = await page.evaluate(async () => {
    const home = await window.cclinkStudio.fs.getHomePath()
    const path = `${home}/.cclink-studio-plain-link-smoke-${Date.now()}`
    const htmlPath = `${path}/plain-link.html`
    await window.cclinkStudio.fs.mkdir(path)
    await window.cclinkStudio.fs.writeFile(
      htmlPath,
      '<!doctype html><html><body style="margin: 0; overflow-x: hidden"><main style="width: 1800px; padding: 24px"><p>系统访问地址：<u><span id="plain-url" style="color: blue">https://example.com/plain-text-target</span></u>。</p><a id="real-link" href="#native-link">真实链接</a></main></body></html>',
    )
    const { useFsStore } = await import('/src/stores/fs-store.ts')
    const opened = await useFsStore.getState().openRecentWorkspace(path)
    if (!opened) return { opened: false, path, htmlPath }
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    const workspaceRef = { kind: 'local', path }
    useTabStore.getState().openTab({
      type: 'browser',
      title: '纯文本 URL smoke',
      icon: '🌐',
      initialUrl: `file://${htmlPath}`,
      workspaceRef,
      forceNew: true,
    })
    return { opened: true, path, htmlPath }
  })
  workspacePath = setup.path
  assert(setup.opened, `temporary workspace could not be opened: ${basename(setup.path)}`)

  const sourceUrl = `file://${setup.htmlPath}`
  const browserPage = await waitForBrowserPage(sourceUrl)
  const sourceTabId = await page.evaluate(() => window.cclinkStudio.browser.getActiveViewId())
  assert(sourceTabId, 'source Browser tab is not active')

  await page.evaluate((tabId) => window.cclinkStudio.browser.setZoom(tabId, 1), sourceTabId)
  await browserPage.mouse.move(300, 150)
  await browserPage.mouse.wheel(240, 0)
  await browserPage.waitForFunction(() => (document.scrollingElement?.scrollLeft ?? 0) > 0)
  await browserPage.evaluate(() => {
    if (document.scrollingElement) document.scrollingElement.scrollLeft = 0
  })
  console.log('PASS hidden horizontal overflow responds to trackpad-style wheel input')

  const nativeCount = await browserTabCount()
  await browserPage.locator('#real-link').click()
  await browserPage.waitForURL(`${sourceUrl}#native-link`)
  assert((await browserTabCount()) === nativeCount, 'real anchor was incorrectly forced into a tab')
  await browserPage.evaluate(() => history.replaceState(null, '', location.pathname))
  console.log('PASS real anchors keep native page behavior')

  let before = await browserTabCount()
  await browserPage.locator('#plain-url').click({ position: { x: 40, y: 8 } })
  await waitForNewBrowserTab(before)
  console.log('PASS direct click opens a new Browser tab')

  await restoreSourceTab(sourceTabId)
  before = await browserTabCount()
  await browserPage.locator('#plain-url').click({
    modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'],
    position: { x: 60, y: 8 },
  })
  await waitForNewBrowserTab(before)
  console.log('PASS Cmd/Ctrl + click opens a new Browser tab')

  await restoreSourceTab(sourceTabId)
  await browserPage.locator('#plain-url').click({ button: 'right', position: { x: 80, y: 8 } })
  const selected = await browserPage.evaluate(() => globalThis.getSelection()?.toString() ?? '')
  assert(selected === 'https://example.com/plain-text-target', `unexpected selection: ${selected}`)
  console.log('PASS right click exposes the exact URL to the native context menu')

  await browserPage.keyboard.press('Escape')
  await browserPage.mouse.click(8, 120, { button: 'right' })
  const staleSelection = await browserPage.evaluate(
    () => globalThis.getSelection()?.toString() ?? '',
  )
  assert(
    staleSelection === '',
    `plain-text URL selection leaked to another target: ${staleSelection}`,
  )
  console.log('PASS a later context menu cannot reuse a stale auto-selected URL')
}

try {
  await main()
} finally {
  await browser?.close().catch(() => {})
  runRestart('stop')
  if (workspacePath) await rm(workspacePath, { recursive: true, force: true })
}
