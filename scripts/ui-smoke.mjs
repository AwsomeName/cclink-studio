#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { rootDir, runDir, logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const workspaceFixtureRoot = join(
  homedir(),
  `.cclink-studio-ui-smoke-${new URL(rendererOrigin).port}`,
)
const keepRunning = process.argv.includes('--keep-running')
const agentPanelOnly = process.argv.includes('--agent-panel-only')
const webAffairsOnly = process.argv.includes('--web-affairs-only')
const globalWebResourcesOnly = process.argv.includes('--global-web-resources-only')
const gitOnly = process.argv.includes('--git-only')
const dismissableOnly = process.argv.includes('--dismissable-only')
const tabCreateOnly = process.argv.includes('--tab-create-only')
const pdfOnly = process.argv.includes('--pdf-only')
const settingsOnly = process.argv.includes('--settings-only')
const securityWorkspaceOnly = process.argv.includes('--security-workspace-only')
const relocationRecoveryOnly = process.argv.includes('--relocation-recovery-only')
const uiReadyTimeoutMs = 30_000
const globalWebResourcesCheck = 'global web resources reuse one account and matrix across projects'
const webAffairPersistenceCheck = 'web affair persists a five-node workflow and node progress'
const webAffairsChecks = new Set([
  'main renderer enforces its CSP source boundary',
  'first screen has no login wall',
  globalWebResourcesCheck,
  webAffairPersistenceCheck,
  'web affair exposes A2-A4 handoff, wait, template, and flow-diff controls',
])
const globalWebResourcesChecks = new Set([
  'main renderer enforces its CSP source boundary',
  'first screen has no login wall',
  globalWebResourcesCheck,
])
const gitChecks = new Set([
  'status bar shows the current Git repository fact',
  'Git compact commit menu executes commit and push actions',
])
const dismissableChecks = new Set(['Escape closes only the topmost Studio popup'])
const tabCreateChecks = new Set(['tab create menu opens editor, browser, and terminal tabs'])
const pdfChecks = new Set([
  'main renderer enforces its CSP source boundary',
  'first screen has no login wall',
  'PDF pages render visibly with paging controls and explicit failure fallback',
])
const settingsChecks = new Set([
  'main renderer enforces its CSP source boundary',
  'first screen has no login wall',
  'settings page opens and searches locally',
])
const securityWorkspaceChecks = new Set([
  'main renderer enforces its CSP source boundary',
  'first screen has no login wall',
  'workspace file and search boundaries survive a real project switch',
  'workspace upload reaches a real Browser View without widening file access',
])
const relocationRecoveryChecks = new Set([
  'main renderer enforces its CSP source boundary',
  'first screen has no login wall',
  'file relocation journal recovers a stale tab after an app process restart',
])
const agentPanelChecks = new Set([
  'main renderer enforces its CSP source boundary',
  'first screen has no login wall',
  'Escape closes only the topmost Studio popup',
  'local and remote use one Agent Panel and IME-safe Composer',
])
const PDF_PREVIEW_FIXTURE_BASE64 =
  'JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDU5NS4yNzU2IDg0MS44ODk4IF0gL1BhcmVudCA3IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNyAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODMwMjAyODE2KzA4JzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODMwMjAyODE2KzA4JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxNjcKPj4Kc3RyZWFtCkdhcnAkM3Q/aj0mNFlXTTxMY3I9T0xfbjZDL0hHZiZnbzpzXEwrKSdNPjVgO0xkbDcqLF8nZmtEaE9vTikwWGNNPmFaQFozLTlyTmZWOWBjTko/az9ybjFRbUJBWT1bLCdCXEY1b1c6PT88Vl1LPXFqcyFFM2pMKlVPLitSVSYjUS0tKnIpI250T15kZyNhLVVbXi8kIVxtMCM0ckZlUzBQRHEwc34+ZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgOQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNjEgMDAwMDAgbiAKMDAwMDAwMDEwMiAwMDAwMCBuIAowMDAwMDAwMjA5IDAwMDAwIG4gCjAwMDAwMDAzMjEgMDAwMDAgbiAKMDAwMDAwMDUyNCAwMDAwMCBuIAowMDAwMDAwNTkyIDAwMDAwIG4gCjAwMDAwMDA4NTMgMDAwMDAgbiAKMDAwMDAwMDkxMiAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzxkMmM1NzE2MDk2YWE5NDJiMDllNDI4YjQ3YTA2NWE2Nj48ZDJjNTcxNjA5NmFhOTQyYjA5ZTQyOGI0N2EwNjVhNjY+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDYgMCBSCi9Sb290IDUgMCBSCi9TaXplIDkKPj4Kc3RhcnR4cmVmCjExNjkKJSVFT0YK'
const results = []
let startedBySmoke = false
let webFixtureServer
const execFileAsync = promisify(execFile)

