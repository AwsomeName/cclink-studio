#!/usr/bin/env node
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'
import { createSmokeRuntime } from './smoke-runtime.mjs'

// 所有布局和 Browser 回归都在独立 userData 与临时工作空间中运行。
const evidenceDir = await mkdtemp(join(tmpdir(), 'cclink-workspace-layout-'))
const workspaceRoot = await mkdtemp(join(homedir(), '.cclink-workspace-layout-'))
const a = join(workspaceRoot, 'layout-a')
const b = join(workspaceRoot, 'layout-b')
const c = join(workspaceRoot, 'layout-default')
const settingsDefault = join(workspaceRoot, 'settings-default')
await Promise.all([a, b, c, settingsDefault].map((path) => mkdir(path)))
// 沿用 restore-smoke 的测试登记：只授权本次创建的目录，不修改应用权限入口。
await mkdir(join(evidenceDir, 'user-data'))
await writeFile(
  join(evidenceDir, 'user-data', 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: Object.fromEntries(
      [a, b, c, settingsDefault].map((path, index) => [
        `layout-smoke-${index}`,
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
const fixture = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(`<!doctype html><html><head></head>
    <body style="margin:0;width:100%;height:3000px"><h1>Layout ${request.url}</h1><input id="draft">
    <div style="position:absolute;left:3500px;width:10px;height:10px">overflow</div></body></html>`)
})
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve))
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`
const portProbe = createServer()
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
const rendererPort = portProbe.address().port
await new Promise((resolve) => portProbe.close(resolve))
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR = evidenceDir
process.env.CCLINK_STUDIO_SCREEN_NAME = basename(evidenceDir)
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT = String(rendererPort)
const { logFile, rendererOrigin, rootDir } = createSmokeRuntime(import.meta.url)
const controlledUserData = join(evidenceDir, 'controlled-user-data')
await mkdir(controlledUserData)
await writeFile(
  join(controlledUserData, 'workspace-state.json'),
  await readFile(join(evidenceDir, 'user-data', 'workspace-state.json')),
)
let electronApp
let browser
let page
let browserATabId
let runtimeChild
const results = []

function startRuntime() {
  const fd = openSync(logFile, 'w')
  try {
    runtimeChild = spawn('bash', ['scripts/dev.sh'], {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        CCLINK_STUDIO_TEST_USER_DATA_PATH: join(evidenceDir, 'user-data'),
        CCLINK_STUDIO_RENDERER_PORT: String(rendererPort),
      },
      detached: true,
      stdio: ['ignore', fd, fd],
    })
  } finally {
    closeSync(fd)
  }
}

async function stopRuntime() {
  if (!runtimeChild) return
  // 只清理本次创建的进程组，禁止 restart.sh 按整个仓库复用或停止其他开发实例。
  const pid = runtimeChild.pid
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    /* 本次隔离运行已经退出。 */
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function until(operation, predicate, description, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let observed
  while (Date.now() < deadline) {
    observed = await operation()
    if (predicate(observed)) return observed
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`${description}: ${JSON.stringify(observed)}`)
}

async function connect(previousLog = '') {
  await until(
    async () => {
      const all = await readFile(logFile, 'utf8').catch(() => '')
      const latest =
        previousLog && all.startsWith(previousLog) ? all.slice(previousLog.length) : all
      return (
        latest.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1] ??
        latest.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)?.[1]
      )
    },
    Boolean,
    'Electron CDP port',
    45_000,
  )
  // 完整 Studio；主进程测试接口仅用于窗口 resize 和受控故障注入。
  electronApp = await _electron.launch({
    executablePath: electronPath,
    args: [rootDir],
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: rendererOrigin,
      CCLINK_STUDIO_TEST_USER_DATA_PATH: controlledUserData,
    },
    timeout: 30_000,
  })
  browser = { contexts: () => [electronApp.context()], close: () => electronApp.close() }
  page = await electronApp.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  await resizeWindow(1440)
}

async function resizeWindow(width) {
  await electronApp.evaluate(({ BrowserWindow }, contentWidth) => {
    BrowserWindow.getAllWindows()[0].setContentSize(contentWidth, 920)
  }, width)
  await until(
    () => page.evaluate(() => window.innerWidth),
    (value) => Math.abs(value - width) < 5,
    `window width ${width}`,
  )
}

async function open(path) {
  await page.evaluate(async (targetPath) => {
    const { openWorkspaceRef } =
      await import('/src/features/workspace-open/workspace-open-controller.ts')
    await openWorkspaceRef({ kind: 'local', path: targetPath })
  }, path)
  await page.waitForFunction(async () => {
    const { useFsStore } = await import('/src/stores/fs-store.ts')
    const state = useFsStore.getState()
    return !state.loading && !state.switchingPath
  })
}

async function layout() {
  return page.evaluate(async () => {
    const { captureWorkspaceLayout } = await import('/src/stores/ui-store.ts')
    const captured = captureWorkspaceLayout()
    return {
      ...captured.snapshot,
      workspaceKey: captured.target.ref.kind === 'local' ? captured.target.ref.path : null,
    }
  })
}

async function flush() {
  await page.evaluate(async () => {
    const { flushPendingWorkspaceStateWrites } = await import('/src/utils/workspace-state.ts')
    await flushPendingWorkspaceStateWrites()
  })
}

async function stored(path) {
  await flush()
  return page.evaluate(async (target) => {
    const { getWorkspaceStateOwnerKey } = await import('/src/utils/workspace-state.ts')
    return (await window.cclinkStudio.workspaceState.get(target, getWorkspaceStateOwnerKey()))
      .sections.layout
  }, path)
}

async function setLayout(value) {
  await page.evaluate(async (next) => {
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    const ui = useUIStore.getState()
    ui.showPanel('files')
    ui.setSidebarWidth(next.sidebarWidth)
    ui.setAgentPanelWidth(next.agentPanelWidth)
    ui.setAgentPanelMode(next.agentPanelMode, 'user')
    if (!next.sidebarVisible) ui.hideSidebar()
  }, value)
  await flush()
}

async function assertLayout(path, expected) {
  const current = await layout()
  assert(current.workspaceKey === path, `Wrong workspace: ${JSON.stringify(current)}`)
  for (const [key, value] of Object.entries(expected))
    assert(current[key] === value, `Layout ${key}: ${current[key]} != ${value}`)
  await until(
    () =>
      page.evaluate(() => ({
        sidebar:
          document.querySelector('.workspace-sidebar-shell')?.getBoundingClientRect().width ?? 0,
        agent: document.querySelector('.agent-side-shell')?.getBoundingClientRect().width ?? 0,
      })),
    (widths) =>
      Math.abs(widths.sidebar - (expected.sidebarVisible ? expected.sidebarWidth : 0)) < 1 &&
      (expected.agentPanelMode === 'hidden' ? widths.agent < 1 : widths.agent > 0),
    'Visible layout',
  )
  return current
}

async function browserPage(url) {
  return until(
    async () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith(url)),
    Boolean,
    `native Browser ${url}`,
  )
}

async function openBrowser(url) {
  const id = await page.evaluate(async (target) => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
    useTabStore.getState().openTab({
      type: 'browser',
      title: 'Layout regression',
      icon: '🌐',
      initialUrl: target,
      workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
      forceNew: true,
    })
    return useTabStore.getState().activeTabId
  }, url)
  await browserPage(url)
  return id
}

async function measure(id, url, name, fitRequired = true) {
  const webPage = await browserPage(url)
  let stableKey = null
  let stableSince = 0
  const evidence = await until(
    async () => ({
      diagnostic: await page.evaluate(
        (tabId) => window.cclinkStudio.browser.getRuntimeDiagnostics(tabId),
        id,
      ),
      pane: await page
        .locator('.workbench-content')
        .evaluate((element) => element.getBoundingClientRect().width),
      actual: await webPage.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        visualScale: visualViewport.scale,
      })),
    }),
    ({ diagnostic: value, pane, actual }) => {
      const width = value?.layout?.nativeBounds?.width
      const fit = value?.fitWidth
      const matches =
        (fit?.samples?.length >= 3 || (!fitRequired && fit?.status === 'manual')) &&
        fit.actualZoomFactor === 1 &&
        fit.actualVisualScale === 1 &&
        Math.abs(actual.visualScale - 1) < 0.001 &&
        Math.abs(actual.viewport - width) <= 2 &&
        Math.abs(pane - value.layout.rendererBounds.width) <= 2 &&
        Math.abs(fit.paneWidth - width) <= 2
      const key = JSON.stringify([width, fit?.timestamp, actual.viewport, pane])
      if (!matches || stableKey !== key) {
        stableKey = matches ? key : null
        stableSince = Date.now()
        return false
      }
      return Date.now() - stableSince >= 500
    },
    `Browser diagnostics ${name}`,
  )
  const { diagnostic, actual } = evidence
  const bounds = diagnostic.layout
  assert(!bounds.overlapsProtectedTop, `Native view overlaps toolbar: ${JSON.stringify(bounds)}`)
  assert(
    Math.abs(bounds.nativeBounds.width - actual.viewport) <= 2,
    `Native bounds/viewport mismatch: ${JSON.stringify({ bounds, actual })}`,
  )
  assert(Math.abs(actual.visualScale - 1) < 0.001, `Visual scale is ${actual.visualScale}`)
  if (fitRequired)
    assert(
      diagnostic.fitWidth.rawFactor !== null &&
        diagnostic.fitWidth.rawFactor < 0.5 &&
        diagnostic.fitWidth.appliedFactor === 1,
      `Overflow was not rejected: ${JSON.stringify(diagnostic.fitWidth)}`,
    )
  await writeFile(join(evidenceDir, `${name}.json`), JSON.stringify({ name, ...evidence }, null, 2))
  return evidence
}

async function injectVisual30(id, url) {
  // 切到已有手动 100% 入口，结束上一轮自动适宽测量，再建立独立 visual scale 前置。
  await page.evaluate((tabId) => window.cclinkStudio.browser.setZoom(tabId, 1), id)
  const diagnostic = await page.evaluate(
    (tabId) => window.cclinkStudio.browser.getRuntimeDiagnostics(tabId),
    id,
  )
  // 生产下限为 1；仅本次故障注入临时放开，以复现历史 visual scale 30% 异常。
  await electronApp.evaluate(async ({ webContents }, wcId) => {
    await webContents.fromId(wcId).setVisualZoomLevelLimits(0.1, 3)
  }, diagnostic.webContentsId)
  const webPage = await browserPage(url)
  const session = await webPage.context().newCDPSession(webPage)
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.3 })
  const scale = await webPage.evaluate(() => visualViewport.scale)
  console.log(`Visual scale before test CDP release: ${scale}`)
  if (Math.abs(scale - 0.3) >= 0.001) {
    await session.detach()
    throw new Error(`30% visual scale precondition failed while CDP attached: ${scale}`)
  }
  // 保留注入会话直到产品复位被实测确认，避免 detach 自动清除 Emulation 状态冒充产品恢复。
  return {
    before: scale,
    release: async () => {
      await session.detach().catch(() => {})
      await electronApp
        .evaluate(async ({ webContents }, wcId) => {
          const wc = webContents.fromId(wcId)
          if (wc && !wc.isDestroyed()) await wc.setVisualZoomLevelLimits(1, 3)
        }, diagnostic.webContentsId)
        .catch(() => {})
    },
  }
}

async function check(name, operation) {
  try {
    const detail = await operation()
    results.push({ name, ok: true, detail })
    console.log(`PASS ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`)
    return true
  } catch (error) {
    results.push({ name, ok: false, error: error.message })
    console.error(`FAIL ${name}: ${error.stack}`)
    return false
  }
}

const layoutA = {
  sidebarWidth: 180,
  agentPanelWidth: 260,
  sidebarVisible: false,
  agentPanelMode: 'right',
  agentPanelModeSource: 'user',
}
const layoutB = {
  sidebarWidth: 420,
  agentPanelWidth: 600,
  sidebarVisible: true,
  agentPanelMode: 'hidden',
  agentPanelModeSource: 'user',
}
const urlA = `${fixtureOrigin}/a`
const urlB = `${fixtureOrigin}/b`

try {
  startRuntime()
  await connect()
  const setupReady = await check('default workspace and create A/B layouts', async () => {
    await open(c)
    const defaults = await layout()
    assert(
      defaults.sidebarWidth === 250 && defaults.agentPanelWidth === 350 && defaults.sidebarVisible,
      'Missing layout did not use defaults',
    )
    await open(a)
    await setLayout(layoutA)
    browserATabId = await openBrowser(urlA)
    await measure(browserATabId, urlA, 'new-tab-a')
    await open(b)
    await setLayout(layoutB)
    const id = await openBrowser(urlB)
    await measure(id, urlB, 'new-tab-b')
  })
  if (!setupReady) throw new Error('Smoke fixture setup failed; dependent checks skipped')
  await check('A → B → A after full open completion and persisted isolation', async () => {
    for (const path of [a, b, a]) {
      await open(path)
      await assertLayout(path, path === a ? layoutA : layoutB)
    }
    const values = { a: await stored(a), b: await stored(b) }
    for (const [key, value] of Object.entries(layoutA))
      assert(values.a[key] === value, `A stored ${key}`)
    for (const [key, value] of Object.entries(layoutB))
      assert(values.b[key] === value, `B stored ${key}`)
    return values
  })
  await check('native View bounds follow sidebar and Agent layout', async () => {
    await measure(browserATabId, urlA, 'returned-a')
    await setLayout({ ...layoutA, sidebarVisible: true, sidebarWidth: 420, agentPanelWidth: 600 })
    await measure(browserATabId, urlA, 'panels-wide')
    await setLayout(layoutA)
    await measure(browserATabId, urlA, 'panels-restored')
  })
  await check('window shrink/grow never overwrites the saved target width', async () => {
    await setLayout({ ...layoutA, agentPanelWidth: 700 })
    const before = await stored(a)
    await resizeWindow(900)
    await until(
      () =>
        page
          .locator('.agent-side-shell')
          .evaluate((element) => element.getBoundingClientRect().width),
      (width) => width < 700,
      'Agent display clamp',
    )
    assert((await layout()).agentPanelWidth === 700, 'Small window changed store target')
    assert(
      JSON.stringify(await stored(a)) === JSON.stringify(before),
      'Small window changed persisted target',
    )
    await resizeWindow(1440)
    await until(
      () =>
        page
          .locator('.agent-side-shell')
          .evaluate((element) => element.getBoundingClientRect().width),
      (width) => Math.abs(width - 700) < 1,
      'Expanded Agent target',
    )
    await setLayout(layoutA)
  })
  await check('active drag cancels on workspace switch and ignores the old pointer', async () => {
    const handle = page.getByRole('separator', { name: 'Agent 面板宽度' })
    const bounds = await handle.boundingBox()
    await page.mouse.move(bounds.x + 2, bounds.y + 50)
    await page.mouse.down()
    await open(b)
    await page.mouse.move(bounds.x - 200, bounds.y + 50)
    await page.mouse.up()
    await assertLayout(b, layoutB)
    assert(
      !(await page.evaluate(() => document.body.classList.contains('is-resizing-panels'))),
      'Drag CSS not released',
    )
    await open(a)
    await assertLayout(a, layoutA)
  })
  await check('page zoom 30% restores to 100% through production fit', async () => {
    await page.evaluate((id) => window.cclinkStudio.browser.setZoom(id, 0.3), browserATabId)
    const before = await page.evaluate(
      (id) => window.cclinkStudio.browser.getRuntimeDiagnostics(id),
      browserATabId,
    )
    assert(
      Math.abs(before.fitWidth.actualZoomFactor - 0.3) < 0.001,
      'Page zoom precondition not 30%',
    )
    await page.evaluate((id) => window.cclinkStudio.browser.fitWidth(id), browserATabId)
    await measure(browserATabId, urlA, 'page-zoom-restored')
  })
  await check(
    'visual scale 30% restores to 100% without reload through production fit',
    async () => {
      const webPage = await browserPage(urlA)
      await webPage.locator('#draft').fill('preserve-through-fit')
      const injected = await injectVisual30(browserATabId, urlA)
      try {
        await page.evaluate((id) => window.cclinkStudio.browser.fitWidth(id), browserATabId)
        const evidence = await measure(browserATabId, urlA, 'visual-scale-restored')
        assert(
          (await webPage.locator('#draft').inputValue()) === 'preserve-through-fit',
          'Fit reloaded the page',
        )
        return {
          before: injected.before,
          after: evidence.actual.visualScale,
          pageZoom: evidence.diagnostic.fitWidth.actualZoomFactor,
        }
      } finally {
        await injected.release()
      }
    },
  )
  await check(
    'visual scale 30% resets across A → B → A through existing View lifecycle',
    async () => {
      const injected = await injectVisual30(browserATabId, urlA)
      try {
        await open(b)
        await open(a)
        await assertLayout(a, layoutA)
        const evidence = await measure(browserATabId, urlA, 'visual-activation-restored', false)
        return { before: injected.before, after: evidence.actual.visualScale }
      } finally {
        await injected.release()
      }
    },
  )
  await check('in-page navigation and browser history preserve 100% zoom', async () => {
    await page.evaluate((id) => window.cclinkStudio.browser.fitWidth(id), browserATabId)
    const webPage = await browserPage(urlA)
    await webPage.evaluate(() => history.pushState({}, '', '#layout-navigation'))
    await measure(browserATabId, urlA, 'in-page-navigation')
    await webPage.goto(`${urlA}?navigation=2`)
    await measure(browserATabId, urlA, 'full-navigation')
    await page.evaluate((id) => window.cclinkStudio.browser.goBack(id), browserATabId)
    await measure(browserATabId, urlA, 'history-back')
  })
  await check('restart restores layouts and native Browser zoom', async () => {
    await flush()
    await browser.close()
    await connect()
    await assertLayout(a, layoutA)
    await measure(browserATabId, urlA, 'restart-a')
    await open(b)
    await assertLayout(b, layoutB)
    await open(a)
    await assertLayout(a, layoutA)
    await page.screenshot({ path: join(evidenceDir, 'restored-layout.png') })
  })
  await check(
    'preserved Settings stays visible after system layout restore; user mode wins',
    async () => {
      const preserved = await page.evaluate(async (targetPath) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const { openWorkspaceRef } =
          await import('/src/features/workspace-open/workspace-open-controller.ts')
        useTabStore.getState().openTab({ type: 'settings', title: '设置', icon: '⚙️' })
        const settingsTab = useTabStore.getState().getActiveTab()
        await openWorkspaceRef({ kind: 'local', path: targetPath })
        return {
          sameTab: useTabStore.getState().getActiveTab() === settingsTab,
          activeTabId: useTabStore.getState().activeTabId,
        }
      }, settingsDefault)
      assert(preserved.sameTab, 'The same global Settings Tab was not retained')
      await page.waitForFunction(async () => {
        const { useUIStore } = await import('/src/stores/ui-store.ts')
        const ui = useUIStore.getState()
        return ui.agentPanelMode === 'right' && ui.agentPanelModeSource === 'system'
      })
      await page.locator('.settings-page').waitFor({ state: 'visible' })
      const systemLayout = await layout()
      await open(b)
      await assertLayout(b, layoutB)
      await page.locator('.settings-page').waitFor({ state: 'visible' })
      const userLayout = await layout()
      assert(userLayout.agentPanelModeSource === 'user', 'Settings context overwrote user source')
      await page.screenshot({ path: join(evidenceDir, 'settings-preserved.png') })
      return { preserved, systemLayout, userLayout }
    },
  )
} finally {
  await writeFile(
    join(evidenceDir, 'results.json'),
    JSON.stringify({ results, evidenceDir }, null, 2),
  )
  await browser?.close().catch(() => {})
  await stopRuntime()
  await new Promise((resolve) => fixture.close(resolve))
  await rm(workspaceRoot, { recursive: true, force: true })
  console.log(`Evidence: ${evidenceDir}`)
  console.log(`Temporary smoke workspaces removed: ${workspaceRoot}`)
}
if (results.some((result) => !result.ok)) process.exitCode = 1
