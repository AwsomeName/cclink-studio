#!/usr/bin/env node

const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright-core')

const rootDir = path.resolve(__dirname, '..')
const electronPath = require('electron')
const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cclink-cdp-recovery-smoke-'))
const smokeToken = randomUUID()
let tabId = null
let child = null
let fixtureServer = null
let externalBrowser = null
let studioLogs = { stdout: '', stderr: '' }

void main()
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await externalBrowser?.close().catch(() => undefined)
    if (child && child.exitCode === null) child.kill('SIGTERM')
    if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve))
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

async function main() {
  const fixture = await startFixtureServer()
  fixtureServer = fixture.server
  const logs = studioLogs
  child = spawn(electronPath, [path.join(rootDir, 'out/main/index.js')], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: userDataPath,
      CCLINK_STUDIO_BROWSER_CDP_RECOVERY_SMOKE: '1',
      CCLINK_STUDIO_BROWSER_CDP_RECOVERY_SMOKE_TOKEN: smokeToken,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  child.stdout.on('data', (chunk) => {
    logs.stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    logs.stderr += chunk.toString()
  })

  const cdpPort = await waitForCdpPort(userDataPath, logs)
  externalBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {
    timeout: 10_000,
  })
  const renderer = await waitForPage(
    externalBrowser,
    (page) => page.url().includes('/renderer/index.html'),
    'Studio renderer',
  )
  await renderer.waitForFunction(() => Boolean(window.cclinkStudio?.browser), undefined, {
    timeout: 20_000,
  })

  await renderer.locator('.tab-new-browser-button').click()
  const activeTab = renderer.locator('.tab.active[data-workbench-tab-id]')
  await activeTab.waitFor({ state: 'visible', timeout: 10_000 })
  tabId = await activeTab.getAttribute('data-workbench-tab-id')
  assert(tabId, 'new Browser tab id is missing')
  const address = renderer.locator('.url-input')
  await address.fill(fixture.url)
  await address.press('Enter')
  const target = await waitForPage(
    externalBrowser,
    (page) => page.url().startsWith(fixture.url),
    'Browser WebContents target',
  )
  await target.waitForLoadState('domcontentloaded')
  await waitFor(
    () =>
      target.evaluate(() => {
        const draft = document.querySelector('#draft')
        if (!draft || !window.__bootId) return false
        draft.value = 'unsaved-smoke-draft'
        document.cookie = 'cclink_smoke_session=preserved; SameSite=Lax'
        window.scrollTo(0, 640)
        return true
      }),
    10_000,
    'fixture page state',
  )

  const baselineDiagnostics = await waitForDiagnostics(renderer, tabId, (value) => {
    return Boolean(
      value.automationConnection?.isConnected &&
      value.automationConnection.boundGeneration ===
        value.automationConnection.connectionGeneration,
    )
  })
  const baselinePageState = await readPageState(target)
  const baselineTargetId = await resolveTargetId(externalBrowser, fixture.url)

  const updatePanel = renderer.locator('.update-panel')
  await renderer.locator('[title="检查和下载 CCLink Studio 更新"]').click()
  await updatePanel.waitFor({ state: 'visible', timeout: 10_000 })
  const modalHiddenDiagnostics = await waitForDiagnostics(renderer, tabId, (value) => {
    return (
      value.visibleTabId === null &&
      value.nativeViewAttached === false &&
      value.nativeViewVisible === false
    )
  })
  assert(
    modalHiddenDiagnostics.webContentsId === baselineDiagnostics.webContentsId,
    'hiding the native View recreated WebContents',
  )
  await updatePanel.locator('.update-panel-header button[title="关闭"]').click()
  await waitForDiagnostics(renderer, tabId, (value) => {
    return (
      value.visibleTabId === tabId &&
      value.nativeViewAttached === true &&
      value.nativeViewVisible === true
    )
  })
  await assertIdentityPreserved({
    renderer,
    target,
    fixtureUrl: fixture.url,
    beforeDiagnostics: baselineDiagnostics,
    afterDiagnostics: await renderer.evaluate(
      (id) => window.cclinkStudio.browser.getRuntimeDiagnostics(id),
      tabId,
    ),
    beforePageState: baselinePageState,
    beforeTargetId: baselineTargetId,
  })

  await disconnectInternalTransport(
    child,
    baselineDiagnostics.automationConnection.connectionGeneration,
  )
  const externalDuringDisconnect = await readPageState(target)
  assertSamePageState(
    baselinePageState,
    externalDuringDisconnect,
    'external observer after disconnect',
  )

  const recoveredDiagnostics = await waitForDiagnostics(renderer, tabId, (value) => {
    const connection = value.automationConnection
    return Boolean(
      connection?.isConnected &&
      connection.connectionGeneration >
        baselineDiagnostics.automationConnection.connectionGeneration &&
      connection.boundGeneration === connection.connectionGeneration,
    )
  })
  await assertIdentityPreserved({
    renderer,
    target,
    fixtureUrl: fixture.url,
    beforeDiagnostics: baselineDiagnostics,
    afterDiagnostics: recoveredDiagnostics,
    beforePageState: baselinePageState,
    beforeTargetId: baselineTargetId,
  })

  const moved = await renderer.evaluate(
    async ({ id, url }) => {
      const projection = await window.cclinkStudio.workbenchWindow.getProjection()
      const placement = projection.placements.find((item) => item.tabId === id)
      return window.cclinkStudio.workbenchWindow.moveTabToNewWindow({
        tabId: id,
        workspaceKey: null,
        ownerKey: null,
        sourceWindowId: placement?.windowId ?? 'main',
        expectedGeneration: placement?.generation ?? 0,
        transientTabSeed: {
          title: 'CDP recovery smoke',
          icon: '🌐',
          initialUrl: url,
          browserProfile: null,
        },
      })
    },
    { id: tabId, url: fixture.url },
  )
  assert(moved.success, `move to auxiliary failed: ${JSON.stringify(moved)}`)
  const detachedDiagnostics = await waitForDiagnostics(renderer, tabId, (value) =>
    Boolean(value.ownerWindowId && value.ownerWindowId !== 'main'),
  )
  let auxiliaryRenderer = await waitForOwnedAuxiliaryPage(
    externalBrowser,
    tabId,
    detachedDiagnostics.ownerWindowId,
  )
  await auxiliaryRenderer.waitForFunction(() => Boolean(window.cclinkAuxiliary), undefined, {
    timeout: 10_000,
  })
  await disconnectInternalTransport(
    child,
    detachedDiagnostics.automationConnection.connectionGeneration,
  )
  const detachedRecovered = await waitForDiagnostics(renderer, tabId, (value) => {
    const connection = value.automationConnection
    return Boolean(
      value.ownerWindowId === detachedDiagnostics.ownerWindowId &&
      connection?.isConnected &&
      connection.connectionGeneration >
        detachedDiagnostics.automationConnection.connectionGeneration &&
      connection.boundGeneration === connection.connectionGeneration,
    )
  })
  await assertIdentityPreserved({
    renderer,
    target,
    fixtureUrl: fixture.url,
    beforeDiagnostics: baselineDiagnostics,
    afterDiagnostics: detachedRecovered,
    beforePageState: baselinePageState,
    beforeTargetId: baselineTargetId,
  })

  // 辅助 renderer 可能在原生 host 恢复时被对称重建；返回命令必须重新解析当前 owner，
  // 不能把外部观察连接先前持有的 Page 句柄当作窗口身份。
  auxiliaryRenderer = await waitForOwnedAuxiliaryPage(
    externalBrowser,
    tabId,
    detachedRecovered.ownerWindowId,
  )
  const returnInput = await auxiliaryRenderer.evaluate(async (id) => {
    const projection = await window.cclinkAuxiliary.getProjection()
    const placement = projection.placements.find((item) => item.tabId === id)
    if (!placement) throw new Error('detached placement missing')
    return {
      tabId: id,
      sourceWindowId: placement.windowId,
      expectedGeneration: placement.generation,
    }
  }, tabId)
  await auxiliaryRenderer.evaluate((input) => {
    void window.cclinkAuxiliary.returnTabToMain(input)
  }, returnInput)
  const returnedDiagnostics = await waitForDiagnostics(
    renderer,
    tabId,
    (value) => value.ownerWindowId === 'main',
  )
  await assertIdentityPreserved({
    renderer,
    target,
    fixtureUrl: fixture.url,
    beforeDiagnostics: baselineDiagnostics,
    afterDiagnostics: returnedDiagnostics,
    beforePageState: baselinePageState,
    beforeTargetId: baselineTargetId,
  })

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        generations: [
          baselineDiagnostics.automationConnection.connectionGeneration,
          recoveredDiagnostics.automationConnection.connectionGeneration,
          detachedRecovered.automationConnection.connectionGeneration,
        ],
        webContentsId: baselineDiagnostics.webContentsId,
        targetId: baselineTargetId,
        ownerMigration: ['main', detachedDiagnostics.ownerWindowId, 'main'],
        preserved: [
          'native-modal-occlusion',
          'url',
          'webContentsId',
          'targetId',
          'profile',
          'sessionCookie',
          'form',
          'scroll',
          'bootId',
          'performance.timeOrigin',
        ],
      },
      null,
      2,
    )}\n`,
  )
}

async function startFixtureServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': 'fixture_login=authenticated; SameSite=Lax',
    })
    response.end(`<!doctype html>
      <title>CCLink CDP Recovery Smoke</title>
      <script>window.__bootId = crypto.randomUUID()</script>
      <input id="draft" value="initial">
      <div style="height:2400px">recovery fixture</div>`)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture address unavailable')
  return { server, url: `http://127.0.0.1:${address.port}/editor` }
}