function pass(name, detail = '') {
  results.push({ name, status: 'pass', detail })
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`)
}

function fail(name, error) {
  results.push({ name, status: 'fail', detail: error.message || String(error) })
  console.error(`FAIL ${name} - ${error.message || String(error)}`)
  if (error instanceof Error && error.stack) console.error(error.stack)
}

function skip(name, dependency) {
  results.push({ name, status: 'skip', detail: `blocked by ${dependency}` })
  console.warn(`SKIP ${name} - blocked by ${dependency}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function selectSmokeBusinessSubject(form) {
  const select = form.getByLabel('代表的业务主体')
  const option = select.locator('option').filter({ hasText: 'UI Smoke Account' }).first()
  const value = await option.getAttribute('value')
  assert(value, 'UI Smoke account is missing from the business subject selector')
  await select.selectOption(value)
}

function readPngDimensions(dataUrl) {
  assert(dataUrl?.startsWith('data:image/png;base64,'), 'browser capture is not a PNG data URL')
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  assert(bytes.length >= 24, 'browser capture PNG is truncated')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(timeoutMs = 45_000, previousLog = '') {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const completeLog = await readLog()
    const log =
      previousLog && completeLog.startsWith(previousLog)
        ? completeLog.slice(previousLog.length)
        : completeLog
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

async function runCheck(name, fn, options = {}) {
  if (agentPanelOnly && !agentPanelChecks.has(name)) return
  if (webAffairsOnly && !webAffairsChecks.has(name)) return
  if (globalWebResourcesOnly && !globalWebResourcesChecks.has(name)) return
  if (gitOnly && !gitChecks.has(name)) return
  if (dismissableOnly && !dismissableChecks.has(name)) return
  if (tabCreateOnly && !tabCreateChecks.has(name)) return
  if (pdfOnly && !pdfChecks.has(name)) return
  if (settingsOnly && !settingsChecks.has(name)) return
  if (securityWorkspaceOnly && !securityWorkspaceChecks.has(name)) return
  if (relocationRecoveryOnly && !relocationRecoveryChecks.has(name)) return
  const blockedBy = (options.dependsOn ?? []).find(
    (dependency) => results.find((result) => result.name === dependency)?.status !== 'pass',
  )
  if (blockedBy) {
    skip(name, blockedBy)
    return
  }
  try {
    const detail = await fn()
    pass(name, detail)
  } catch (error) {
    fail(name, error)
  }
}

async function startWebFixture() {
  webFixtureServer = createServer((request, response) => {
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
      ...(request.url === '/login-popup-source'
        ? { 'set-cookie': 'cclink_auth_marker=logged-in; Path=/; HttpOnly; SameSite=Lax' }
        : {}),
    })
    response.end(`<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>CCLink UI Smoke Fixture</title></head>
  <body>
    <main>CCLink UI Smoke Fixture</main>
    ${
      request.url === '/login-popup-source'
        ? '<button id="open-login" onclick="window.open(\'/login-popup-target\', \'_blank\')">打开登录页</button>'
        : ''
    }
    ${
      request.url === '/file-upload'
        ? '<input id="file-upload" type="file"><output id="uploaded-name"></output><script>document.querySelector("#file-upload").addEventListener("change", event => { document.querySelector("#uploaded-name").textContent = event.target.files?.[0]?.name || "" })</script>'
        : ''
    }
  </body>
</html>`)
  })
  await new Promise((resolve, reject) => {
    webFixtureServer.once('error', reject)
    webFixtureServer.listen(0, '127.0.0.1', resolve)
  })
  const address = webFixtureServer.address()
  if (!address || typeof address === 'string') throw new Error('local web fixture has no TCP port')
  return `http://127.0.0.1:${address.port}`
}

async function stopWebFixture() {
  const server = webFixtureServer
  webFixtureServer = undefined
  if (!server) return
  server.closeAllConnections?.()
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
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

async function runGit(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' })
}

async function prepareSmokeWorkspaceCapabilities() {
  const userDataPath = join(runDir, 'user-data')
  await mkdir(userDataPath, { recursive: true })
  await mkdir(workspaceFixtureRoot, { recursive: true })
  const statePath = join(userDataPath, 'workspace-state.json')
  const existingState = await readFile(statePath, 'utf8')
    .then((value) => JSON.parse(value))
    .catch(() => ({ version: 2, workspaces: {}, localWorkspaces: {} }))
  existingState.version = 2
  existingState.workspaces ??= {}
  existingState.localWorkspaces ??= {}
  const timestamp = Date.now()
  existingState.localWorkspaces['ui-smoke-repository'] = {
    workspaceKey: rootDir,
    workspacePath: rootDir,
    ownerKey: null,
    updatedAt: timestamp,
    storage: 'fallback',
    projectId: null,
  }
  existingState.localWorkspaces['ui-smoke-fixtures'] = {
    workspaceKey: workspaceFixtureRoot,
    workspacePath: workspaceFixtureRoot,
    ownerKey: null,
    updatedAt: timestamp,
    storage: 'fallback',
    projectId: null,
  }
  await writeFile(statePath, JSON.stringify(existingState), 'utf8')

  const settingsPath = join(userDataPath, 'settings.json')
  const settings = await readFile(settingsPath, 'utf8')
    .then((value) => JSON.parse(value))
    .catch(() => ({}))
  settings.lastWorkspacePath = rootDir
  settings.recentWorkspacePaths = Array.from(
    new Set([rootDir, workspaceFixtureRoot, ...(settings.recentWorkspacePaths ?? [])]),
  )
  await writeFile(settingsPath, JSON.stringify(settings), 'utf8')
}

async function main() {
  await prepareSmokeWorkspaceCapabilities()
  const initialLog = await readLog()
  runRestart('restart')
  startedBySmoke = true

  const cdpPort = await waitForCdpPort(45_000, initialLog)
  let browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  let page = await findRendererPage(browser)
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })
  const webFixtureOrigin = await startWebFixture()

  await runCheck('main renderer enforces its CSP source boundary', async () => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().resourceType() === 'document' &&
        response.url().startsWith(`${rendererOrigin}/`),
      { timeout: uiReadyTimeoutMs },
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await responsePromise
    await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })
    const probe = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const script = document.createElement('script')
          script.src = 'data:text/javascript,window.__cclinkCspProbeLoaded=true'
          script.onload = () => resolve({ loaded: true })
          script.onerror = () => resolve({ loaded: false })
          document.head.append(script)
          setTimeout(() => resolve({ loaded: Boolean(window.__cclinkCspProbeLoaded) }), 1_000)
        }),
    )
    assert(!probe.loaded, 'CSP allowed a data: script outside script-src')
    return 'blocked disallowed data script'
  })

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

  await runCheck('workspace file and search boundaries survive a real project switch', async () => {
    const workspaceA = join(workspaceFixtureRoot, 'security-workspace-a')
    const workspaceB = join(workspaceFixtureRoot, 'security-workspace-b')
    const outsideFile = join(workspaceFixtureRoot, 'outside-secret.txt')
    const deepDirectory = join(workspaceA, 'one', 'two', 'three', 'four', 'five')
    await mkdir(deepDirectory, { recursive: true })
    await mkdir(workspaceB, { recursive: true })
    await writeFile(join(deepDirectory, 'a-only-canary.txt'), 'workspace-a', 'utf8')
    await writeFile(join(workspaceA, 'a-second-canary.txt'), 'workspace-a-2', 'utf8')
    await writeFile(join(workspaceB, 'b-only-canary.txt'), 'workspace-b', 'utf8')
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(workspaceA, 'outside-link.txt'))
    try {
      const result = await page.evaluate(
        async ({ workspaceA, workspaceB, outsideFile }) => {
          const [{ useFsStore }, { useWorkspaceStore }] = await Promise.all([
            import('/src/stores/fs-store.ts'),
            import('/src/stores/workspace-store.ts'),
          ])
          const openedA = await useFsStore.getState().openRecentWorkspace(workspaceA)
          if (!openedA) return { openedA, error: useFsStore.getState().error }
          const generationA = useWorkspaceStore.getState().generation
          const deep = await window.cclinkStudio.fs.searchWorkspace({
            workspaceKey: workspaceA,
            generation: generationA,
            requestId: crypto.randomUUID(),
            query: 'a-only-canary',
          })
          const limited = await window.cclinkStudio.fs.searchWorkspace({
            workspaceKey: workspaceA,
            generation: generationA,
            requestId: crypto.randomUUID(),
            query: 'canary',
            maxResults: 1,
          })
          const deny = async (operation) => {
            try {
              await operation()
              return false
            } catch {
              return true
            }
          }
          const siblingDenied = await deny(() =>
            window.cclinkStudio.fs.readFile(`${workspaceB}/b-only-canary.txt`),
          )
          const symlinkDenied = await deny(() =>
            window.cclinkStudio.fs.readFile(`${workspaceA}/outside-link.txt`),
          )
          const newOutsideDenied = await deny(() =>
            window.cclinkStudio.fs.writeFile(`${outsideFile}.new`, 'escape'),
          )
          const staleRequest = window.cclinkStudio.fs
            .searchWorkspace({
              workspaceKey: workspaceA,
              generation: generationA,
              requestId: crypto.randomUUID(),
              query: 'canary',
            })
            .then((value) => ({ ok: true, value }))
            .catch((error) => ({ ok: false, error: String(error) }))
          const openedB = await useFsStore.getState().openRecentWorkspace(workspaceB)
          const stale = await staleRequest
          const generationB = useWorkspaceStore.getState().generation
          const current = await window.cclinkStudio.fs.searchWorkspace({
            workspaceKey: workspaceB,
            generation: generationB,
            requestId: crypto.randomUUID(),
            query: 'canary',
          })
          const oldWorkspaceDenied = await deny(() =>
            window.cclinkStudio.fs.readFile(`${workspaceA}/a-second-canary.txt`),
          )
          return {
            openedA,
            openedB,
            deepNames: deep.results.map((entry) => entry.name),
            limitedCount: limited.results.length,
            truncated: limited.truncated,
            siblingDenied,
            symlinkDenied,
            newOutsideDenied,
            oldWorkspaceDenied,
            staleWorkspaceKey: stale.ok ? stale.value.workspaceKey : null,
            currentWorkspaceKey: current.workspaceKey,
            currentNames: current.results.map((entry) => entry.name),
          }
        },
        { workspaceA, workspaceB, outsideFile },
      )
      assert(result.openedA && result.openedB, `workspace switch failed: ${JSON.stringify(result)}`)
      assert(result.deepNames.includes('a-only-canary.txt'), 'deep workspace file was not found')
      assert(result.limitedCount === 1 && result.truncated, 'search truncation was not explicit')
      assert(
        result.siblingDenied &&
          result.symlinkDenied &&
          result.newOutsideDenied &&
          result.oldWorkspaceDenied,
        `workspace boundary escaped: ${JSON.stringify(result)}`,
      )
      assert(
        result.staleWorkspaceKey === null || result.staleWorkspaceKey === workspaceA,
        'late search response was rebound to another workspace',
      )
      assert(
        result.currentWorkspaceKey === workspaceB &&
          result.currentNames.includes('b-only-canary.txt') &&
          !result.currentNames.includes('a-only-canary.txt'),
        'workspace B search mixed workspace A results',
      )
      return 'deep search, truncation, sibling/symlink/new-target denial, and generation-bound switch verified'
    } finally {
      await page.evaluate(async (path) => {
        const { useFsStore } = await import('/src/stores/fs-store.ts')
        await useFsStore.getState().openRecentWorkspace(path)
      }, rootDir)
      await Promise.all([
        rm(workspaceA, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
        rm(workspaceB, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
        rm(outsideFile, { force: true }),
      ])
    }
  })

  await runCheck(
    'workspace upload reaches a real Browser View without widening file access',
    async () => {
      const uploadFixture = join(rootDir, '.cclink-studio-browser-upload-canary.txt')
      const outsideFixture = join(workspaceFixtureRoot, 'browser-upload-outside-canary.txt')
      const uploadUrl = `${webFixtureOrigin}/file-upload`
      await writeFile(uploadFixture, 'workspace upload canary', 'utf8')
      await writeFile(outsideFixture, 'outside upload canary', 'utf8')
      let tabId = null
      try {
        tabId = await page.evaluate(async (initialUrl) => {
          const [{ openDefaultBrowserTab }, { useWorkspaceStore }] = await Promise.all([
            import('/src/features/web-resources/open-default-browser-tab.ts'),
            import('/src/stores/workspace-store.ts'),
          ])
          return (
            await openDefaultBrowserTab(useWorkspaceStore.getState().activeWorkspaceRef, {
              title: 'Browser 上传边界验收',
              initialUrl,
            })
          ).tabId
        }, uploadUrl)
        await page.waitForFunction(
          async ({ tabId: id, expectedUrl }) =>
            (await window.cclinkStudio.browser.getRuntimeDiagnostics(id)).visibleUrl ===
            expectedUrl,
          { tabId, expectedUrl: uploadUrl },
          { timeout: uiReadyTimeoutMs },
        )
        let browserViewPage = null
        const claimDeadline = Date.now() + uiReadyTimeoutMs
        while (!browserViewPage && Date.now() < claimDeadline) {
          browserViewPage =
            browser
              .contexts()
              .flatMap((context) => context.pages())
              .find((candidate) => candidate.url().startsWith(uploadUrl)) ?? null
          if (!browserViewPage) await new Promise((resolve) => setTimeout(resolve, 250))
        }
        assert(
          browserViewPage,
          `real Browser WebContentsView page was not claimed over CDP: ${browser
            .contexts()
            .flatMap((context) => context.pages().map((candidate) => candidate.url()))
            .join(', ')}`,
        )
        await browserViewPage.locator('#file-upload').setInputFiles(uploadFixture)
        await browserViewPage.waitForFunction(
          (expected) => document.querySelector('#uploaded-name')?.textContent === expected,
          basename(uploadFixture),
        )
        const outsideDenied = await page.evaluate(async (path) => {
          try {
            await window.cclinkStudio.fs.readFile(path)
            return false
          } catch {
            return true
          }
        }, outsideFixture)
        assert(outsideDenied, 'Browser upload fixture widened renderer access outside workspace')
        return 'workspace file selected in real WebContentsView; outside workspace remained denied'
      } finally {
        if (tabId) {
          await page.evaluate(async (id) => {
            const { useTabStore } = await import('/src/stores/tab-store.ts')
            useTabStore.getState().closeTab(id)
          }, tabId)
        }
        await Promise.all([rm(uploadFixture, { force: true }), rm(outsideFixture, { force: true })])
      }
    },
  )

  await runCheck(
    'file relocation journal recovers a stale tab after an app process restart',
    async () => {
      const fixtureDir = await mkdtemp(join(rootDir, '.cclink-studio-relocation-recovery-'))
      const sourcePath = join(fixtureDir, 'before-restart.md')
      const targetPath = join(fixtureDir, 'after-restart.md')
      const operationId = `file-relocation-${Date.now()}-9001`
      await writeFile(sourcePath, '# relocation restart canary\n', 'utf8')
      try {
        const prepared = await page.evaluate(
          async ({ operationId, sourcePath, targetPath, workspacePath }) => {
            const [{ useTabStore }, { useWorkspaceStore }, { persistRuntimeSections }] =
              await Promise.all([
                import('/src/stores/tab-store.ts'),
                import('/src/stores/workspace-store.ts'),
                import('/src/utils/workspace-runtime.ts'),
              ])
            useTabStore.getState().openTab({
              type: 'editor',
              title: 'before-restart.md',
              icon: '📄',
              filePath: sourcePath,
              initialContent: '# relocation restart canary\n',
              workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
              forceNew: true,
            })
            const persistence = await persistRuntimeSections(workspacePath)
            if (!persistence.success) return { persistence, tabId: null }
            const tabId = useTabStore.getState().activeTabId
            await window.cclinkStudio.fs.beginFileRelocation({
              operationId,
              workspacePath,
              moves: [{ sourcePath, targetPath }],
            })
            await window.cclinkStudio.fs.rename(sourcePath, targetPath)
            // Deliberately stop here: the app process exits before markFileRelocationCommitted.
            return { persistence, tabId }
          },
          { operationId, sourcePath, targetPath, workspacePath: rootDir },
        )
        assert(prepared.persistence.success && prepared.tabId, 'stale source tab was not persisted')

        await browser.close()
        const restartLog = await readLog()
        runRestart('restart')
        const restartedCdpPort = await waitForCdpPort(45_000, restartLog)
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${restartedCdpPort}`)
        page = await findRendererPage(browser)
        await page.setViewportSize({ width: 1440, height: 920 })
        await page.waitForLoadState('domcontentloaded')
        await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })

        await page.waitForFunction(
          async ({ operationId, sourcePath, targetPath, tabId, workspacePath }) => {
            const { useTabStore } = await import('/src/stores/tab-store.ts')
            const tab = useTabStore.getState().tabs.find((candidate) => candidate.id === tabId)
            const pending = await window.cclinkStudio.fs.listPendingFileRelocations(workspacePath)
            let targetReadable = false
            let sourceMissing = false
            try {
              targetReadable = (await window.cclinkStudio.fs.readFile(targetPath)).includes(
                'relocation restart canary',
              )
            } catch {
              targetReadable = false
            }
            try {
              await window.cclinkStudio.fs.readFile(sourcePath)
            } catch {
              sourceMissing = true
            }
            return (
              tab?.filePath === targetPath &&
              tab.title === 'after-restart.md' &&
              targetReadable &&
              sourceMissing &&
              !pending.some((entry) => entry.operationId === operationId)
            )
          },
          { operationId, sourcePath, targetPath, tabId: prepared.tabId, workspacePath: rootDir },
          { timeout: uiReadyTimeoutMs },
        )
        return 'prepared journal + disk move recovered and acknowledged after real app restart'
      } finally {
        await rm(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
    },
  )

  await runCheck(
    'PDF pages render visibly with paging controls and explicit failure fallback',
    async () => {
      const fixtureDir = await mkdtemp(join(rootDir, '.cclink-studio-ui-pdf-'))
      const pdfPath = join(fixtureDir, 'visible-preview.pdf')
      const invalidPdfPath = join(fixtureDir, 'invalid-preview.pdf')
      try {
        await writeFile(pdfPath, Buffer.from(PDF_PREVIEW_FIXTURE_BASE64, 'base64'))
        await writeFile(invalidPdfPath, '%PDF-invalid', 'utf8')
        await page.evaluate(async (filePath) => {
          const { useTabStore } = await import('/src/stores/tab-store.ts')
          useTabStore.getState().openTab({
            type: 'file-preview',
            title: 'visible-preview.pdf',
            icon: '📕',
            filePath,
          })
        }, pdfPath)

        const preview = page.locator('[data-pdf-preview-status="ready"]')
        await preview.waitFor({ state: 'visible', timeout: 20_000 })
        const canvas = preview.locator('canvas')
        const pixels = await canvas.evaluate((element) => {
          const context = element.getContext('2d')
          if (!context) return null
          const { width, height } = element
          const data = context.getImageData(0, 0, width, height).data
          let light = 0
          let dark = 0
          for (let offset = 0; offset < data.length; offset += 16) {
            const red = data[offset]
            const green = data[offset + 1]
            const blue = data[offset + 2]
            if (red > 240 && green > 240 && blue > 240) light += 1
            if (red < 150 && green < 150 && blue < 150) dark += 1
          }
          return { width, height, light, dark }
        })
        assert(pixels?.width > 500 && pixels?.height > 700, 'PDF canvas has no page-sized output')
        assert(pixels.light > 10_000, 'PDF canvas is missing the light page background')
        assert(pixels.dark > 100, 'PDF canvas is missing rendered document content')
        assert(
          (await preview.locator('.file-preview-pdf-controls').innerText()).includes('1 / 1'),
          'PDF page controls do not report the current page',
        )

        const initialWidth = await canvas.evaluate((element) => element.style.width)
        await preview.getByRole('button', { name: '放大 PDF' }).click()
        await page.waitForFunction(
          (width) =>
            document.querySelector('.file-preview-pdf-stage canvas')?.style.width !== width,
          initialWidth,
          { timeout: 10_000 },
        )

        await page.evaluate(async (filePath) => {
          const { useTabStore } = await import('/src/stores/tab-store.ts')
          useTabStore.getState().openTab({
            type: 'file-preview',
            title: 'invalid-preview.pdf',
            icon: '📕',
            filePath,
          })
        }, invalidPdfPath)
        const failedPreview = page.locator('[data-pdf-preview-status="error"]')
        await failedPreview.waitFor({ state: 'visible', timeout: 10_000 })
        assert(
          (await failedPreview.innerText()).includes('用系统应用打开'),
          'invalid PDF has no explicit system-open fallback',
        )
        return 'real canvas pixels, page controls, zoom, and invalid-file fallback'
      } finally {
        await rm(fixtureDir, { recursive: true, force: true })
      }
    },
  )

  await runCheck('Escape closes only the topmost Studio popup', async () => {
    await page.evaluate(async () => {
      const { useWorkspaceOpenStore } =
        await import('/src/features/workspace-open/workspace-open-store.ts')
      useWorkspaceOpenStore.getState().show()
    })
    const workspaceOpener = page.locator('.workspace-open-surface')
    await workspaceOpener.waitFor({ state: 'visible', timeout: 10_000 })

    await page.evaluate(async () => {
      const { useCommandStore } = await import('/src/stores/command-store.ts')
      useCommandStore.getState().togglePalette()
    })
    const commandPalette = page.locator('.command-palette')
    await commandPalette.waitFor({ state: 'visible', timeout: 10_000 })

    await page.keyboard.press('Escape')
    await commandPalette.waitFor({ state: 'hidden', timeout: 10_000 })
    assert(await workspaceOpener.isVisible(), 'Escape also closed the lower workspace popup')

    await page.keyboard.press('Escape')
    await workspaceOpener.waitFor({ state: 'hidden', timeout: 10_000 })

    await page.evaluate(async () => {
      const { useUpdateStore } = await import('/src/stores/update-store.ts')
      useUpdateStore.getState().openPanel()
    })
    const updatePanel = page.locator('.update-panel')
    await updatePanel.waitFor({ state: 'visible', timeout: 10_000 })
    await page.keyboard.press('Escape')
    await updatePanel.waitFor({ state: 'hidden', timeout: 10_000 })

    return 'nested workspace/command layers and the update dialog close one layer per Escape'
  })

  await runCheck('local and remote use one Agent Panel and IME-safe Composer', async () => {
    const panelToggle = page.locator('.app-topbar-right .app-topbar-icon')
    if ((await panelToggle.getAttribute('title')) === '展开 Agent 面板') {
      await panelToggle.click()
    }

    const originalWorkspace = await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const state = useWorkspaceStore.getState()
      useWorkspaceStore.setState({
        activeWorkspaceRef: { kind: 'global' },
        generation: state.generation + 1,
      })
      return { ref: state.activeWorkspaceRef, generation: state.generation }
    })

    const panelProjection = async (runtime) =>
      page.locator(`[data-agent-panel-runtime="${runtime}"]`).evaluate((panel) => {
        const box = (selector) => {
          const rect = panel.querySelector(selector)?.getBoundingClientRect()
          const root = panel.getBoundingClientRect()
          return rect
            ? {
                x: Math.round(rect.x - root.x),
                y: Math.round(rect.y - root.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }
            : null
        }
        return {
          rootWidth: Math.round(panel.getBoundingClientRect().width),
          landmarks: [...panel.querySelectorAll('[data-agent-landmark]')].map((element) =>
            element.getAttribute('data-agent-landmark'),
          ),
          actions: [...panel.querySelectorAll('[data-agent-action]')].map((element) =>
            element.getAttribute('data-agent-action'),
          ),
          boxes: {
            header: box('[data-agent-landmark="header"]'),
            context: box('[data-agent-landmark="context"]'),
            timeline: box('[data-agent-landmark="timeline"]'),
            composer: box('.agent-input-card'),
            actionBar: box('[data-agent-landmark="action-bar"]'),
            primaryAction: box('[data-agent-action="send"], [data-agent-action="stop"]'),
            addContextAction: box('[data-agent-action="addContext"]'),
            roleAction: box('[data-agent-action="role"]'),
            permissionAction: box('[data-agent-action="permissionMode"]'),
            contextUsageAction: box('[data-agent-action="contextUsage"]'),
            runtimeAction: box('[data-agent-action="runtime"]'),
          },
        }
      })
    const assertEquivalentPanel = (local, remote, variant) => {
      assert(
        JSON.stringify(local.landmarks) === JSON.stringify(remote.landmarks),
        `${variant} local/remote landmark order differs`,
      )
      assert(
        JSON.stringify(local.actions) === JSON.stringify(remote.actions),
        `${variant} local/remote action order differs`,
      )
      for (const key of ['header', 'context', 'composer', 'actionBar', 'primaryAction']) {
        const left = local.boxes[key]
        const right = remote.boxes[key]
        assert(left && right, `${variant} ${key} bounding box missing`)
        for (const metric of ['height']) {
          assert(
            Math.abs(left[metric] - right[metric]) <= 1,
            `${variant} ${key}.${metric} differs (${left[metric]} vs ${right[metric]})`,
          )
        }
        const leftPosition =
          key === 'primaryAction' ? local.rootWidth - left.x - left.width : left.x
        const rightPosition =
          key === 'primaryAction' ? remote.rootWidth - right.x - right.width : right.x
        assert(
          Math.abs(leftPosition - rightPosition) <= 1,
          `${variant} ${key} position/inset differs (${leftPosition} vs ${rightPosition})`,
        )
        const leftWidth = key === 'primaryAction' ? left.width : local.rootWidth - left.width
        const rightWidth = key === 'primaryAction' ? right.width : remote.rootWidth - right.width
        assert(
          Math.abs(leftWidth - rightWidth) <= 1,
          `${variant} ${key} width/inset differs (${leftWidth} vs ${rightWidth})`,
        )
      }
      for (const key of [
        'addContextAction',
        'roleAction',
        'permissionAction',
        'contextUsageAction',
        'runtimeAction',
      ]) {
        const left = local.boxes[key]
        const right = remote.boxes[key]
        assert(left && right, `${variant} ${key} bounding box missing`)
        assert(
          Math.abs(left.height - right.height) <= 1,
          `${variant} ${key}.height differs (${left.height} vs ${right.height})`,
        )
      }
      assert(
        remote.boxes.addContextAction.width === remote.boxes.addContextAction.height,
        `${variant} remote add-context action is not a square icon button`,
      )
    }

    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      useUIStore.getState().setAgentPanelMode('right', 'user')
    })
    const localPanel = page.locator('[data-agent-panel-runtime="local"]')
    await localPanel.waitFor({ state: 'visible', timeout: 10_000 })
    assert((await page.locator('.agent-panel').count()) === 1, 'expected one Agent Panel root')
    const localComposer = localPanel.locator('textarea.agent-input, textarea.agent-start-input')
    await localComposer.waitFor({ state: 'visible', timeout: 10_000 })
    assert((await localComposer.count()) === 1, 'local runtime rendered more than one Composer')
    await localComposer.fill('输入法候选')
    await localComposer.dispatchEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      isComposing: true,
      bubbles: true,
    })
    await page.waitForTimeout(100)
    assert(
      (await localComposer.inputValue()) === '输入法候选',
      'IME candidate confirmation submitted or cleared the local draft',
    )
    await localComposer.fill('/')
    const skillCandidates = page.locator('.agent-skill-menu [role="option"]')
    await skillCandidates.first().waitFor({ state: 'visible', timeout: 10_000 })
    await localComposer.press('Shift+Enter')
    assert(
      (await localComposer.inputValue()) === '/\n',
      'Shift+Enter selected a candidate instead of inserting a newline',
    )
    await localComposer.fill('')
    const localSideProjection = await panelProjection('local')

    await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const state = useWorkspaceStore.getState()
      useWorkspaceStore.setState({
        activeWorkspaceRef: {
          kind: 'remote',
          transport: 'cclink',
          endpointId: 'ui-smoke-endpoint',
          endpointName: 'UI Smoke',
          workspaceId: 'ui-smoke-workspace',
          path: '/ui-smoke-workspace',
        },
        generation: state.generation + 1,
      })
    })
    const remotePanel = page.locator('[data-agent-panel-runtime="remote"]')
    await remotePanel.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await page.locator('.agent-panel').count()) === 1,
      'remote runtime duplicated Panel roots',
    )
    assert(
      (await remotePanel.locator('textarea.agent-input').count()) === 1,
      'remote runtime did not reuse AgentComposer',
    )
    assert(
      (await page.locator('.remote-agent-panel, .remote-agent-composer').count()) === 0,
      'legacy remote Panel or Composer is still rendered',
    )
    const remoteSideProjection = await panelProjection('remote')
    assertEquivalentPanel(localSideProjection, remoteSideProjection, 'side')

    await page.evaluate(async () => {
      const { useCclinkStore } = await import('/src/stores/cclink-store.ts')
      const sessionId = 'ui-smoke-approval-session'
      const now = Date.now() / 1000
      useCclinkStore.setState({
        sessions: [
          {
            id: sessionId,
            name: '审批滚动验收',
            workspaceId: 'ui-smoke-workspace',
            workspacePath: '/ui-smoke-workspace',
            serverId: 'ui-smoke-endpoint',
            status: 'active',
            createdAt: now,
            updatedAt: now,
            messageCount: 10,
            contextUsage: 0,
          },
        ],
        messages: {
          [sessionId]: [
            { type: 'user', id: 'ui-smoke-user', content: '执行批量搜索', timestamp: now },
            ...Array.from({ length: 9 }, (_, index) => ({
              type: 'agentTool',
              id: `ui-smoke-tool-message-${index}`,
              timestamp: now + index + 1,
              tool: {
                id: `ui-smoke-tool-${index}`,
                name: 'WebSearch',
                state: 'pending',
                input: { query: `scroll regression ${index}` },
                requiresApproval: true,
                requestId: 'ui-smoke-shared-run',
              },
            })),
          ],
        },
        selectedSessionId: sessionId,
        loading: false,
        error: null,
      })
    })
    const remoteTimeline = remotePanel.locator('.agent-messages')
    const approvalCards = remoteTimeline.locator('.tool-confirmation-card')
    await approvalCards.first().waitFor({ state: 'visible', timeout: 10_000 })
    assert((await approvalCards.count()) === 9, 'remote approval cards were not all rendered')
    const approvalLayout = await remoteTimeline.evaluate((timeline) => {
      const cards = [...timeline.querySelectorAll('.tool-confirmation-card')]
      return {
        clientHeight: timeline.clientHeight,
        scrollHeight: timeline.scrollHeight,
        nested: cards.every((card) => card.closest('.agent-messages') === timeline),
      }
    })
    assert(approvalLayout.nested, 'remote approval cards escaped the conversation scroll owner')
    assert(
      approvalLayout.scrollHeight > approvalLayout.clientHeight,
      'remote approval cards did not create a scrollable conversation',
    )
    await remoteTimeline.evaluate((timeline) => {
      timeline.scrollTop = 0
    })
    await remoteTimeline.hover()
    await page.mouse.wheel(0, 640)
    await page.waitForTimeout(100)
    assert(
      (await remoteTimeline.evaluate((timeline) => timeline.scrollTop)) > 0,
      'mouse wheel did not scroll through remote approval cards',
    )
    assert(
      await remotePanel.locator('textarea.agent-input').isVisible(),
      'remote approval overflow pushed the Composer out of view',
    )
    await page.evaluate(async () => {
      const { useCclinkStore } = await import('/src/stores/cclink-store.ts')
      useCclinkStore.setState({ sessions: [], messages: {}, selectedSessionId: null })
    })

    if (!agentPanelOnly) {
      await page.evaluate(async (snapshot) => {
        const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
        const state = useWorkspaceStore.getState()
        useWorkspaceStore.setState({
          activeWorkspaceRef: snapshot.ref,
          generation: Math.max(state.generation + 1, snapshot.generation + 1),
        })
      }, originalWorkspace)
      return 'single fixed side view, equivalent landmarks and boxes, scrollable approval cards, IME-safe Enter, and Shift+Enter'
    }

    // center 是无 Workbench Tab 的首次会话 surface；先回到本地并清空 smoke Tab 投影。
    await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const state = useWorkspaceStore.getState()
      useWorkspaceStore.setState({
        activeWorkspaceRef: { kind: 'global' },
        generation: state.generation + 1,
      })
    })
    await page.locator('[data-agent-panel-runtime="local"]').waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    await page.waitForTimeout(1_000)
    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      useTabStore.setState({ tabs: [], activeTabId: null })
      useUIStore.setState({
        agentPanelMode: 'center',
        agentPanelLastVisibleMode: 'center',
        agentPanelVisible: true,
        agentPanelModeSource: 'user',
        sidebarVisible: false,
        sidebarWidth: 250,
      })
    })
    await page.waitForTimeout(200)
    const localCenterPanel = page.locator(
      '[data-agent-panel-runtime="local"][data-agent-panel-variant="center"]',
    )
    assert(
      (await localCenterPanel.count()) === 1 && (await localCenterPanel.isVisible()),
      'local center Agent Panel is missing',
    )
    const localCenterProjection = await panelProjection('local')

    await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const state = useWorkspaceStore.getState()
      useWorkspaceStore.setState({
        activeWorkspaceRef: {
          kind: 'remote',
          transport: 'cclink',
          endpointId: 'ui-smoke-endpoint',
          endpointName: 'UI Smoke',
          workspaceId: 'ui-smoke-workspace',
          path: '/ui-smoke-workspace',
        },
        generation: state.generation + 1,
      })
    })
    const remoteCenterPanel = page.locator(
      '[data-agent-panel-runtime="remote"][data-agent-panel-variant="center"]',
    )
    await remoteCenterPanel.waitFor({ state: 'visible', timeout: 10_000 })
    const remoteCenterProjection = await panelProjection('remote')
    assertEquivalentPanel(localCenterProjection, remoteCenterProjection, 'center')

    return 'single fixed side/center view, equivalent landmarks and boxes, scrollable approval cards, IME-safe Enter, and Shift+Enter'
  })

  if (agentPanelOnly) {
    await browser.close()
    await stopWebFixture()
    const failed = results.filter((result) => result.status === 'fail')
    if (startedBySmoke && !keepRunning) runRestart('stop')
    if (failed.length > 0) {
      console.error(`\nAgent Panel UI smoke failed: ${failed.length}/${results.length}`)
      process.exit(1)
    }
    console.log(`\nAgent Panel UI smoke passed: ${results.length}/${results.length}`)
    return
  }

  await runCheck('workspace opener unifies local and CCLink remote entry', async () => {
    await clickByTitle(page, '打开工作空间')
    const opener = page.locator('.workspace-open-surface')
    await opener.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      await opener.getByRole('button', { name: /本地文件夹/ }).isVisible(),
      'local workspace source is missing',
    )
    assert(
      await opener.getByRole('button', { name: /CCLink 远程/ }).isVisible(),
      'CCLink remote source is missing',
    )

    await opener.getByRole('button', { name: /CCLink 远程/ }).click()
    await opener
      .locator('.cclink-login-card, .cclink-server-panel, .cclink-panel-state')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
    assert(await page.locator('.main-window').isVisible(), 'remote source replaced the local shell')

    await opener.getByRole('button', { name: '返回来源选择' }).click()
    await opener.getByRole('button', { name: /本地文件夹/ }).waitFor({ state: 'visible' })
    await opener.getByRole('button', { name: '关闭打开工作空间' }).click()
    await opener.waitFor({ state: 'hidden' })
    return 'shared source chooser and scoped remote step'
  })

  await runCheck('CCLink login is scoped to the remote entry and fails soft', async () => {
    await clickByTitle(page, 'CCLink 远程')
    const service = await page.evaluate(() => window.cclinkStudio.auth.getServiceStatus())
    if (service.configured) {
      await page
        .locator('.cclink-login-card, .cclink-server-panel')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
    } else {
      await page
        .locator('.cclink-panel-state', { hasText: '远程服务未配置' })
        .waitFor({ state: 'visible', timeout: 10_000 })
    }
    assert(await page.locator('.main-window').isVisible(), 'remote entry replaced the local shell')
    assert(await page.locator('.app-topbar').isVisible(), 'remote entry hid the local topbar')
    await clickByTitle(page, '文件')
    return service.configured ? 'remote-only login surface' : 'unconfigured degradation surface'
  })

  await runCheck('topbar switches the current project conversation and reopens Agent', async () => {
    const switcher = page.locator('.conversation-quick-switcher')
    await switcher.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await page.locator('.status-bar-conversation-switcher').count()) === 0,
      'legacy conversation switcher is still rendered in the status bar',
    )
    assert(
      (await switcher.evaluate((element) => getComputedStyle(element).webkitAppRegion)) ===
        'no-drag',
      'conversation controls are still part of the window drag region',
    )

    const panelToggle = page.locator('.app-topbar-right .app-topbar-icon')
    if ((await panelToggle.getAttribute('title')) === '收起 Agent 面板') {
      await panelToggle.click()
      await page.waitForFunction(
        () => document.querySelector('.conversation-quick-switcher')?.classList.contains('compact'),
        undefined,
        { timeout: 10_000 },
      )
    }

    await page.locator('.conversation-quick-tab').first().click()
    await page.waitForFunction(
      () =>
        document.querySelector('.conversation-quick-switcher')?.classList.contains('compact') ===
        false,
      undefined,
      { timeout: 10_000 },
    )
    const widths = await page.evaluate(() => ({
      panel: document.querySelector('.agent-side-shell')?.getBoundingClientRect().width ?? 0,
      topbar: document.querySelector('.app-topbar-right')?.getBoundingClientRect().width ?? 0,
    }))
    assert(widths.panel > 0, 'conversation switch did not reopen the Agent panel')
    assert(
      Math.abs(widths.panel - widths.topbar) < 1,
      `topbar switcher width is not aligned with Agent panel (${widths.topbar} vs ${widths.panel})`,
    )

    const quickTab = page.locator('.conversation-quick-tab').first()
    await quickTab.click({ button: 'right' })
    const contextMenu = page.locator('.unified-context-menu')
    await contextMenu.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      await contextMenu.getByRole('menuitem', { name: '重命名' }).isVisible(),
      'quick conversation menu is missing rename',
    )
    assert(
      await contextMenu.getByRole('menuitem', { name: '关闭会话' }).isVisible(),
      'quick conversation menu is missing close',
    )
    assert(
      await contextMenu.getByRole('menuitem', { name: '在中间 Tab 打开' }).isVisible(),
      'quick conversation menu is missing Workbench open',
    )
    await page.keyboard.press('Escape')
    await contextMenu.waitFor({ state: 'hidden', timeout: 10_000 })

    const conversationId = await quickTab.getAttribute('data-conversation-id')
    assert(conversationId, 'quick conversation drag identity is missing')
    const beforeDrop = await page.evaluate(async (id) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const agentState = useAgentStore.getState()
      const tabState = useTabStore.getState()
      return {
        activeConversationId: agentState.activeConversationId,
        conversationSurface: agentState.conversations[id]?.surface ?? null,
        existingTabId:
          tabState.tabs.find(
            (tab) => tab.type === 'conversation' && tab.conversation?.sessionId === id,
          )?.id ?? null,
        previousActiveTabId: tabState.activeTabId,
      }
    }, conversationId)

    await quickTab.dragTo(page.locator('.tab-bar'))
    await page.waitForFunction(
      async (id) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const state = useTabStore.getState()
        const active = state.tabs.find((tab) => tab.id === state.activeTabId)
        return active?.type === 'conversation' && active.conversation?.sessionId === id
      },
      conversationId,
      { timeout: 10_000 },
    )
    const afterFirstDrop = await page.evaluate(async (id) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const agentState = useAgentStore.getState()
      const tabState = useTabStore.getState()
      return {
        activeConversationId: agentState.activeConversationId,
        conversationSurface: agentState.conversations[id]?.surface ?? null,
        conversationTabCount: tabState.tabs.filter(
          (tab) => tab.type === 'conversation' && tab.conversation?.sessionId === id,
        ).length,
        activeTabId: tabState.activeTabId,
      }
    }, conversationId)

    await quickTab.dragTo(page.locator('.tab-bar'))
    const afterSecondDropCount = await page.evaluate(async (id) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      return useTabStore
        .getState()
        .tabs.filter((tab) => tab.type === 'conversation' && tab.conversation?.sessionId === id)
        .length
    }, conversationId)
    assert(
      afterSecondDropCount === afterFirstDrop.conversationTabCount,
      'dropping the same conversation created a duplicate Tab',
    )
    assert(
      afterFirstDrop.activeConversationId === beforeDrop.activeConversationId &&
        afterFirstDrop.conversationSurface === beforeDrop.conversationSurface,
      'dropping the conversation moved or replaced the right-side Thread state',
    )

    await page.evaluate(
      async ({ openedTabId, existingTabId, previousActiveTabId }) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const tabStore = useTabStore.getState()
        if (!existingTabId && openedTabId) tabStore.closeTab(openedTabId)
        if (
          previousActiveTabId &&
          useTabStore.getState().tabs.some((tab) => tab.id === previousActiveTabId)
        ) {
          useTabStore.getState().activateTab(previousActiveTabId)
        }
      },
      {
        openedTabId: afterFirstDrop.activeTabId,
        existingTabId: beforeDrop.existingTabId,
        previousActiveTabId: beforeDrop.previousActiveTabId,
      },
    )
    return 'topbar switcher, thread menu, drag-open, and Tab deduplication verified'
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

  await runCheck('role center separates viewing a role from applying it', async () => {
    await clickByTitle(page, '角色')
    await page.locator('.agent-role-sidebar').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === '角色',
      'role sidebar title missing',
    )
    const roleRows = page.locator('.agent-role-row[data-role-source="builtin"]')
    await roleRows.first().waitFor({ state: 'visible', timeout: 10_000 })
    assert((await roleRows.count()) === 7, 'expected seven built-in roles')
    await page.evaluate(async () => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const state = useAgentStore.getState()
      await state.applyRoleToConversation(
        { roleId: 'default-assistant', version: 1 },
        state.activeConversationId,
      )
    })
    await page
      .locator('.agent-role-row[data-role-source="builtin"].applied')
      .waitFor({ state: 'visible', timeout: 10_000 })

    const appliedRow = page.locator('.agent-role-row.applied')
    assert((await appliedRow.count()) === 1, 'expected exactly one applied role')
    const appliedLabel = await appliedRow.locator('strong').innerText()
    const candidateRow = page.locator('.agent-role-row:not(.applied)').first()
    await candidateRow.click()
    await page.locator('.agent-role-detail').waitFor({ state: 'visible', timeout: 10_000 })
    const roleConfigTabs = page.locator('.tab').filter({ hasText: '角色配置' })
    assert((await roleConfigTabs.count()) === 1, 'expected one global role configuration tab')
    assert(
      await page.getByRole('button', { name: '应用到当前会话' }).isEnabled(),
      'role apply action is not available',
    )
    assert(
      (await page.locator('.agent-role-row.applied strong').innerText()) === appliedLabel,
      'opening a role detail changed the conversation configuration',
    )
    assert(
      await page.getByRole('button', { name: '设为新会话默认' }).isVisible(),
      'new-conversation default action missing',
    )
    for (let index = 0; index < (await roleRows.count()); index += 1) {
      const roleRow = roleRows.nth(index)
      const roleLabel = await roleRow.locator('strong').innerText()
      await roleRow.click()
      await page.locator('[data-role-soul]').waitFor({ state: 'visible', timeout: 10_000 })
      assert(
        await page.getByRole('heading', { name: '人格与原则 · SOUL.md' }).isVisible(),
        `role SOUL preview missing: ${roleLabel}`,
      )
      assert(
        (await page.locator('.agent-role-overview-section li').count()) > 0,
        `role overview content missing: ${roleLabel}`,
      )
      assert(
        (await page.locator('.agent-role-examples-section article').count()) > 0,
        `role examples missing: ${roleLabel}`,
      )
    }

    const challengerRow = roleRows.filter({ hasText: '反方挑战者' })
    await challengerRow.click()
    await page.locator('[data-role-soul]').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      await page.getByRole('heading', { name: '建议 Skills' }).isVisible(),
      'recommended Skills section missing',
    )
    const mountSkillButton = page.getByRole('button', { name: '挂载到当前会话' })
    if ((await mountSkillButton.count()) > 0) {
      await mountSkillButton.click()
    }
    await page.locator('.agent-skill-chip', { hasText: '方案拷问' }).waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    assert(
      await page.getByRole('button', { name: '已挂载' }).isDisabled(),
      'recommended Skill did not become an explicit mounted Skill',
    )
    const mountedSkillRefs = await page.evaluate(async () => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const state = useAgentStore.getState()
      return state.conversations[state.activeConversationId]?.mountedSkills ?? []
    })
    assert(
      JSON.stringify(mountedSkillRefs) === JSON.stringify([{ skillId: 'grill-me', version: 1 }]),
      'mounted Skill was not stored as a versioned reference',
    )
    const nextViewedRow = roleRows.last()
    const nextViewedLabel = await nextViewedRow.locator('strong').innerText()
    await nextViewedRow.click()
    assert(
      (await roleConfigTabs.count()) === 1,
      'switching roles created another configuration tab',
    )
    assert(
      (await page.locator('.agent-role-row.opened strong').innerText()) === nextViewedLabel,
      'singleton role configuration tab did not switch its viewed role',
    )
    assert(
      (await page.locator('.agent-role-row.applied strong').innerText()) === appliedLabel,
      'switching the viewed role changed the conversation configuration',
    )
    assert(
      await page.locator('.agent-skill-chip', { hasText: '方案拷问' }).isVisible(),
      'viewing another role silently removed the mounted Skill',
    )

    const editBuiltinCopyButton = page.getByRole('button', { name: '编辑副本', exact: true })
    assert(await editBuiltinCopyButton.isVisible(), 'built-in role did not expose an edit entry')
    await editBuiltinCopyButton.click()
    await page.locator('[data-role-editor]').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      await page.getByRole('button', { name: '保存为新版本' }).isVisible(),
      'editing a built-in copy did not enter the role editor',
    )

    const customRoleName = `UI Smoke 审稿人 ${Date.now()}`
    const customRoleV2Name = `${customRoleName} v2`
    await page.getByRole('button', { name: '＋ 新建角色' }).click()
    await page.locator('[data-role-editor]').waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByLabel('名称').fill(customRoleName)
    await page.getByLabel('简介').fill('验证本地角色不可变版本与持久化')
    await page.getByLabel('目标（每行一项）').fill('给出可执行的审阅意见')
    await page.getByLabel('行为规则（每行一项）').fill('先区分事实、推断和观点')
    await page.getByRole('button', { name: '创建角色' }).click()
    await page.getByRole('heading', { name: customRoleName, exact: true }).waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    await page.locator('.agent-role-row', { hasText: customRoleName }).waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    await page.getByRole('button', { name: '编辑角色', exact: true }).click()
    await page.getByLabel('名称').fill(customRoleV2Name)
    await page.getByRole('button', { name: '保存为新版本' }).click()
    await page.getByRole('heading', { name: customRoleV2Name, exact: true }).waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    const localVersions = await page.evaluate(async (name) => {
      const roles = await window.cclinkStudio.agent.listRoles()
      const latest = roles.find((role) => role.label === name)
      return latest ? roles.filter((role) => role.roleId === latest.roleId) : []
    }, customRoleV2Name)
    assert(localVersions.length === 2, 'editing a local role overwrote its previous version')
    assert(
      localVersions.some((role) => role.version === 1 && !role.isLatest) &&
        localVersions.some((role) => role.version === 2 && role.isLatest),
      'local role versions do not expose immutable latest/history state',
    )
    await page.getByRole('button', { name: '在新会话试用' }).click()
    const trialRoleRef = await page.evaluate(async () => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const state = useAgentStore.getState()
      return state.conversations[state.activeConversationId]?.configuration.roleRef
    })
    assert(
      trialRoleRef?.roleId === localVersions[1].roleId && trialRoleRef?.version === 2,
      'trial conversation did not pin the selected custom role version',
    )
    await page.getByRole('button', { name: '归档', exact: true }).click()
    await page.waitForFunction(
      () => document.querySelector('.agent-role-detail-eyebrow')?.textContent?.includes('已归档'),
      undefined,
      { timeout: 10_000 },
    )
    assert(
      (await page.locator('.agent-role-detail-eyebrow').innerText()).includes('已归档'),
      'archiving a role did not update the visible role state',
    )
    assert(
      (
        await page.evaluate(async () => {
          const { useAgentStore } = await import('/src/stores/agent-store.ts')
          const state = useAgentStore.getState()
          return state.conversations[state.activeConversationId]?.configuration.roleRef
        })
      )?.roleId === localVersions[1].roleId,
      'archiving a role invalidated an existing pinned conversation',
    )
    await page.getByRole('button', { name: '恢复', exact: true }).click()
    return 'singleton role tab, seven SOUL previews, versioned Skill, and immutable local role versions'
  })

  await runCheck('status bar shows the current Git repository fact', async () => {
    const projectOpened = await page.evaluate(async (workspacePath) => {
      const { useFsStore } = await import('/src/stores/fs-store.ts')
      return useFsStore.getState().openRecentWorkspace(workspacePath)
    }, rootDir)
    assert(projectOpened, 'Git smoke workspace could not be opened')

    const snapshot = await page.evaluate(async (workspacePath) => {
      const { useGitStore } = await import('/src/stores/git-store.ts')
      await useGitStore.getState().loadWorkspace(workspacePath)
      return useGitStore.getState().snapshot
    }, rootDir)
    assert(snapshot, 'renderer Git store did not load a snapshot')
    assert(snapshot.availability === 'available', `Git snapshot unavailable: ${snapshot.error}`)

    const trigger = page.locator('.git-status-trigger')
    await trigger.waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(
      ({ branch, changeCount }) => {
        const text = document.querySelector('.git-status-trigger')?.textContent ?? ''
        return text.includes(branch) && text.includes(String(changeCount))
      },
      { branch: snapshot.branch ?? '', changeCount: snapshot.changeCount },
      { timeout: 10_000 },
    )
    const triggerText = await trigger.innerText()
    assert(triggerText.includes(snapshot.branch ?? ''), 'status bar branch does not match Git')
    assert(
      triggerText.includes(String(snapshot.changeCount)),
      'status bar change count does not match Git',
    )
    const statusBarText = await page.locator('.status-bar').innerText()
    assert(!statusBarText.includes('Agent 就绪'), 'redundant Agent ready status is still visible')
    assert(!statusBarText.includes('编辑器'), 'redundant active Tab type is still visible')
    assert(
      !statusBarText.includes('备份到 Git'),
      'legacy Git backup status action is still visible',
    )

    await trigger.click()
    const popover = page.locator('.git-status-popover')
    await popover.waitFor({ state: 'visible', timeout: 10_000 })
    const popoverText = await popover.innerText()
    assert(popoverText.includes(snapshot.repositoryName ?? ''), 'Git repository name is missing')
    assert(popoverText.includes(snapshot.upstream ?? '未设置上游'), 'Git upstream is missing')
    await popover.locator('.git-status-row-button').click()
    await popover.waitFor({ state: 'hidden', timeout: 10_000 })
    const dialog = page.locator('.git-operation-dialog')
    await dialog.waitFor({ state: 'visible', timeout: 10_000 })
    const changesView = dialog.locator('.git-changes-view')
    await changesView.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await changesView.locator('.git-change-item').count()) >= snapshot.changeCount,
      'Git grouped changes are incomplete',
    )
    const readableChange = changesView.locator('.git-change-item:not(:has(.status-u))').first()
    if ((await readableChange.count()) > 0) {
      await readableChange.click()
      await page.waitForFunction(
        () =>
          Boolean(
            document.querySelector(
              '.git-operation-dialog .git-diff-content, .git-operation-dialog .git-diff-error',
            ),
          ),
        undefined,
        { timeout: 10_000 },
      )
    }
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
    return `${snapshot.branch} · ${snapshot.changeCount} changes · +${snapshot.additions} -${snapshot.deletions}`
  })

  await runCheck('Git compact commit menu executes commit and push actions', async () => {
    const fixtureRoot = await mkdtemp(join(workspaceFixtureRoot, 'git-'))
    const workspacePath = join(fixtureRoot, 'workspace')
    const remotePath = join(fixtureRoot, 'remote.git')
    try {
      await mkdir(workspacePath)
      await runGit(fixtureRoot, ['init', '--bare', remotePath])
      await runGit(workspacePath, ['init', '-b', 'main'])
      await runGit(workspacePath, ['config', 'user.name', 'UI Smoke'])
      await runGit(workspacePath, ['config', 'user.email', 'ui-smoke@example.com'])
      await writeFile(join(workspacePath, 'tracked.txt'), 'initial\n', 'utf8')
      await runGit(workspacePath, ['add', 'tracked.txt'])
      await runGit(workspacePath, ['commit', '-m', 'initial'])
      await runGit(workspacePath, ['remote', 'add', 'origin', remotePath])
      await runGit(workspacePath, ['push', '-u', 'origin', 'main'])
      await writeFile(join(workspacePath, 'tracked.txt'), 'changed\n', 'utf8')
      await runGit(workspacePath, ['add', 'tracked.txt'])
      await writeFile(join(workspacePath, 'leave-untracked.txt'), 'keep local\n', 'utf8')

      const openResult = await page.evaluate(async (path) => {
        const { useFsStore } = await import('/src/stores/fs-store.ts')
        const opened = await useFsStore.getState().openRecentWorkspace(path)
        const state = useFsStore.getState()
        return { opened, error: state.error, workspacePath: state.workspacePath }
      }, workspacePath)
      assert(
        openResult.opened,
        `temporary Git workspace could not be opened: ${JSON.stringify(openResult)}`,
      )

      const browserTabId = await page.evaluate(async (initialUrl) => {
        const [{ openDefaultBrowserTab }, { useWorkspaceStore }] = await Promise.all([
          import('/src/features/web-resources/open-default-browser-tab.ts'),
          import('/src/stores/workspace-store.ts'),
        ])
        const result = await openDefaultBrowserTab(
          useWorkspaceStore.getState().activeWorkspaceRef,
          {
            title: 'Git native view occlusion fixture',
            initialUrl,
          },
        )
        return result.tabId
      }, `${webFixtureOrigin}/git-native-view-occlusion`)
      assert(browserTabId, 'browser tab did not become active for Git occlusion coverage')
      await page.waitForFunction(
        async (tabId) => (await window.cclinkStudio.browser.getActiveViewId()) === tabId,
        browserTabId,
        { timeout: 10_000 },
      )

      const scopeProjectionResult = await page.evaluate(async (tabId) => {
        const [{ useTabStore }, { useAgentStore }] = await Promise.all([
          import('/src/stores/tab-store.ts'),
          import('/src/stores/agent-store.ts'),
        ])
        useTabStore
          .getState()
          .openTab({ type: 'settings', title: 'Native View isolation', icon: '⚙️' })
        const conversationId = useAgentStore.getState().activeConversationId
        const status = await window.cclinkStudio.agent.getStatus(conversationId)
        return {
          agentReady: status.ready,
          scopeSwitched: status.ready
            ? await window.cclinkStudio.agent.setScope(conversationId, {
                kind: 'browser',
                instanceId: tabId,
              })
            : false,
        }
      }, browserTabId)
      assert(
        !scopeProjectionResult.agentReady || scopeProjectionResult.scopeSwitched,
        'Agent browser scope could not bind to the test page',
      )
      await page.waitForFunction(
        async () => (await window.cclinkStudio.browser.getActiveViewId()) === null,
        undefined,
        { timeout: 10_000 },
      )
      await page.evaluate(async (tabId) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        useTabStore.getState().activateTab(tabId)
      }, browserTabId)
      await page.waitForFunction(
        async (tabId) => (await window.cclinkStudio.browser.getActiveViewId()) === tabId,
        browserTabId,
        { timeout: 10_000 },
      )

      const trigger = page.locator('.git-status-trigger')
      await trigger.waitFor({ state: 'visible', timeout: 10_000 })
      await trigger.click()
      const popover = page.locator('.git-status-popover')
      await popover.getByRole('button', { name: '提交…', exact: true }).click()
      const dialog = page.locator('.git-operation-dialog')
      await dialog.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForFunction(
        async () => (await window.cclinkStudio.browser.getActiveViewId()) === null,
        undefined,
        { timeout: 10_000 },
      )
      const commitView = dialog.locator('.git-commit-view')
      await commitView.waitFor({ state: 'visible', timeout: 10_000 })
      assert(
        await dialog.evaluate((element) => element.classList.contains('compact')),
        'Git commit dialog is not compact',
      )
      const compactBox = await dialog.boundingBox()
      assert(
        compactBox && compactBox.width <= 620 && compactBox.height < 500,
        'Git commit dialog is still oversized',
      )
      const includeUnstaged = commitView.getByRole('checkbox', {
        name: '包含未暂存的更改',
        exact: true,
      })
      assert(
        await includeUnstaged.isChecked(),
        'Git compact menu did not include unstaged changes by default',
      )
      await commitView.getByPlaceholder('提交信息（留空将自动生成）').fill('discarded draft')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
      await trigger.click()
      await page
        .locator('.git-status-popover')
        .getByRole('button', { name: '提交…', exact: true })
        .click()
      await dialog.waitFor({ state: 'visible', timeout: 10_000 })
      assert(
        (await commitView.getByPlaceholder('提交信息（留空将自动生成）').inputValue()) === '',
        'closing the Git dialog kept an obsolete commit message draft',
      )
      assert(
        await includeUnstaged.isChecked(),
        'reopening the Git dialog did not restore the default include behavior',
      )
      await includeUnstaged.uncheck()
      await commitView.getByRole('button', { name: '提交', exact: true }).click()
      await dialog
        .locator('.git-operation-notice.success', { hasText: '提交成功' })
        .waitFor({ state: 'visible', timeout: 10_000 })

      const afterCommit = await page.evaluate(
        (path) => window.cclinkStudio.git.getSnapshot(path),
        workspacePath,
      )
      assert(afterCommit.ahead === 1, 'local commit did not become one commit ahead')
      assert(
        afterCommit.changes.some((change) => change.path === 'leave-untracked.txt'),
        'unselected untracked file was unexpectedly committed',
      )
      const generatedMessage = (
        await runGit(workspacePath, ['log', '-1', '--pretty=%s'])
      ).stdout.trim()
      assert(generatedMessage === '更新 tracked.txt', 'empty commit message was not generated')

      await dialog.getByRole('button', { name: '推送', exact: true }).click()
      await dialog
        .locator('.git-operation-notice.success', { hasText: 'Push 成功' })
        .waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForFunction(
        async (path) => (await window.cclinkStudio.git.getSnapshot(path)).ahead === 0,
        workspacePath,
        { timeout: 10_000 },
      )

      await writeFile(join(workspacePath, 'tracked.txt'), 'changed again\n', 'utf8')
      await dialog.getByRole('button', { name: '关闭 Git 窗口', exact: true }).click()
      await page.evaluate(async () => {
        const { useGitStore } = await import('/src/stores/git-store.ts')
        await useGitStore.getState().refresh()
      })
      await trigger.click()
      await page
        .locator('.git-status-popover')
        .getByRole('button', { name: '提交…', exact: true })
        .click()
      await dialog.waitFor({ state: 'visible', timeout: 10_000 })
      await commitView.getByRole('button', { name: '提交并推送', exact: true }).click()
      await dialog
        .locator('.git-operation-notice.success', { hasText: '提交并 Push 成功' })
        .waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForFunction(
        async (path) => (await window.cclinkStudio.git.getSnapshot(path)).ahead === 0,
        workspacePath,
        { timeout: 10_000 },
      )
      const localHead = (await runGit(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()
      const remoteHead = (
        await runGit(fixtureRoot, ['--git-dir', remotePath, 'rev-parse', 'refs/heads/main'])
      ).stdout.trim()
      assert(localHead === remoteHead, 'remote HEAD does not match the confirmed local commit')
      await dialog.getByRole('button', { name: '关闭 Git 窗口', exact: true }).click()
      return 'compact layout, default include toggle, generated message, commit, push, and combined action verified'
    } finally {
      await page.evaluate(async (path) => {
        const { useFsStore } = await import('/src/stores/fs-store.ts')
        return useFsStore.getState().openRecentWorkspace(path)
      }, rootDir)
      await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  await runCheck(globalWebResourcesCheck, async () => {
    const projectOpened = await page.evaluate(async (workspacePath) => {
      const { useFsStore } = await import('/src/stores/fs-store.ts')
      return useFsStore.getState().openRecentWorkspace(workspacePath)
    }, rootDir)
    assert(projectOpened, 'smoke project could not be opened')

    await clickByTitle(page, '网站与账号')
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === '网站与账号',
      'web resources panel missing',
    )

    const ordinarySourceTabId = await page.evaluate(async (fixtureOrigin) => {
      const [{ openDefaultBrowserTab }, { useWorkspaceStore }] = await Promise.all([
        import('/src/features/web-resources/open-default-browser-tab.ts'),
        import('/src/stores/workspace-store.ts'),
      ])
      return (
        await openDefaultBrowserTab(useWorkspaceStore.getState().activeWorkspaceRef, {
          title: '普通登录页面',
          initialUrl: `${fixtureOrigin}/login-popup-source`,
        })
      ).tabId
    }, webFixtureOrigin)
    assert(ordinarySourceTabId, 'ordinary source tab was not created')
    await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(
      async ({ tabId, expectedUrl }) =>
        (await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)).visibleUrl === expectedUrl,
      {
        tabId: ordinarySourceTabId,
        expectedUrl: `${webFixtureOrigin}/login-popup-source`,
      },
      { timeout: 10_000 },
    )
    await page.waitForFunction(
      async (tabId) =>
        (
          await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
        ).session?.likelyAuthCookies.some((cookie) => cookie.name === 'cclink_auth_marker'),
      ordinarySourceTabId,
      { timeout: 10_000 },
    )
    const ordinarySiblingTabId = await page.evaluate(async (fixtureOrigin) => {
      const [{ openDefaultBrowserTab }, { useWorkspaceStore }] = await Promise.all([
        import('/src/features/web-resources/open-default-browser-tab.ts'),
        import('/src/stores/workspace-store.ts'),
      ])
      return (
        await openDefaultBrowserTab(useWorkspaceStore.getState().activeWorkspaceRef, {
          title: '普通登录环境页面',
          initialUrl: `${fixtureOrigin}/login-popup-target`,
        })
      ).tabId
    }, webFixtureOrigin)
    assert(ordinarySiblingTabId, 'ordinary sibling tab was not created')
    await page.waitForFunction(
      async ({ tabId, expectedUrl }) =>
        (await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)).visibleUrl === expectedUrl,
      {
        tabId: ordinarySiblingTabId,
        expectedUrl: `${webFixtureOrigin}/login-popup-target`,
      },
      { timeout: 10_000 },
    )
    const ordinarySiblingRuntime = await page.evaluate(
      (tabId) => window.cclinkStudio.browser.getRuntimeDiagnostics(tabId),
      ordinarySiblingTabId,
    )
    assert(
      ordinarySiblingRuntime.profileId === null &&
        ordinarySiblingRuntime.session?.likelyAuthCookies.some(
          (cookie) => cookie.name === 'cclink_auth_marker',
        ),
      'ordinary tabs did not share the default persistent login session',
    )
    assert(
      (await page.locator('.browser-environment-badge').innerText()) === '默认环境',
      'ordinary browser mode was not visible in the toolbar',
    )
    assert(
      (await page.getByRole('button', { name: '登录完成，保存账号和登录状态' }).count()) === 0,
      'ordinary browser incorrectly exposed the account save action',
    )
    await page.evaluate(
      ({ sourceTabId, siblingTabId }) => {
        return import('/src/stores/tab-store.ts').then(({ useTabStore }) => {
          if (sourceTabId) useTabStore.getState().closeTab(sourceTabId)
          if (siblingTabId) useTabStore.getState().closeTab(siblingTabId)
        })
      },
      { sourceTabId: ordinarySourceTabId, siblingTabId: ordinarySiblingTabId },
    )

    const accountLabel = `UI Smoke Account ${Date.now()}`
    await page.evaluate(async (fixtureOrigin) => {
      const [{ useAgentStore }, { useWorkspaceStore }, { useUIStore }] = await Promise.all([
        import('/src/stores/agent-store.ts'),
        import('/src/stores/workspace-store.ts'),
        import('/src/stores/ui-store.ts'),
      ])
      const agentStore = useAgentStore.getState()
      const conversationId = agentStore.createConversation({
        surface: 'assistant-panel',
        runtime: {
          location: 'local',
          transport: 'local',
          backend: 'cclink-studio-agent',
          workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
        },
        activate: true,
      })
      const runId = useAgentStore.getState().beginRun(conversationId)
      useAgentStore
        .getState()
        .startStreamingMessage(`smoke-agent-link-${Date.now()}`, conversationId, runId)
      useAgentStore
        .getState()
        .appendStreamDelta(`[打开登录测试页](${fixtureOrigin}/login-popup-source)`, conversationId)
      useAgentStore.getState().finishStreamingMessage(conversationId, runId)
      useUIStore.getState().setAgentPanelMode('right', 'user')
    }, webFixtureOrigin)
    const agentLink = page.locator(
      '[data-agent-panel-runtime="local"] .agent-message.assistant .conversation-markdown a',
      { hasText: '打开登录测试页' },
    )
    await agentLink.waitFor({ state: 'visible', timeout: 10_000 })
    await agentLink.click()

    await page.waitForFunction(
      async (expectedUrl) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const tabId = useTabStore.getState().activeTabId
        const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
        return Boolean(
          tab &&
          !tab.browserProfile &&
          !tab.webResourceRef &&
          !tab.webResourceDraftRef &&
          tab.initialUrl === expectedUrl,
        )
      },
      `${webFixtureOrigin}/login-popup-source`,
      { timeout: 10_000 },
    )
    const ordinaryAgentTabId = await page.evaluate(async () => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const state = useTabStore.getState()
      const tab = state.tabs.find((item) => item.id === state.activeTabId)
      return tab?.type === 'browser' ? tab.id : null
    })
    assert(ordinaryAgentTabId, 'Agent link did not open an ordinary browser tab')
    await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(
      async (tabId) =>
        (await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)).visibleUrl?.endsWith(
          '/login-popup-source',
        ),
      ordinaryAgentTabId,
      { timeout: 10_000 },
    )
    assert(
      (await page.locator('.browser-environment-badge').innerText()) === '默认环境',
      'Agent link without an account did not use ordinary browsing',
    )
    assert(
      await page.evaluate(async (tabId) => {
        const runtime = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
        return (
          runtime.profileId === null &&
          runtime.session?.likelyAuthCookies.some((cookie) => cookie.name === 'cclink_auth_marker')
        )
      }, ordinaryAgentTabId),
      'Agent ordinary browser did not inherit the default login session',
    )
    await page.evaluate(async (tabId) => {
      const [{ useTabStore }, { useUIStore }] = await Promise.all([
        import('/src/stores/tab-store.ts'),
        import('/src/stores/ui-store.ts'),
      ])
      useTabStore.getState().closeTab(tabId)
      const uiStore = useUIStore.getState()
      uiStore.setAgentPanelMode('hidden', 'user')
      uiStore.setActivePanel('operations')
      // setActivePanel can also expand/collapse the sidebar. Re-read Zustand after that
      // transition instead of deciding from the stale snapshot captured above.
      if (!useUIStore.getState().sidebarVisible) useUIStore.getState().toggleSidebar()
    }, ordinaryAgentTabId)
    await page.waitForFunction(async () => {
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      const state = useUIStore.getState()
      return (
        state.agentPanelMode === 'hidden' &&
        state.sidebarVisible &&
        state.activePanel === 'operations'
      )
    })
    await page
      .locator('.sidebar-header-title', { hasText: '网站与账号' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    await page.getByRole('button', { name: '添加网站与账号' }).click()
    await page.waitForFunction(async () => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const state = useTabStore.getState()
      const tab = state.tabs.find((item) => item.id === state.activeTabId)
      return Boolean(tab?.webResourceDraftRef && tab.browserProfile)
    })
    const draftBrowser = await page.evaluate(async () => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const state = useTabStore.getState()
      const tab = state.tabs.find((item) => item.id === state.activeTabId)
      return tab?.webResourceDraftRef && tab.browserProfile
        ? {
            tabId: tab.id,
            profileId: tab.browserProfile,
            draftId: tab.webResourceDraftRef.draftId,
          }
        : null
    })
    assert(draftBrowser, 'explicit add account did not create an isolated draft session')
    await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await page.locator('.browser-environment-badge').innerText()) === '新账号环境',
      'account draft mode was not visible in the toolbar',
    )
    assert(
      await page.evaluate(async (tabId) => {
        const runtime = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
        return (
          Boolean(runtime.profileId) &&
          !runtime.session?.likelyAuthCookies.some((cookie) => cookie.name === 'cclink_auth_marker')
        )
      }, draftBrowser.tabId),
      'new account draft copied the ordinary browser login cookie',
    )
    await page.locator('.url-input').fill(`${webFixtureOrigin}/login-popup-source`)
    await page.locator('.url-input').press('Enter')
    await page.waitForFunction(
      async (tabId) =>
        (await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)).visibleUrl?.endsWith(
          '/login-popup-source',
        ),
      draftBrowser.tabId,
      { timeout: 10_000 },
    )

    const sourcePage = await (async () => {
      const startedAt = Date.now()
      while (Date.now() - startedAt < 10_000) {
        const candidate = browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((item) => item.url() === `${webFixtureOrigin}/login-popup-source`)
        if (candidate) return candidate
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('embedded browser fixture page was not found over CDP')
    })()
    await sourcePage.locator('#open-login').click()
    const popupTab = await page.waitForFunction(
      async ({ sourceTabId, draftId }) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const popup = useTabStore
          .getState()
          .tabs.find(
            (item) => item.id !== sourceTabId && item.webResourceDraftRef?.draftId === draftId,
          )
        return popup
          ? {
              tabId: popup.id,
              profileId: popup.browserProfile ?? null,
              draftId: popup.webResourceDraftRef?.draftId ?? null,
            }
          : null
      },
      { sourceTabId: draftBrowser.tabId, draftId: draftBrowser.draftId },
      { timeout: 10_000 },
    )
    const popup = await popupTab.jsonValue()
    assert(popup?.profileId === draftBrowser.profileId, 'login popup replaced the source Profile')
    assert(popup?.draftId === draftBrowser.draftId, 'login popup lost the source account draft')

    const popupPage = await (async () => {
      const startedAt = Date.now()
      while (Date.now() - startedAt < 10_000) {
        const candidate = browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((item) => item.url() === `${webFixtureOrigin}/login-popup-target`)
        if (candidate) return candidate
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('embedded login popup page was not found over CDP')
    })()
    const pageInstanceMarker = `account-save-instance-${Date.now()}`
    await popupPage.evaluate((marker) => {
      window.__cclinkAccountSaveInstance = marker
    }, pageInstanceMarker)

    const runtimeBeforeSave = await page.evaluate(
      (tabId) => window.cclinkStudio.browser.getRuntimeDiagnostics(tabId),
      popup.tabId,
    )
    assert(
      runtimeBeforeSave.session?.likelyAuthCookies.some(
        (cookie) => cookie.name === 'cclink_auth_marker',
      ),
      'login marker cookie was not present before saving',
    )
    const saveLoginButton = page.getByRole('button', {
      name: '登录完成，保存账号和登录状态',
    })
    await saveLoginButton.waitFor({ state: 'visible', timeout: 10_000 })
    await saveLoginButton.click()
    await page.locator('.browser-resource-save').waitFor({ state: 'visible', timeout: 10_000 })
    const runtimeAfterSaveClick = await page.evaluate(
      (tabId) => window.cclinkStudio.browser.getRuntimeDiagnostics(tabId),
      popup.tabId,
    )
    assert(
      runtimeAfterSaveClick.profileId === runtimeBeforeSave.profileId,
      'save click changed Profile',
    )
    assert(
      runtimeAfterSaveClick.visibleUrl === runtimeBeforeSave.visibleUrl,
      'save click replaced the logged-in page',
    )
    assert(
      runtimeAfterSaveClick.session?.likelyAuthCookies.some(
        (cookie) => cookie.name === 'cclink_auth_marker',
      ),
      'save click removed the login cookie',
    )
    const accountNameInput = page.getByLabel('账号手机号或平台用户名')
    await accountNameInput.fill('')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page
      .getByText('请输入账号显示名称', { exact: true })
      .waitFor({ state: 'visible', timeout: 5_000 })
    await accountNameInput.fill(accountLabel)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForFunction(
      async (label) => {
        const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
        const result = await window.cclinkStudio.webResources.getSnapshot({
          workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
        })
        return (
          result.success &&
          result.data.accounts.some((account) => account.label === label && !account.archivedAt)
        )
      },
      accountLabel,
      { timeout: 30_000 },
    )
    await page
      .locator('.browser-environment-badge', { hasText: `账号 · ${accountLabel}` })
      .waitFor({ state: 'visible', timeout: 10_000 })
    const runtimeAfterCommit = await page.evaluate(
      (tabId) => window.cclinkStudio.browser.getRuntimeDiagnostics(tabId),
      popup.tabId,
    )
    assert(runtimeAfterCommit.profileId === runtimeBeforeSave.profileId, 'commit changed Profile')
    assert(
      runtimeAfterCommit.visibleUrl === runtimeBeforeSave.visibleUrl,
      'commit replaced the logged-in page',
    )
    assert(
      runtimeAfterCommit.session?.likelyAuthCookies.some(
        (cookie) => cookie.name === 'cclink_auth_marker',
      ),
      'commit removed the login cookie',
    )
    assert(
      (await popupPage.evaluate(() => window.__cclinkAccountSaveInstance)) === pageInstanceMarker,
      'commit replaced the embedded page instance',
    )
    const savedProjection = await page.evaluate(async (tabId) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
      return tab
        ? {
            profileId: tab.browserProfile ?? null,
            accountId: tab.webResourceRef?.accountId ?? null,
            draftId: tab.webResourceDraftRef?.draftId ?? null,
          }
        : null
    }, popup.tabId)
    assert(savedProjection?.profileId === draftBrowser.profileId, 'saved Tab changed Profile')
    assert(savedProjection?.accountId, 'saved Tab has no account binding')
    assert(!savedProjection?.draftId, 'saved Tab still has a draft binding')
    await page.waitForFunction(
      async (tabId) => {
        const runtime = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
        return runtime.viewState?.zoomMode === 'fit' && runtime.viewState.zoomFactor >= 0.99
      },
      popup.tabId,
      { timeout: 10_000 },
    )
    assert(
      await page.evaluate(async (tabId) => {
        const { closeTabWithDraftPolicy } = await import('/src/utils/close-tab.ts')
        return closeTabWithDraftPolicy(tabId)
      }, popup.tabId),
      'shared login popup did not close cleanly',
    )
    assert(
      await page.evaluate(async (tabId) => {
        const { closeTabWithDraftPolicy } = await import('/src/utils/close-tab.ts')
        return closeTabWithDraftPolicy(tabId)
      }, draftBrowser.tabId),
      'explicit account source tab did not close cleanly',
    )

    const primaryRow = () => page.locator('.web-resource-row', { hasText: accountLabel })
    const accountAlreadyExists = await page.evaluate(async (label) => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const result = await window.cclinkStudio.webResources.getSnapshot({
        workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
      })
      return (
        result.success &&
        result.data.accounts.some((account) => account.label === label && !account.archivedAt)
      )
    }, accountLabel)
    if (!accountAlreadyExists) {
      await page.getByRole('button', { name: '添加网站与账号' }).click()
      await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
      assert(
        (await page.locator('.web-resources-form:not(.web-resources-import-form)').count()) === 0,
        'adding a website account opened a sidebar form',
      )
      const accountFixtureUrl = `${webFixtureOrigin}/cclink-web-affairs-smoke`
      await page.locator('.url-input').fill(accountFixtureUrl)
      await page.locator('.url-input').press('Enter')
      await page.waitForFunction(
        async (expectedUrl) => {
          const { useTabStore } = await import('/src/stores/tab-store.ts')
          const tabId = useTabStore.getState().activeTabId
          if (!tabId) return false
          const diagnostic = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
          return diagnostic.visibleUrl === expectedUrl
        },
        accountFixtureUrl,
        { timeout: 10_000 },
      )
      await page.waitForFunction(
        async (expectedUrl) => {
          const [{ useTabStore }, { useBrowserStore }] = await Promise.all([
            import('/src/stores/tab-store.ts'),
            import('/src/stores/browser-store.ts'),
          ])
          const tabId = useTabStore.getState().activeTabId
          if (!tabId) return false
          const state = useBrowserStore.getState().tabs[tabId]
          return [state?.url, state?.urlInput].some((value) => value === expectedUrl)
        },
        accountFixtureUrl,
        { timeout: 10_000 },
      )
      await page.waitForFunction(
        (expectedUrl) => document.querySelector('.url-input')?.value === expectedUrl,
        accountFixtureUrl,
        { timeout: 10_000 },
      )
      await page.getByRole('button', { name: '登录完成，保存账号和登录状态' }).click()
      const accountNameInput = page.getByLabel('账号手机号或平台用户名')
      await accountNameInput.fill('')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await page
        .getByText('请输入账号显示名称', { exact: true })
        .waitFor({ state: 'visible', timeout: 5_000 })
      assert(
        (await primaryRow().count()) === 0,
        'empty account name unexpectedly created a project resource',
      )
      await accountNameInput.fill(accountLabel)
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await page.waitForFunction(
        async (label) => {
          const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
          const result = await window.cclinkStudio.webResources.getSnapshot({
            workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
          })
          return (
            result.success &&
            result.data.accounts.some((account) => account.label === label && !account.archivedAt)
          )
        },
        accountLabel,
        { timeout: 30_000 },
      )
      await page.waitForFunction(
        async () => {
          const { useTabStore } = await import('/src/stores/tab-store.ts')
          const tabId = useTabStore.getState().activeTabId
          if (!tabId) return false
          const runtime = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
          return runtime.viewState?.zoomMode === 'fit' && runtime.viewState.zoomFactor >= 0.99
        },
        undefined,
        { timeout: 10_000 },
      )
    }

    await clickByTitle(page, '文件')
    await clickByTitle(page, '网站与账号')
    await primaryRow().waitFor({ state: 'visible', timeout: 10_000 })
    const rowText = await primaryRow().innerText()
    assert(rowText.includes(accountLabel), 'saved account label is not visible')
    await primaryRow()
      .locator('.web-resource-row-open')
      .evaluate((element) => element.click())
    await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
    const zoomInput = page.getByLabel('浏览器缩放百分比')
    await zoomInput.waitFor({ state: 'visible', timeout: 10_000 })
    const zoomGroup = page.locator('.browser-zoom-group')
    const fitZoomGroupBounds = await zoomGroup.boundingBox()
    assert(fitZoomGroupBounds, 'fit zoom controls have no visible bounds')
    const activeBrowserTabId = await page.evaluate(async () => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      return useTabStore.getState().activeTabId
    })
    assert(activeBrowserTabId, 'saved account Browser Tab is not active')
    const baselineCapture = readPngDimensions(
      await page.evaluate(
        async (tabId) => window.cclinkStudio.browser.capturePage(tabId),
        activeBrowserTabId,
      ),
    )
    const baselineWorkbenchWidth = await page
      .locator('.workbench-content')
      .evaluate((element) => element.getBoundingClientRect().width)
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/stores/settings-store.ts')
      await useSettingsStore.getState().updateSettings({ appZoomLevel: -5 })
    })
    await page.waitForFunction(
      (previousWidth) =>
        document.querySelector('.workbench-content')?.getBoundingClientRect().width >
        previousWidth * 2,
      baselineWorkbenchWidth,
      { timeout: 10_000 },
    )
    const reducedAppZoomCapture = readPngDimensions(
      await page.evaluate(
        async (tabId) => window.cclinkStudio.browser.capturePage(tabId),
        activeBrowserTabId,
      ),
    )
    assert(
      reducedAppZoomCapture.width > baselineCapture.width,
      `Browser View stayed narrow after app zoom settled: ${baselineCapture.width} -> ${reducedAppZoomCapture.width}`,
    )
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/stores/settings-store.ts')
      await useSettingsStore.getState().updateSettings({ appZoomLevel: 0 })
    })
    await page.waitForFunction(
      (previousWidth) =>
        Math.abs(
          (document.querySelector('.workbench-content')?.getBoundingClientRect().width ?? 0) -
            previousWidth,
        ) <= 2,
      baselineWorkbenchWidth,
      { timeout: 10_000 },
    )
    await page.waitForFunction(
      async ({ tabId, expectedWidth }) => {
        const dataUrl = await window.cclinkStudio.browser.capturePage(tabId)
        if (!dataUrl?.startsWith('data:image/png;base64,')) return false
        const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
        if (binary.length < 24) return false
        const width =
          ((binary.charCodeAt(16) << 24) >>> 0) |
          (binary.charCodeAt(17) << 16) |
          (binary.charCodeAt(18) << 8) |
          binary.charCodeAt(19)
        return Math.abs(width - expectedWidth) <= 4
      },
      { tabId: activeBrowserTabId, expectedWidth: baselineCapture.width },
      { timeout: 10_000 },
    )
    await zoomInput.fill('125')
    await zoomInput.press('Enter')
    await page.waitForFunction(
      async () => {
        const viewState = await window.cclinkStudio.browser.getViewState()
        return viewState?.zoomMode === 'manual' && Math.abs(viewState.zoomFactor - 1.25) < 0.001
      },
      undefined,
      { timeout: 10_000 },
    )
    const manualZoomGroupBounds = await zoomGroup.boundingBox()
    assert(manualZoomGroupBounds, 'manual zoom controls have no visible bounds')
    assert(
      Math.abs(manualZoomGroupBounds.x - fitZoomGroupBounds.x) <= 1 &&
        Math.abs(manualZoomGroupBounds.width - fitZoomGroupBounds.width) <= 1,
      'zoom controls shifted horizontally when fit mode changed to manual mode',
    )
    await page.getByRole('button', { name: '适应宽度' }).click()
    await page.waitForFunction(
      async () => (await window.cclinkStudio.browser.getViewState())?.zoomMode === 'fit',
      undefined,
      { timeout: 10_000 },
    )
    await zoomInput.fill('30')
    await zoomInput.press('Enter')
    await page.waitForFunction(
      async () => {
        const viewState = await window.cclinkStudio.browser.getViewState()
        return viewState?.zoomMode === 'manual' && Math.abs(viewState.zoomFactor - 0.3) < 0.001
      },
      undefined,
      { timeout: 10_000 },
    )
    const reloadTarget = await page.evaluate(async () => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const tabId = useTabStore.getState().activeTabId
      if (!tabId) throw new Error('no active Browser Tab for fit-width reload regression')
      const before = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
      await window.cclinkStudio.browser.reload(tabId)
      return { tabId, previousClaimAt: before.lastClaim?.timestamp ?? 0 }
    })
    await page.waitForFunction(
      async ({ tabId, previousClaimAt }) => {
        const diagnostic = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
        return (diagnostic.lastClaim?.timestamp ?? 0) > previousClaimAt
      },
      reloadTarget,
      { timeout: 10_000 },
    )
    await page.getByRole('button', { name: '适应宽度' }).click()
    await page.waitForFunction(
      async () => {
        const viewState = await window.cclinkStudio.browser.getViewState()
        return viewState?.zoomMode === 'fit' && viewState.zoomFactor >= 0.99
      },
      undefined,
      { timeout: 10_000 },
    )
    await page
      .locator('.browser-zoom-value .zoom-mode-label', { hasText: '自动' })
      .waitFor({ state: 'visible', timeout: 10_000 })

    const accountBeforeHistory = await page.evaluate(async (tabId) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
      const runtime = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
      return {
        profileId: tab?.browserProfile ?? null,
        accountId: tab?.webResourceRef?.accountId ?? null,
        url: runtime.visibleUrl,
      }
    }, activeBrowserTabId)
    await clickByTitle(page, '浏览器')
    const historySourceByTitle = page.locator(
      `.browser-sidebar-history-list .browser-sidebar-row-main[title="${webFixtureOrigin}/login-popup-source"]`,
    )
    await historySourceByTitle.first().waitFor({ state: 'visible', timeout: 10_000 })
    await historySourceByTitle.first().click()
    const historyOrdinary = await page.waitForFunction(
      async ({ accountTabId }) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const state = useTabStore.getState()
        const active = state.tabs.find((item) => item.id === state.activeTabId)
        if (
          !active ||
          active.id === accountTabId ||
          active.browserProfile ||
          active.webResourceRef ||
          active.webResourceDraftRef
        ) {
          return null
        }
        return {
          tabId: active.id,
          profileId: active.browserProfile ?? null,
          ordinary: true,
        }
      },
      { accountTabId: activeBrowserTabId },
      { timeout: 10_000 },
    )
    const historyOrdinaryValue = await historyOrdinary.jsonValue()
    assert(
      historyOrdinaryValue?.ordinary && historyOrdinaryValue.profileId === null,
      'history entry did not open in the ordinary browser session',
    )
    const accountAfterHistory = await page.evaluate(async (tabId) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
      const runtime = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
      return {
        profileId: tab?.browserProfile ?? null,
        accountId: tab?.webResourceRef?.accountId ?? null,
        url: runtime.visibleUrl,
      }
    }, activeBrowserTabId)
    assert(
      accountAfterHistory.profileId === accountBeforeHistory.profileId &&
        accountAfterHistory.accountId === accountBeforeHistory.accountId &&
        accountAfterHistory.url === accountBeforeHistory.url,
      'history entry mutated the existing saved account Tab',
    )
    await page.evaluate(async (tabId) => {
      const { closeTabWithDraftPolicy } = await import('/src/utils/close-tab.ts')
      await closeTabWithDraftPolicy(tabId)
    }, historyOrdinaryValue.tabId)
    await clickByTitle(page, '网站与账号')

    const markdownLinkEditorTabId = await page.evaluate(async (fixtureOrigin) => {
      const [{ useTabStore }, { useWorkspaceStore }] = await Promise.all([
        import('/src/stores/tab-store.ts'),
        import('/src/stores/workspace-store.ts'),
      ])
      useTabStore.getState().openTab({
        type: 'editor',
        title: 'Markdown 链接验收.md',
        icon: '📄',
        initialContent: `[打开 Markdown 测试页](${fixtureOrigin}/markdown-link-target)`,
        workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
        forceNew: true,
      })
      return useTabStore.getState().activeTabId
    }, webFixtureOrigin)
    assert(markdownLinkEditorTabId, 'Markdown link fixture editor did not open')
    const markdownLink = page.locator('.markdown-editor-wrapper .tiptap a', {
      hasText: '打开 Markdown 测试页',
    })
    await markdownLink.waitFor({ state: 'visible', timeout: 10_000 })
    await markdownLink.click()
    await page.waitForFunction(
      async ({ expectedUrl, editorTabId }) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const state = useTabStore.getState()
        const tab = state.tabs.find((item) => item.id === state.activeTabId)
        return Boolean(
          tab &&
          tab.id !== editorTabId &&
          tab.initialUrl === expectedUrl &&
          !tab.browserProfile &&
          !tab.webResourceRef &&
          !tab.webResourceDraftRef,
        )
      },
      {
        expectedUrl: `${webFixtureOrigin}/markdown-link-target`,
        editorTabId: markdownLinkEditorTabId,
      },
      { timeout: 10_000 },
    )
    const markdownOrdinary = await page.evaluate(async () => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const state = useTabStore.getState()
      const tab = state.tabs.find((item) => item.id === state.activeTabId)
      return tab?.type === 'browser' &&
        !tab.browserProfile &&
        !tab.webResourceRef &&
        !tab.webResourceDraftRef
        ? { tabId: tab.id }
        : null
    })
    assert(markdownOrdinary, 'Markdown DOM link did not open in ordinary browsing')
    assert(
      await page.evaluate(async (tabId) => {
        const runtime = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
        return runtime.session?.likelyAuthCookies.some(
          (cookie) => cookie.name === 'cclink_auth_marker',
        )
      }, markdownOrdinary.tabId),
      'Markdown ordinary browser did not reuse the default login session',
    )
    await page.evaluate(
      async ({ browserTabId, editorTabId }) => {
        const [{ closeTabWithDraftPolicy }, { useTabStore }] = await Promise.all([
          import('/src/utils/close-tab.ts'),
          import('/src/stores/tab-store.ts'),
        ])
        await closeTabWithDraftPolicy(browserTabId)
        useTabStore.getState().closeTab(editorTabId)
      },
      { browserTabId: markdownOrdinary.tabId, editorTabId: markdownLinkEditorTabId },
    )

    const tabCountBeforeDraft = await page.locator('.tab').count()
    await createTabFromMenu(page, 'Markdown 草稿')
    await page.locator('.markdown-editor-wrapper').waitFor({ state: 'visible', timeout: 10_000 })
    const tabCountWithDraft = await page.locator('.tab').count()
    assert(tabCountWithDraft === tabCountBeforeDraft + 1, 'draft tab did not open')
    await primaryRow()
      .locator('.web-resource-row-open')
      .evaluate((element) => element.click())
    await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await page.locator('.tab').count()) === tabCountWithDraft,
      'reopening one website account created a duplicate Browser Tab',
    )

    const matrixName = 'UI Smoke Matrix'
    const matrixRow = () => page.locator('.web-resource-group-row', { hasText: matrixName })
    if ((await matrixRow().count()) === 0) {
      await page.getByRole('button', { name: '新建矩阵' }).click()
      const matrixForm = page.locator('.web-resources-form', { hasText: '新建运营矩阵' })
      await matrixForm.getByLabel('矩阵名称').fill(matrixName)
      await matrixForm
        .locator('label', { hasText: accountLabel })
        .locator('input[type="checkbox"]')
        .check()
      await matrixForm.getByRole('button', { name: '保存', exact: true }).click()
    }
    await matrixRow().waitFor({ state: 'visible', timeout: 10_000 })

    const globalIdentity = await page.evaluate(async (label) => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const snapshot = await window.cclinkStudio.webResources.getSnapshot({
        workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
      })
      if (!snapshot.success) throw new Error(snapshot.error.message)
      const account = snapshot.data.accounts.find(
        (item) => item.label === label && !item.archivedAt,
      )
      if (!account) throw new Error('global smoke account missing')
      return { accountId: account.id, browserProfileId: account.browserProfileId }
    }, accountLabel)
    const secondProjectPath = join(workspaceFixtureRoot, 'project-b')
    await mkdir(secondProjectPath, { recursive: true })
    await writeFile(join(secondProjectPath, 'README.md'), '# UI Smoke Project B\n', 'utf8')
    try {
      const openedSecond = await page.evaluate(async (workspacePath) => {
        const { useFsStore } = await import('/src/stores/fs-store.ts')
        const opened = await useFsStore.getState().openRecentWorkspace(workspacePath)
        const state = useFsStore.getState()
        return { opened, error: state.error, workspacePath: state.workspacePath }
      }, secondProjectPath)
      assert(
        openedSecond.opened,
        `second smoke project could not be opened: ${JSON.stringify(openedSecond)}`,
      )
      await clickByTitle(page, '网站与账号')
      await primaryRow().waitFor({ state: 'visible', timeout: 10_000 })
      await matrixRow().waitFor({ state: 'visible', timeout: 10_000 })
      await primaryRow()
        .locator('.web-resource-row-open')
        .evaluate((element) => element.click())
      await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
      const secondProjection = await page.evaluate(async () => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const state = useTabStore.getState()
        const tab = state.tabs.find((item) => item.id === state.activeTabId)
        return {
          accountId: tab?.webResourceRef?.accountId,
          browserProfileId: tab?.browserProfile,
          workspacePath: tab?.workspaceRef?.kind === 'local' ? tab.workspaceRef.path : null,
        }
      })
      assert(
        secondProjection.accountId === globalIdentity.accountId &&
          secondProjection.browserProfileId === globalIdentity.browserProfileId &&
          secondProjection.workspacePath === secondProjectPath,
        'second project did not create its own Tab projection over the same global profile',
      )
    } finally {
      await page.evaluate(async (workspacePath) => {
        const { useFsStore } = await import('/src/stores/fs-store.ts')
        return useFsStore.getState().openRecentWorkspace(workspacePath)
      }, rootDir)
      await rm(secondProjectPath, { recursive: true, force: true })
      await clickByTitle(page, '网站与账号')
    }

    await browser.close()
    const resourceRestartLog = await readLog()
    runRestart('restart')
    const restartedCdpPort = await waitForCdpPort(45_000, resourceRestartLog)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${restartedCdpPort}`)
    page = await findRendererPage(browser)
    await page.setViewportSize({ width: 1440, height: 920 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })
    if ((await page.locator('.sidebar-header-title', { hasText: '网站与账号' }).count()) === 0) {
      await page
        .locator('[title="网站与账号"]')
        .first()
        .evaluate((element) => element.click())
    }
    await primaryRow().waitFor({ state: 'visible', timeout: 10_000 })
    const restartedOrdinaryTabId = await page.evaluate(async (fixtureOrigin) => {
      const [{ openDefaultBrowserTab }, { useWorkspaceStore }] = await Promise.all([
        import('/src/features/web-resources/open-default-browser-tab.ts'),
        import('/src/stores/workspace-store.ts'),
      ])
      return (
        await openDefaultBrowserTab(useWorkspaceStore.getState().activeWorkspaceRef, {
          title: '重启后普通登录环境',
          initialUrl: `${fixtureOrigin}/login-popup-target`,
        })
      ).tabId
    }, webFixtureOrigin)
    await page.waitForFunction(
      async ({ tabId, expectedUrl }) => {
        const runtime = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
        return (
          runtime.visibleUrl === expectedUrl &&
          runtime.profileId === null &&
          runtime.session?.likelyAuthCookies.some((cookie) => cookie.name === 'cclink_auth_marker')
        )
      },
      {
        tabId: restartedOrdinaryTabId,
        expectedUrl: `${webFixtureOrigin}/login-popup-target`,
      },
      { timeout: 10_000 },
    )
    await page.evaluate(async (tabId) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      useTabStore.getState().closeTab(tabId)
    }, restartedOrdinaryTabId)
    return 'ordinary tabs and Agent links share the default login session; explicit account drafts stay isolated and keep one Profile through save, with global reuse and restart persistence verified'
  })

  await runCheck(
    webAffairPersistenceCheck,
    async () => {
      await clickByTitle(page, '事务')
      await page.waitForTimeout(200)
      assert(
        (await page.locator('.sidebar-header-title').innerText()) === '事务',
        'web affairs panel missing',
      )

      const affairTitle = 'UI Smoke Web Affair Global v3'
      const affairRow = () => page.locator('.web-affair-row', { hasText: affairTitle })
      if ((await affairRow().count()) === 0) {
        await page.getByRole('button', { name: '新建事务' }).click()
        assert(
          (await page.locator('.web-affairs-form').count()) === 0,
          'transaction creation form leaked into the sidebar',
        )
        await page.locator('.web-affair-draft-tab').waitFor({ state: 'visible', timeout: 10_000 })
        const form = page.locator('.web-affair-draft-form')
        await form.waitFor({ state: 'visible', timeout: 10_000 })
        await form.getByLabel('事务名称').fill(affairTitle)
        await form.getByLabel('最终目标').fill('验证事务列表、流程、节点详情和重启恢复')
        await selectSmokeBusinessSubject(form)
        const account = form.locator('.web-affairs-account-choice', { hasText: 'UI Smoke Account' })
        if ((await account.count()) > 0) await account.first().locator('input').check()
        const matrix = form.locator('label', { hasText: 'UI Smoke Matrix' })
        if ((await matrix.count()) > 0) await matrix.locator('input[type="checkbox"]').check()
        await form.getByRole('button', { name: '创建事务' }).click()
      } else {
        await affairRow().click()
      }

      await page.locator('.web-affair-tab').waitFor({ state: 'visible', timeout: uiReadyTimeoutMs })
      const tabText = await page.locator('.web-affair-tab').innerText()
      assert(tabText.includes('相关资源'), 'affair resources section missing')
      assert(tabText.includes('整体流程'), 'affair flow section missing')
      assert(tabText.includes('节点办理情况'), 'affair node detail section missing')
      assert(
        tabText.includes('运营矩阵快照') && tabText.includes('UI Smoke Matrix'),
        'affair did not preserve the selected global matrix binding snapshot',
      )
      assert(
        (await page.locator('.web-affair-flow-step').count()) === 5,
        'expected five flow nodes',
      )

      const firstNode = page.locator('.web-affair-flow-step button').first()
      const secondNode = page.locator('.web-affair-flow-step button').nth(1)
      if (!(await firstNode.evaluate((element) => element.classList.contains('completed')))) {
        await firstNode.click()
        await page.getByLabel('更新办理状态').selectOption('completed')
        await page.getByLabel(/结果或卡点说明/).fill('UI smoke 已核对第一节点')
        await page.getByRole('button', { name: '保存节点进度' }).click()
        await page.waitForFunction(() =>
          document.querySelector('.web-affair-flow-step button')?.classList.contains('completed'),
        )
      }
      assert(
        await secondNode.evaluate((element) => element.classList.contains('ready')),
        'completing the first node did not unlock the second node',
      )

      await browser.close()
      const affairRestartLog = await readLog()
      runRestart('restart')
      const restartedCdpPort = await waitForCdpPort(45_000, affairRestartLog)
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${restartedCdpPort}`)
      page = await findRendererPage(browser)
      await page.setViewportSize({ width: 1440, height: 920 })
      await page.waitForLoadState('domcontentloaded')
      await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })
      await page.locator('.web-affair-tab', { hasText: affairTitle }).waitFor({
        state: 'visible',
        timeout: 10_000,
      })
      if ((await page.locator('.sidebar-header-title', { hasText: '事务' }).count()) === 0) {
        await page
          .locator('[title="事务"]')
          .first()
          .evaluate((element) => element.click())
      }
      await affairRow().waitFor({ state: 'visible', timeout: 10_000 })
      return 'five-node affair, progress transition, and app restart persistence verified'
    },
    { dependsOn: [globalWebResourcesCheck] },
  )

  await runCheck(
    'web affair exposes A2-A4 handoff, wait, template, and flow-diff controls',
    async () => {
      const affairSidebarTitle = page.locator('.sidebar-header-title', { hasText: '事务' })
      if (
        (await affairSidebarTitle.count()) === 0 ||
        !(await affairSidebarTitle.first().isVisible())
      ) {
        await clickByTitle(page, '事务')
      }
      const affairTitle = 'UI Smoke Agent Affair Project v2'
      const affairRow = () => page.locator('.web-affair-row', { hasText: affairTitle })
      if ((await affairRow().count()) === 0) {
        await page.getByRole('button', { name: '新建事务' }).evaluate((element) => element.click())
        assert(
          (await page.locator('.web-affairs-form').count()) === 0,
          'transaction creation form leaked into the sidebar',
        )
        await page.locator('.web-affair-draft-tab').waitFor({ state: 'visible', timeout: 10_000 })
        const form = page.locator('.web-affair-draft-form')
        await form.getByLabel('事务名称').fill(affairTitle)
        await form.getByLabel('最终目标').fill('验证 AI 交接、外部等待、模板和动态流程入口')
        await selectSmokeBusinessSubject(form)
        const account = form.locator('.web-affairs-account-choice', { hasText: 'UI Smoke Account' })
        await account.first().locator('input').check()
        await form.getByLabel('业务模板（可选）').selectOption('generic-web-affair@1')
        await form.getByRole('button', { name: '创建事务' }).click()
      } else {
        await affairRow().click()
      }

      await page.locator('.web-affair-tab', { hasText: affairTitle }).waitFor({ timeout: 10_000 })
      assert(
        (await page.locator('.web-affair-flow-step').count()) === 6,
        'template did not create six nodes',
      )

      await page.evaluate(async (title) => {
        const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
        const snapshot = await window.cclinkStudio.webAffairs.getSnapshot({
          workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
        })
        if (!snapshot.success) throw new Error(snapshot.error.message)
        let affair = snapshot.data.affairs.find((item) => item.title === title)
        if (!affair) throw new Error('smoke affair missing')
        for (const node of affair.flow.nodes.slice(0, 2)) {
          if (node.status === 'completed') continue
          const updated = await window.cclinkStudio.webAffairs.updateNode({
            workspaceRef: affair.workspaceRef,
            affairId: affair.id,
            nodeId: node.id,
            status: 'completed',
            resultNote: `Smoke 已完成 ${node.title}`,
          })
          if (!updated.success) throw new Error(updated.error.message)
          affair = updated.data
        }
      }, affairTitle)

      const webFormNode = page.locator('.web-affair-flow-step button.ready', {
        has: page.locator('strong', { hasText: '填写网页表单' }),
      })
      await webFormNode.waitFor({ timeout: 10_000 })
      await webFormNode.click()
      const startAiButton = page.getByRole('button', { name: '交给 AI', exact: true })
      await startAiButton.waitFor({ timeout: 10_000 })
      await startAiButton.click()
      const preflight = page.locator('.web-affair-confirm-card', { hasText: '执行前账号核验' })
      await preflight.waitFor({ timeout: 10_000 })
      const confirmAiButton = preflight.getByRole('button', {
        name: '确认并交给 AI',
        exact: true,
      })
      assert(
        await confirmAiButton.isDisabled(),
        'AI account invocation skipped the explicit login and principal confirmation',
      )
      await preflight.getByRole('checkbox').check()
      assert(
        await confirmAiButton.isEnabled(),
        'confirmed account preflight did not enable the Agent handoff',
      )
      await preflight.getByRole('button', { name: '取消', exact: true }).click()

      const tabCountBeforeResourceLaunch = await page.locator('.tab').count()
      await page
        .locator('.web-affair-resource-card', { hasText: '账号与登录环境' })
        .getByRole('button', { name: /UI Smoke Account/ })
        .click()
      await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
      assert(
        (await page.locator('.web-resource-detail').count()) === 0,
        'affair resource opened a detail tab instead of the Browser Tab',
      )
      assert(
        (await page.locator('.tab').count()) === tabCountBeforeResourceLaunch,
        'affair resource did not reuse the existing website account Browser Tab',
      )
      await page.locator('.tab', { hasText: affairTitle }).last().click()
      await page.locator('.web-affair-tab', { hasText: affairTitle }).waitFor({ timeout: 10_000 })

      await page
        .locator('.web-affair-flow-step button', {
          has: page.locator('strong', { hasText: '等待外部审核' }),
        })
        .click()
      await page.getByText('外部等待与重新检查', { exact: true }).waitFor({ timeout: 10_000 })
      assert(
        await page.getByText('最终确认卡固定展示', { exact: true }).isVisible(),
        'final confirmation card missing',
      )

      await page.getByRole('button', { name: '编辑未执行流程' }).click()
      assert(
        (await page.locator('.web-affair-flow-editor-row').count()) === 6,
        'flow editor missing nodes',
      )
      await page
        .locator('.web-affair-flow-editor-actions')
        .getByRole('button', { name: '取消' })
        .click()

      await page.evaluate(async (title) => {
        const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
        const snapshot = await window.cclinkStudio.webAffairs.getSnapshot({
          workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
        })
        if (!snapshot.success) throw new Error(snapshot.error.message)
        const affair = snapshot.data.affairs.find((item) => item.title === title)
        if (!affair) throw new Error('smoke affair missing')
        const result = await window.cclinkStudio.webAffairs.proposeFlowDiff({
          workspaceRef: affair.workspaceRef,
          affairId: affair.id,
          baseVersion: affair.flow.version,
          reason: 'Smoke 页面要求补充一次身份核验',
          operations: [
            {
              kind: 'add-node',
              tempId: 'smoke-extra-check',
              title: '补充身份核验',
              nodeType: 'human-task',
              executor: 'user',
            },
            {
              kind: 'add-edge',
              fromNodeId: affair.flow.nodes[0].id,
              toNodeId: 'smoke-extra-check',
            },
          ],
          impacts: ['新增人工核验步骤'],
          proposedBy: 'ai',
        })
        if (!result.success) throw new Error(result.error.message)
      }, affairTitle)
      const proposal = page.locator('.web-affair-proposals', {
        hasText: 'Smoke 页面要求补充一次身份核验',
      })
      await proposal.waitFor({ timeout: 10_000 })
      await proposal.getByRole('button', { name: '拒绝' }).click()
      await proposal.waitFor({ state: 'detached', timeout: 10_000 })
      return 'AI account preflight, manual account handoff, A3 wait, and A4 flow controls verified'
    },
    { dependsOn: [globalWebResourcesCheck, webAffairPersistenceCheck] },
  )

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
    const apiFormatRow = page.locator('.settings-row', { hasText: 'API 格式' })
    const apiFormatSelect = apiFormatRow.locator('select')
    assert(await apiFormatSelect.isDisabled(), 'unsupported API format selector is still enabled')
    assert(
      JSON.stringify(await apiFormatSelect.locator('option').allTextContents()) ===
        JSON.stringify(['Anthropic']),
      'OpenAI Compatible option is still rendered',
    )
    const providerOptions = await page
      .locator('.settings-row', { hasText: '模型提供商' })
      .locator('option')
      .allTextContents()
    assert(!providerOptions.includes('OpenAI'), 'unsupported OpenAI provider is still rendered')

    await page.getByRole('button', { name: '更新', exact: true }).click()
    await page.getByRole('heading', { name: '更新', exact: true }).waitFor({ timeout: 10_000 })
    const updateTrack = page.locator('.settings-section select')
    assert((await updateTrack.count()) === 1, 'update track selector missing')
    await updateTrack.selectOption('beta')
    await page.getByText('测试风险', { exact: true }).waitFor({ timeout: 10_000 })

    await page.locator('[title="检查和下载 CCLink Studio 更新"]').click()
    const updatePanel = page.locator('.update-panel')
    await updatePanel.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await updatePanel.innerText()).includes('测试通道'),
      'update panel track did not refresh',
    )
    await updatePanel.locator('.update-panel-header button[title="关闭"]').click()
    await updateTrack.selectOption('stable')
    return 'settings search, truthful Agent API options, and stable/beta update track projection'
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

    const recentUrl = `${webFixtureOrigin}/new-tab-recent`
    const seededBrowserTabId = await page.evaluate(async (initialUrl) => {
      const [{ openDefaultBrowserTab }, { useWorkspaceStore }] = await Promise.all([
        import('/src/features/web-resources/open-default-browser-tab.ts'),
        import('/src/stores/workspace-store.ts'),
      ])
      const result = await openDefaultBrowserTab(useWorkspaceStore.getState().activeWorkspaceRef, {
        title: '最近访问测试页',
        initialUrl,
      })
      return result.tabId
    }, recentUrl)
    assert(seededBrowserTabId, 'recent browser fixture did not become active')
    await page.waitForFunction(
      async (tabId) => (await window.cclinkStudio.browser.getActiveViewId()) === tabId,
      seededBrowserTabId,
      { timeout: 10_000 },
    )
    await page.waitForFunction(
      async (tabId) =>
        (await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)).visibleUrl?.endsWith(
          '/new-tab-recent',
        ),
      seededBrowserTabId,
      { timeout: 10_000 },
    )
    await page.waitForFunction(
      async (url) =>
        (await window.cclinkStudio.browser.listHistory(20)).some((entry) => entry.url === url),
      recentUrl,
      { timeout: 10_000 },
    )

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

    const activeBrowserTabId = await page.evaluate(async () => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const state = useTabStore.getState()
      const active = state.tabs.find((tab) => tab.id === state.activeTabId)
      return active?.type === 'browser' ? active.id : null
    })
    assert(activeBrowserTabId, 'new browser tab did not become active')
    await page.waitForFunction(
      async () => (await window.cclinkStudio.browser.getActiveViewId()) === null,
      undefined,
      { timeout: 10_000 },
    )
    const recentPage = page.locator('.browser-new-tab')
    await recentPage.waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(
      () => !document.querySelector('.browser-new-tab-empty')?.textContent?.includes('正在加载'),
      undefined,
      { timeout: 10_000 },
    )
    const recentCards = recentPage.locator('.browser-new-tab-card')
    assert((await recentCards.count()) <= 8, 'new tab rendered more than eight recent addresses')
    const renderedRecentUrls = await recentCards.evaluateAll((cards) =>
      cards.map((card) => card.getAttribute('title')),
    )
    const storedRecentUrls = await page.evaluate(async () =>
      (await window.cclinkStudio.browser.listHistory(8)).map((entry) => entry.url),
    )
    assert(
      renderedRecentUrls.includes(recentUrl),
      `new tab omitted the seeded recent address: ${JSON.stringify({ renderedRecentUrls, storedRecentUrls })}`,
    )
    const recentCard = recentPage.locator(`.browser-new-tab-card[title="${recentUrl}"]`)
    await recentCard.click()
    await page.waitForFunction(
      async (tabId) => (await window.cclinkStudio.browser.getActiveViewId()) === tabId,
      activeBrowserTabId,
      { timeout: 10_000 },
    )
    await page.waitForFunction(
      async (tabId) => {
        const layout = (await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)).layout
        return (
          layout !== null &&
          !layout.overlapsProtectedTop &&
          layout.rendererBounds.y >= layout.protectedTop &&
          layout.nativeBounds.y >= layout.nativeProtectedTop
        )
      },
      activeBrowserTabId,
      { timeout: 10_000 },
    )

    await page.locator('[title="检查和下载 CCLink Studio 更新"]').click()
    const browserUpdatePanel = page.locator('.update-panel')
    await browserUpdatePanel.waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(
      async () => (await window.cclinkStudio.browser.getActiveViewId()) === null,
      undefined,
      { timeout: 10_000 },
    )
    await browserUpdatePanel.locator('.update-panel-header button[title="关闭"]').click()
    await page.waitForFunction(
      async (tabId) => (await window.cclinkStudio.browser.getActiveViewId()) === tabId,
      activeBrowserTabId,
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
    await page.locator('.terminal-pty-surface .xterm').waitFor({ timeout: 10_000 })
    const initialTerminal = await page.evaluate(async () => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const state = useTabStore.getState()
      const active = state.tabs.find((tab) => tab.id === state.activeTabId)
      return active?.type === 'terminal'
        ? {
            tabId: active.id,
            sessionId: active.terminal?.sessionId,
            auditLogId: active.terminal?.auditLogId,
          }
        : null
    })
    assert(initialTerminal?.sessionId, 'new terminal session identity is missing')
    await page.evaluate(
      (sessionId) =>
        window.cclinkStudio.terminal.writePty({ terminalSessionId: sessionId, data: 'exit\r' }),
      initialTerminal.sessionId,
    )
    const restartButton = page.locator('button[title="重新启动 Terminal"]')
    await restartButton.waitFor({ state: 'visible', timeout: 10_000 })
    await restartButton.click()
    await page.waitForFunction(
      async ({ tabId, sessionId }) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const active = useTabStore.getState().tabs.find((tab) => tab.id === tabId)
        return active?.terminal?.sessionId !== sessionId && active?.terminal?.status === 'running'
      },
      initialTerminal,
      { timeout: 10_000 },
    )
    const restartedTerminal = await page.evaluate(async (tabId) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const state = useTabStore.getState()
      const active = state.tabs.find((tab) => tab.id === tabId)
      return {
        sessionId: active?.terminal?.sessionId,
        auditLogId: active?.terminal?.auditLogId,
        status: active?.terminal?.status,
        hasTerminalRecord: Boolean(active?.terminalRecord),
      }
    }, initialTerminal.tabId)
    assert(
      restartedTerminal.sessionId !== initialTerminal.sessionId,
      'terminal restart reused the final session identity',
    )
    assert(
      restartedTerminal.auditLogId !== initialTerminal.auditLogId,
      'terminal restart reused the final audit identity',
    )
    assert(
      !restartedTerminal.hasTerminalRecord,
      'terminal restart retained a stale history snapshot',
    )
    return 'editor/browser/terminal, recent-address new tab, one-click terminal restart, and update modal native-view occlusion'
  })

  await runCheck('no paid UI appears during smoke', async () => {
    const text = await page.locator('body').innerText()
    const blockedCopy = ['订阅', '配额', `Remote ${'Workspace'}`]
    assert(
      blockedCopy.every((item) => !text.includes(item)),
      'paid/account copy leaked into UI',
    )
    return 'clean UI boundary'
  })

  await browser.close()
  await stopWebFixture()

  const failed = results.filter((result) => result.status === 'fail')
  const skipped = results.filter((result) => result.status === 'skip')
  if (startedBySmoke && !keepRunning) runRestart('stop')
  if (!keepRunning) await rm(workspaceFixtureRoot, { recursive: true, force: true })
  if (failed.length > 0) {
    console.error(
      `\nUI smoke failed: ${failed.length} failed, ${skipped.length} skipped, ${results.length} total`,
    )
    process.exit(1)
  }
  console.log(`\nUI smoke passed: ${results.length}/${results.length}`)
}

main().catch(async (error) => {
  try {
    await stopWebFixture()
  } catch {
    // best effort cleanup
  }
  if (startedBySmoke && !keepRunning) {
    try {
      runRestart('stop')
    } catch {
      // best effort cleanup
    }
  }
  if (!keepRunning) await rm(workspaceFixtureRoot, { recursive: true, force: true }).catch(() => {})
  console.error(error)
  process.exit(1)
})
