#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

// Isolated userData and local fixture server; never uses the user's websites or login state.
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR ??= `/tmp/cclink-tab-pin-smoke-${Date.now()}`
process.env.CCLINK_STUDIO_SCREEN_NAME ??= `cclink-tab-pin-${Date.now()}`
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= '39871'
const runtime = createSmokeRuntime(import.meta.url)
let child
async function startApp() {
  const fd = openSync(runtime.logFile, 'w')
  child = spawn('bash', ['scripts/dev.sh'], {
    cwd: runtime.rootDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: join(runtime.runDir, 'user-data'),
      CCLINK_STUDIO_RENDERER_PORT: '39871',
    },
    detached: true,
    stdio: ['ignore', fd, fd],
  })
  closeSync(fd)
}
async function stopApp() {
  if (!child) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))])
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    /* already exited */
  }
  child = null
}
const fixtureDir = join(homedir(), `.cclink-tab-pin-smoke-${Date.now()}`)
const a = join(fixtureDir, 'workspace-a')
const b = join(fixtureDir, 'workspace-b')
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (req.url === '/' && !req.headers.cookie?.includes('tab_restore=kept')) {
    res.setHeader('Set-Cookie', 'tab_restore=kept; Max-Age=3600; Path=/')
  }
  res.end(
    '<!doctype html><title>Tab restore fixture</title><h1>网页恢复验收</h1><a href="/next">下一页</a>',
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
let browser
let page
async function connect() {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const log = await readFile(runtime.logFile, 'utf8').catch(() => '')
    const port = [...log.matchAll(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//g)].at(-1)?.[1]
    if (port) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
        page = browser
          .contexts()
          .flatMap((ctx) => ctx.pages())
          .find((candidate) => candidate.url().startsWith(runtime.rendererOrigin))
        if (page) {
          await page.waitForSelector('.main-window', { timeout: 20000 })
          return
        }
        await browser.close()
      } catch {
        /* startup retry */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Renderer unavailable: ${runtime.logFile}`)
}
async function openWorkspace(path) {
  await page.evaluate(async (path) => {
    const { openWorkspaceRef } =
      await import('/src/features/workspace-open/workspace-open-controller.ts')
    await openWorkspaceRef({ kind: 'local', path })
  }, path)
}
async function tabSnapshot() {
  return page.evaluate(
    async () => (await import('/src/stores/tab-store.ts')).useTabStore.getState().tabs,
  )
}
async function contextAction(id, action) {
  await page.locator(`[data-workbench-tab-id="${id}"]`).click({ button: 'right' })
  await page.locator(`[data-context-action="${action}"]`).click()
}
async function flush() {
  await page.evaluate(async () => {
    await (await import('/src/utils/workspace-runtime.ts')).persistRuntimeSections()
    await (await import('/src/utils/workbench-tab-model.ts')).flushPendingWorkbenchTabWrites()
  })
}
try {
  await mkdir(join(runtime.runDir, 'user-data'), { recursive: true })
  await mkdir(a, { recursive: true })
  await mkdir(b, { recursive: true })
  await writeFile(
    join(runtime.runDir, 'user-data', 'workspace-state.json'),
    JSON.stringify({
      version: 2,
      workspaces: {},
      localWorkspaces: Object.fromEntries(
        [a, b].map((path, index) => [
          String(index),
          {
            workspaceKey: path,
            workspacePath: path,
            ownerKey: null,
            updatedAt: Date.now(),
            storage: 'fallback',
            projectId: null,
          },
        ]),
      ),
    }),
  )
  await startApp()
  await connect()
  await openWorkspace(a)
  const opened = await page.evaluate(
    async ({ a, url }) => {
      const { openDefaultBrowserTab } =
        await import('/src/features/web-resources/open-default-browser-tab.ts')
      return openDefaultBrowserTab(
        { kind: 'local', path: a },
        { initialUrl: url, title: '保留网页' },
      )
    },
    { a, url },
  )
  assert.equal(opened.saveable, true, opened.error)
  const id = opened.tabId
  await page.waitForFunction(async (id) => {
    const { useBrowserStore } = await import('/src/stores/browser-store.ts')
    return useBrowserStore.getState().tabs[id]?.title === 'Tab restore fixture'
  }, id)
  await browser.close()
  await connect()
  let webPage = browser
    .contexts()
    .flatMap((ctx) => ctx.pages())
    .find((candidate) => candidate.url().startsWith(url))
  assert(
    webPage,
    `real Browser WebContentsView created: ${browser
      .contexts()
      .flatMap((ctx) => ctx.pages())
      .map((p) => p.url())
      .join(', ')}`,
  )
  await webPage.goto(`${url}/next`)
  assert(
    (await webPage.evaluate(() => document.cookie)).includes('tab_restore=kept'),
    'fixture cookie exists before restart',
  )
  const binding = (await tabSnapshot()).find((tab) => tab.id === id)
  // Verify the original bug without pinning first.
  await openWorkspace(b)
  await page.locator(`[data-project-path="${a}"]`).click()
  await page.locator(`[data-workbench-tab-id="${id}"]`).waitFor()
  assert.equal(
    (await tabSnapshot()).find((tab) => tab.id === id).browserProfile,
    binding.browserProfile,
  )
  console.log('PASS ordinary draft-backed browser survives workspace A → B → A')
  await contextAction(id, 'tab.pin')
  await page.locator(`[data-workbench-tab-id="${id}"].pinned`).waitFor()
  const editorId = await page.evaluate(async () => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    useTabStore.getState().openTab({ type: 'editor', title: '固定笔记', icon: '📄' })
    return useTabStore.getState().activeTabId
  })
  await contextAction(editorId, 'tab.pin')
  await page.locator(`[data-workbench-tab-id="${editorId}"].pinned`).waitFor()
  await page.evaluate(async () => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    useTabStore
      .getState()
      .openTab({ type: 'editor', title: '临时笔记', icon: '📄', forceNew: true })
  })
  await contextAction(editorId, 'tab.close-others')
  assert((await tabSnapshot()).some((tab) => tab.id === id && tab.pinned))
  console.log('PASS browser and editor pin through real context menus; bulk close protects pins')
  await flush()
  const appExited = new Promise((resolve) => child.once('exit', resolve))
  await page.evaluate(() => window.cclinkStudio.window.requestClose()).catch(() => {})
  await Promise.race([
    appExited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('App did not close gracefully')), 15000),
    ),
  ])
  await browser.close()
  await stopApp()
  await startApp()
  await connect()
  await page.locator(`[data-workbench-tab-id="${id}"].pinned`).waitFor({ timeout: 20000 })
  const restored = (await tabSnapshot()).find((tab) => tab.id === id)
  assert.equal(restored.browserProfile, binding.browserProfile)
  assert.deepEqual(restored.webResourceDraftRef, binding.webResourceDraftRef)
  await page.locator(`[data-workbench-tab-id="${id}"]`).click()
  await page.waitForFunction(
    async ({ id, expectedUrl }) => {
      const { useBrowserStore } = await import('/src/stores/browser-store.ts')
      return useBrowserStore.getState().tabs[id]?.url === expectedUrl
    },
    { id, expectedUrl: `${url}/next` },
  )
  await browser.close()
  await connect()
  webPage = browser
    .contexts()
    .flatMap((ctx) => ctx.pages())
    .find((candidate) => candidate.url() === `${url}/next`)
  assert(webPage, 'restored real browser page')
  await webPage.waitForLoadState('domcontentloaded')
  assert(
    (await webPage.evaluate(() => document.cookie)).includes('tab_restore=kept'),
    'fixture cookie restored',
  )
  console.log('PASS restart restores pinned tabs, navigated URL and Profile cookie')
  await contextAction(id, 'tab.pin')
  assert.equal((await tabSnapshot()).find((tab) => tab.id === id).pinned, false)
  await openWorkspace(b)
  await page.locator(`[data-project-path="${a}"]`).click()
  await page.locator(`[data-workbench-tab-id="${id}"]`).waitFor()
  assert.equal((await tabSnapshot()).find((tab) => tab.id === id).pinned, false)
  await page.screenshot({ path: join(runtime.runDir, 'tab-pin-acceptance.png') })
  console.log('PASS unpin persists on workspace round trip')
  console.log(`Evidence: ${runtime.runDir}`)
} finally {
  await browser?.close().catch(() => {})
  await stopApp()
  server.close()
  await rm(fixtureDir, { recursive: true, force: true })
}
