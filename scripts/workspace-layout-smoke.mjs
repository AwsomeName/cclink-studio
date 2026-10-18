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
import { runActivityCountSmoke } from './activity-count-smoke.mjs'

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

async function resizeWindow(width, height = 920) {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      const zoom = window.webContents.getZoomFactor()
      window.setContentSize(Math.round(size.width * zoom), Math.round(size.height * zoom))
    },
    { width, height },
  )
  await until(
    () => page.evaluate(() => window.innerWidth),
    (value) => Math.abs(value - width) < 2,
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
    ui.showPanel(next.activePanel ?? 'files')
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
  activePanel: 'files',
  sidebarWidth: 180,
  agentPanelWidth: 260,
  sidebarVisible: false,
  agentPanelMode: 'right',
  agentPanelModeSource: 'user',
}
const layoutB = {
  activePanel: 'company-accounts',
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
  await check('text navigation, all pointer and keyboard menu opens, and settings', async () => {
    await setLayout({ ...layoutA, sidebarVisible: true })
    const entries = await page.locator('.activity-bar-main button').evaluateAll((buttons) =>
      buttons.map((button) => ({
        label: button.getAttribute('aria-label'),
        title: button.title,
      })),
    )
    assert(entries.length === 15, 'Expected all fifteen activities')
    for (const entry of entries) {
      const button = page
        .locator('.activity-bar-main')
        .getByRole('button', { name: entry.label, exact: true })
      await button.click()
      assert(
        (await button.getAttribute('aria-pressed')) === 'true',
        `Wrong selection after click ${entry.label}`,
      )
      await button.click({ button: 'right' })
      const menu = page.locator('.unified-context-menu')
      await menu.waitFor({ state: 'visible' })
      await menu.getByText(`打开${entry.title}`, { exact: true }).click()
      await menu.waitFor({ state: 'hidden' })
      assert(
        (await button.getAttribute('aria-pressed')) === 'true',
        `Wrong selection after menu ${entry.label}`,
      )
      await button.press('Shift+F10')
      await menu.waitFor({ state: 'visible' })
      await menu.getByText(`打开${entry.title}`, { exact: true }).click()
      assert((await button.getAttribute('aria-pressed')) === 'true', `Keyboard menu ${entry.label}`)
      if (entry.label === '公司账目' || entry.label === '公司经营') {
        const tabType = await page.evaluate(
          async () =>
            (await import('/src/stores/tab-store.ts')).useTabStore.getState().getActiveTab()?.type,
        )
        assert(
          tabType === (entry.label === '公司账目' ? 'company-accounts' : 'company-workspace'),
          `Wrong special Tab ${tabType}`,
        )
      }
    }
    await page.locator('.activity-bar-bottom button').click()
    await page.locator('.settings-page').waitFor({ state: 'visible' })
    const files = page.locator('.activity-bar').getByRole('button', { name: '文件', exact: true })
    await files.click()
    await files.click()
    assert(
      !(await page.evaluate(
        async () => (await import('/src/stores/ui-store.ts')).useUIStore.getState().sidebarVisible,
      )),
      'Repeated ordinary click must collapse',
    )
    await files.click()
    assert(
      await page.evaluate(
        async () => (await import('/src/stores/ui-store.ts')).useUIStore.getState().sidebarVisible,
      ),
      'Repeated ordinary click must reopen',
    )
    await setLayout(layoutA)
    await page.evaluate(
      async (id) =>
        (await import('/src/stores/tab-store.ts')).useTabStore.getState().activateTab(id),
      browserATabId,
    )
  })
  await check(
    'compressed sidebar gestures preview without saving and commit only final changes',
    async () => {
      const targets = { ...layoutA, sidebarWidth: 250, agentPanelWidth: 350, sidebarVisible: true }
      await setLayout(targets)
      await resizeWindow(900, 560)
      await until(
        () =>
          page
            .locator('.workspace-sidebar-shell')
            .evaluate((el) => el.getBoundingClientRect().width),
        (width) => Math.abs(width - 212) < 1,
        'Sidebar 212px clamp',
      )
      const expectedWidths = { navigation: 140, sidebar: 212, agent: 220, workbench: 320 }
      const widths = await until(
        () =>
          page.evaluate(() =>
            Object.fromEntries(
              [
                ['navigation', '.activity-bar'],
                ['sidebar', '.workspace-sidebar-shell'],
                ['agent', '.agent-side-shell'],
                ['workbench', '.workbench'],
              ].map(([key, selector]) => [
                key,
                document.querySelector(selector).getBoundingClientRect().width,
              ]),
            ),
          ),
        (widths) =>
          Object.entries(expectedWidths).every(
            ([key, expected]) => Math.abs(widths[key] - expected) < 1,
          ),
        'Complete real 900px layout after transitions',
      )
      await page.screenshot({ path: join(evidenceDir, 'compressed-three-columns.png') })
      await writeFile(
        join(evidenceDir, 'compressed-three-columns.json'),
        JSON.stringify(widths, null, 2),
      )
      const before = await stored(a)
      const handle = page.getByRole('separator', { name: '侧栏宽度', exact: true })
      const box = await handle.boundingBox()
      const x = box.x + 2,
        y = box.y + 50
      const start = async () => {
        await page.mouse.move(x, y)
        await page.mouse.down()
      }
      await start()
      await page.mouse.move(x - 32, y)
      await until(
        () =>
          page
            .locator('.workspace-sidebar-shell')
            .evaluate((el) => el.getBoundingClientRect().width),
        (width) => Math.abs(width - 180) < 1,
        'live preview 180',
      )
      assert(
        JSON.stringify(await stored(a)) === JSON.stringify(before),
        'Preview wrote persistent layout',
      )
      await page.mouse.move(x, y)
      await page.mouse.up()
      assert(
        JSON.stringify(await stored(a)) === JSON.stringify(before),
        'Round trip overwrote target',
      )
      await start()
      await page.mouse.move(x + 40, y)
      await page.mouse.up()
      assert(
        JSON.stringify(await stored(a)) === JSON.stringify(before),
        'Clamped gesture overwrote target',
      )
      await start()
      await page.mouse.move(x - 32, y)
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await page.mouse.up()
      assert(
        JSON.stringify(await stored(a)) === JSON.stringify(before),
        'Cancelled gesture overwrote target',
      )
      await start()
      await page.mouse.move(x - 32, y)
      await resizeWindow(920, 560)
      await page.mouse.up()
      const afterResize = await stored(a)
      assert(
        JSON.stringify(afterResize) === JSON.stringify(before),
        `Window resize committed preview: ${JSON.stringify({ before, afterResize })}`,
      )
      await resizeWindow(900, 560)
      await until(
        () =>
          page
            .locator('.workspace-sidebar-shell')
            .evaluate((el) => el.getBoundingClientRect().width),
        (width) => Math.abs(width - 212) < 1,
        'Clamp after resize cancellation',
      )
      await start()
      await page.mouse.move(x - 32, y)
      await page.mouse.up()
      assert((await stored(a)).sidebarWidth === 180, 'Final target not committed')
      await resizeWindow(1440)
      assert((await layout()).sidebarWidth === 180, 'Grow lost committed target')
      await setLayout(layoutA)
    },
  )
  await check('sidebar toggle cancels Agent drag without saving stale budget', async () => {
    const agentWidth = () =>
      page.locator('.agent-side-shell').evaluate((el) => el.getBoundingClientRect().width)
    const snapshot = async () => ({
      saved: await stored(a),
      displayedAgentWidth: await agentWidth(),
      activeDrag: await page.evaluate(() => document.body.classList.contains('is-resizing-panels')),
    })
    try {
      await setLayout({ ...layoutA, sidebarWidth: 250, agentPanelWidth: 700 })
      await resizeWindow(900, 560)
      await until(agentWidth, (width) => Math.abs(width - 436) < 1, 'Agent 436px clamp')
      const before = await snapshot()
      assert(before.saved.agentPanelWidth === 700, 'Agent target precondition not 700px')
      const box = await page.getByRole('separator', { name: 'Agent 面板宽度' }).boundingBox()
      const x = box.x + 2,
        y = box.y + 50
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + 20, y)
      await until(agentWidth, (width) => Math.abs(width - 416) < 1, 'Agent 416px preview')
      const preview = await snapshot()
      assert(preview.activeDrag, 'Agent preview has no active gesture')
      assert(preview.saved.agentPanelWidth === 700, 'Preview overwrote Agent target')
      await page.keyboard.press('Meta+b')
      await page.waitForFunction(async () => {
        const { useUIStore } = await import('/src/stores/ui-store.ts')
        return useUIStore.getState().sidebarVisible
      })
      await until(
        agentWidth,
        (width) => Math.abs(width - 220) < 1,
        'Agent 220px after sidebar toggle',
      )
      const cancelled = await snapshot()
      assert(!cancelled.activeDrag, 'Sidebar budget change did not cancel the gesture')
      await page.mouse.up()
      const after = await snapshot()
      assert(after.saved.sidebarVisible, 'Sidebar toggle was discarded')
      assert(after.saved.agentPanelWidth === 700, 'Stale drag candidate overwrote Agent target')
      await resizeWindow(1440)
      await until(agentWidth, (width) => Math.abs(width - 700) < 1, 'Agent restored to 700px')
      const restored = await snapshot()
      const evidence = { before, preview, cancelled, after, restored }
      await writeFile(
        join(evidenceDir, 'drag-budget-change.json'),
        JSON.stringify(evidence, null, 2),
      )
      return evidence
    } finally {
      await page.mouse.up()
      await resizeWindow(1440)
      await setLayout(layoutA)
    }
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
    'real window sizes, complete text, states, themes and non-default app zoom',
    async () => {
      await setLayout({ ...layoutA, sidebarVisible: true, sidebarWidth: 250, agentPanelWidth: 350 })
      for (const zoom of [1, 1.25]) {
        await electronApp.evaluate(
          ({ BrowserWindow }, factor) =>
            BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor),
          zoom,
        )
        for (const [width, height] of [
          [1400, 900],
          [900, 560],
          [800, 560],
        ]) {
          await resizeWindow(width, height)
          for (const theme of ['dark', 'light']) {
            await page.evaluate(
              async (value) =>
                (await import('/src/stores/theme-store.ts')).useThemeStore
                  .getState()
                  .setTheme(value),
              theme,
            )
            const geometry = await page.locator('.activity-bar').evaluate((bar) => {
              const nav = bar.getBoundingClientRect()
              const labels = [...bar.querySelectorAll('.activity-bar-label')].map((label) => {
                const rect = label.getBoundingClientRect(),
                  button = label.parentElement.getBoundingClientRect()
                const range = document.createRange()
                range.selectNodeContents(label)
                return {
                  text: label.textContent,
                  fits:
                    range.getBoundingClientRect().width <= rect.width + 0.5 &&
                    rect.left >= button.left &&
                    rect.right <= button.right,
                  font: getComputedStyle(label).fontSize,
                }
              })
              const settings = bar.querySelector('.activity-bar-bottom').getBoundingClientRect()
              return {
                width: nav.width,
                labels,
                settingsBottom: settings.bottom,
                viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
              }
            })
            assert(
              geometry.width === 140 &&
                geometry.labels.length === 16 &&
                geometry.labels.every((label) => label.fits && label.font === '13px'),
              `Text does not fit: ${JSON.stringify(geometry)}`,
            )
            assert(
              geometry.settingsBottom <= geometry.viewport.height,
              'Settings outside real window',
            )
            const file = page
              .locator('.activity-bar')
              .getByRole('button', { name: '文件', exact: true })
            const roles = page
              .locator('.activity-bar')
              .getByRole('button', { name: '角色', exact: true })
            await file.click()
            await roles.hover()
            await roles.focus()
            assert(
              (await page.locator('.activity-bar-icon.active').count()) === 1 &&
                (await file.getAttribute('aria-pressed')) === 'true',
              'Hover/focus changed selection',
            )
            await page
              .locator('.activity-bar')
              .getByRole('button', { name: '硬件生产', exact: true })
              .focus()
            const visible = await page.evaluate(() => {
              const el = document.activeElement.getBoundingClientRect()
              const main = document.querySelector('.activity-bar-main').getBoundingClientRect()
              return el.top >= main.top && el.bottom <= main.bottom + 1
            })
            assert(visible, 'Keyboard focus not scrolled into navigation')
            if (width === 900 && theme === 'dark' && zoom === 1) {
              await page.locator('.activity-bar-main button').first().focus()
              for (let index = 0; index < 15; index++) await page.keyboard.press('Tab')
              assert(
                await page.evaluate(
                  () => document.activeElement?.getAttribute('aria-label') === '设置',
                ),
                'Natural Tab order lost the fixed settings action',
              )
            }
            const windowBounds = await electronApp.evaluate(({ BrowserWindow }) => ({
              content: BrowserWindow.getAllWindows()[0].getContentBounds(),
              zoom: BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
            }))
            await writeFile(
              join(evidenceDir, `navigation-${width}-${theme}-${zoom}.json`),
              JSON.stringify({ geometry, windowBounds }, null, 2),
            )
            const screenshot = await electronApp.evaluate(async ({ BrowserWindow }) =>
              (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'),
            )
            await writeFile(
              join(evidenceDir, `navigation-${width}-${theme}-${zoom}.png`),
              Buffer.from(screenshot, 'base64'),
            )
          }
        }
        await resizeWindow(1400, 900)
        await setLayout(layoutA)
        await page.evaluate(
          async (id) =>
            (await import('/src/stores/tab-store.ts')).useTabStore.getState().activateTab(id),
          browserATabId,
        )
        const native = await measure(browserATabId, urlA, `browser-app-zoom-${zoom}`)
        const { rendererBounds, nativeBounds } = native.diagnostic.layout
        for (const key of ['x', 'y', 'width', 'height'])
          assert(
            Math.abs(nativeBounds[key] - rendererBounds[key] * zoom) <= 1,
            `Browser DIP conversion ${key} at ${zoom}`,
          )
      }
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1),
      )
      await resizeWindow(1440)
      await setLayout(layoutA)
    },
  )
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
  await check('real scheduled Runtime query/event counter without Agent calls', async () =>
    runActivityCountSmoke({ evidenceDir, workspaceRoot, rootDir }),
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