async function waitForCdpPort(directory, logs) {
  const file = path.join(directory, 'DevToolsActivePort')
  return waitFor(
    async () => {
      if (child?.exitCode !== null) {
        throw new Error(`Studio exited early: ${logs.stderr || logs.stdout}`)
      }
      if (!fs.existsSync(file)) return null
      const port = Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0])
      return Number.isInteger(port) && port > 0 ? port : null
    },
    30_000,
    'Studio CDP port',
  )
}

async function waitForPage(browser, predicate, label) {
  return waitFor(
    () => {
      return browser
        .contexts()
        .flatMap((context) => context.pages())
        .find(predicate)
    },
    20_000,
    label,
  )
}

async function waitForOwnedAuxiliaryPage(browser, id, ownerWindowId) {
  return waitFor(
    async () => {
      const candidates = browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((page) => !page.isClosed() && page.url().endsWith('#auxiliary'))
      for (const page of candidates) {
        try {
          const projection = await page.evaluate(() => window.cclinkAuxiliary?.getProjection())
          const placement = projection?.placements?.find((item) => item.tabId === id)
          if (placement?.windowId === ownerWindowId) return page
        } catch {
          // Renderer 正在销毁或尚未 ready；下一轮从 live target 重新解析。
        }
      }
      return null
    },
    20_000,
    `Studio auxiliary renderer owner=${ownerWindowId}`,
  )
}

async function waitForDiagnostics(renderer, id, predicate) {
  let lastDiagnostics = null
  try {
    return await waitFor(
      async () => {
        const diagnostics = await renderer.evaluate(
          (tabIdValue) => window.cclinkStudio.browser.getRuntimeDiagnostics(tabIdValue),
          id,
        )
        lastDiagnostics = diagnostics
        return predicate(diagnostics) ? diagnostics : null
      },
      20_000,
      'Playwright recovery diagnostics',
    )
  } catch (error) {
    throw new Error(
      `${error.message}\nlastDiagnostics=${JSON.stringify(lastDiagnostics)}\n` +
        `studio.stderr=${studioLogs.stderr.slice(-4000)}\nstudio.stdout=${studioLogs.stdout.slice(-4000)}`,
    )
  }
}

async function disconnectInternalTransport(studio, generation) {
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('internal Playwright disconnect acknowledgement timed out')),
      5_000,
    )
    const handler = (message) => {
      if (!message || message.token !== smokeToken) return
      if (message.type === 'cclink-browser-cdp-recovery-error') {
        clearTimeout(timeout)
        studio.removeListener('message', handler)
        reject(new Error(message.error))
      }
      if (
        message.type === 'cclink-browser-cdp-recovery-disconnected' &&
        message.generation === generation
      ) {
        clearTimeout(timeout)
        studio.removeListener('message', handler)
        resolve()
      }
    }
    studio.on('message', handler)
  })
  studio.send({
    type: 'cclink-browser-cdp-recovery-disconnect',
    token: smokeToken,
    generation,
  })
  await response
}

async function readPageState(page) {
  return page.evaluate(() => ({
    url: location.href,
    bootId: window.__bootId,
    timeOrigin: performance.timeOrigin,
    draft: document.querySelector('#draft')?.value,
    scrollY: window.scrollY,
    cookies: document.cookie
      .split(';')
      .map((value) => value.trim())
      .sort(),
  }))
}

async function resolveTargetId(browser, url) {
  const session = await browser.newBrowserCDPSession()
  try {
    const { targetInfos } = await session.send('Target.getTargets')
    const matches = targetInfos.filter(
      (target) => target.type === 'page' && target.url.startsWith(url),
    )
    if (matches.length !== 1)
      throw new Error(`expected one fixture target, found ${matches.length}`)
    return matches[0].targetId
  } finally {
    await session.detach()
  }
}

async function assertIdentityPreserved(input) {
  const currentState = await readPageState(input.target)
  const currentTargetId = await resolveTargetId(externalBrowser, input.fixtureUrl)
  assertSamePageState(input.beforePageState, currentState, 'recovered page')
  assert(
    input.afterDiagnostics.webContentsId === input.beforeDiagnostics.webContentsId,
    'WebContents ID changed during recovery',
  )
  assert(
    input.afterDiagnostics.profileId === input.beforeDiagnostics.profileId,
    'Browser profile changed during recovery',
  )
  assert(currentTargetId === input.beforeTargetId, 'CDP target changed during recovery')
}

function assertSamePageState(before, after, label) {
  for (const key of ['url', 'bootId', 'timeOrigin', 'draft', 'scrollY']) {
    assert(after[key] === before[key], `${label}: ${key} changed`)
  }
  for (const cookie of ['fixture_login=authenticated', 'cclink_smoke_session=preserved']) {
    assert(after.cookies.includes(cookie), `${label}: missing cookie ${cookie}`)
  }
}

async function waitFor(read, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await read()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
