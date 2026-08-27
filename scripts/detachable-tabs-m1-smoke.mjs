#!/usr/bin/env node
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { runDir, logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const results = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(previousLog, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const complete = await readLog()
    const log =
      previousLog && complete.startsWith(previousLog)
        ? complete.slice(previousLog.length)
        : complete
    const match =
      log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//) ||
      log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`CDP port not found in ${logFile}`)
}

async function waitForMcpPort(previousLog, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const complete = await readLog()
    const log =
      previousLog && complete.startsWith(previousLog)
        ? complete.slice(previousLog.length)
        : complete
    const match = log.match(/MCP server 已启动(?: \(端口:|: 127\.0\.0\.1:)(\d+)/)
    if (match) return Number(match[1])
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`MCP port not found in ${logFile}`)
}

async function callMcpTool(port, name, args = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${name}-${Date.now()}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const payload = await response.json()
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `MCP ${name} failed with ${response.status}`)
  }
  if (payload.result?.isError) {
    throw new Error(payload.result.content?.[0]?.text || `MCP ${name} returned an error`)
  }
  return payload.result
}

async function switchWorkspaceInApp(page, ref) {
  return page.evaluate(async (targetRef) => {
    const { prepareWorkspaceRuntimeTransition, applyWorkspaceRuntimeTransition } =
      await import('/src/utils/workspace-transition.ts')
    const transition = await prepareWorkspaceRuntimeTransition(targetRef)
    return applyWorkspaceRuntimeTransition(transition)
  }, ref)
}

async function waitForPage(browser, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find(predicate)
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Expected CDP page did not appear')
}

async function waitForCleanAppExit(previousLog, cdpPort, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const complete = await readLog()
    const latest =
      previousLog && complete.startsWith(previousLog)
        ? complete.slice(previousLog.length)
        : complete
    let cdpStopped = false
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
        signal: AbortSignal.timeout(500),
      })
      cdpStopped = !response.ok
    } catch {
      cdpStopped = true
    }
    if (latest.includes('[CCLink Studio] 优雅退出完成') && cdpStopped) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Electron CDP endpoint remained reachable after main window close')
}

async function check(name, operation) {
  try {
    const detail = await operation()
    results.push({ name, ok: true })
    console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.error(`FAIL ${name} - ${error instanceof Error ? error.message : String(error)}`)
  }
}

const server = createServer((request, response) => {
  if (request.url?.startsWith('/download')) {
    response.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': 'attachment; filename="detachable-smoke.txt"',
    })
    response.end('detachable Browser download')
    return
  }
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'set-cookie': 'detachableSmokeSession=authenticated; HttpOnly; SameSite=Lax',
  })
  response.end(`<!doctype html><html><body style="height:10000px">
    <h1>Detachable M1</h1><input id="draft"><a id="popup" target="_blank" href="/popup">popup</a>
    <a id="download" href="/download">download</a>
    <script>window.__volatileMarker='initial'</script>
  </body></html>`)
})

let browser
let mainPage
let alternateWorkspace
try {
  alternateWorkspace = await mkdtemp(join(homedir(), '.cclink-detachable-m1-'))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local smoke server did not bind')
  const testUrl = `http://127.0.0.1:${address.port}/form`
  try {
    runRestart('stop')
  } catch {
    // A stale test process must not make the isolated userData cleanup unsafe.
  }
  await rm(join(runDir, 'user-data'), { recursive: true, force: true })
  const initialLog = await readLog()
  runRestart('start')
  const cdpPort = await waitForCdpPort(initialLog)
  let activeCdpPort = cdpPort
  const mcpPort = await waitForMcpPort(initialLog)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  mainPage = await waitForPage(browser, (page) => page.url().startsWith(`${rendererOrigin}/`))
  await mainPage.waitForSelector('.main-window', { timeout: 30_000 })

  let tabId
  let identityBefore
  let browserPage
  let zoomBefore
  let taskRunId
  await check(
    'create an authenticated Browser View and establish volatile page state',
    async () => {
      tabId = await mainPage.evaluate(async (url) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
        const workspaceRef = useWorkspaceStore.getState().activeWorkspaceRef
        useTabStore.getState().openTab({
          type: 'browser',
          title: 'Detachable M1',
          icon: '🌐',
          initialUrl: url,
          webResourceDraftRef: { draftId: 'detachable-smoke-draft' },
          workspaceRef,
          forceNew: true,
        })
        return useTabStore.getState().activeTabId
      }, testUrl)
      assert(tabId, 'Browser tab was not created')
      await mainPage.waitForFunction(
        async (id) => Boolean(await window.cclinkStudio.browser.getRuntimeIdentity(id)),
        tabId,
        { timeout: 15_000 },
      )
      browserPage = await waitForPage(browser, (page) => page.url() === testUrl)
      await browserPage.locator('#draft').fill('unsent draft')
      await browserPage.evaluate(() => {
        window.__volatileMarker = 'preserve-me'
        document.documentElement.scrollTop = 640
        history.pushState({ smokeStep: 2 }, '', '/form?step=2')
      })
      await browserPage.waitForFunction(() => window.scrollY > 500)
      const sessionCookie = (await browserPage.context().cookies()).find(
        (cookie) => cookie.name === 'detachableSmokeSession',
      )
      assert(sessionCookie?.value === 'authenticated', 'Authenticated Session cookie was not set')
      await mainPage.evaluate((id) => window.cclinkStudio.browser.setZoom(id, 1.2), tabId)
      zoomBefore = await browserPage.evaluate(() => window.devicePixelRatio)
      const visualZoomSession = await browserPage.context().newCDPSession(browserPage)
      await visualZoomSession.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.3 })
      await visualZoomSession.detach()
      const visualScaleBeforeMove = await browserPage.evaluate(
        () => window.visualViewport?.scale ?? 1,
      )
      assert(
        Math.abs(visualScaleBeforeMove - 0.3) < 0.001,
        `Visual zoom precondition failed: ${visualScaleBeforeMove}`,
      )
      const task = await mainPage.evaluate(
        (id) => window.cclinkStudio.browser.startTask(id, 'detachable owner routing smoke'),
        tabId,
      )
      taskRunId = task.id
      identityBefore = await mainPage.evaluate(
        (id) => window.cclinkStudio.browser.getRuntimeIdentity(id),
        tabId,
      )
      return `tab=${tabId} generation=${identityBefore.runtimeGeneration} task=${taskRunId}`
    },
  )

  let auxiliaryPage
  await check(
    'move the Browser Tab through the production context-menu command into a visible auxiliary surface',
    async () => {
      const browserTab = mainPage.getByRole('tab').filter({ hasText: 'Detachable M1' }).first()
      await browserTab.click({ button: 'right' })
      await mainPage.getByRole('menu', { name: '上下文菜单' }).waitFor({ state: 'visible' })
      await mainPage.getByRole('menuitem', { name: '移至新窗口' }).click()
      auxiliaryPage = await waitForPage(
        browser,
        (page) => page.url().startsWith(`${rendererOrigin}/`) && page.url().includes('#auxiliary'),
      )
      await auxiliaryPage.waitForSelector('.auxiliary-browser-window', { timeout: 10_000 })
      const surfaceBounds = await auxiliaryPage.locator('.auxiliary-browser-surface').boundingBox()
      assert(
        surfaceBounds && surfaceBounds.width > 0 && surfaceBounds.height > 0,
        `Auxiliary Browser surface is not visible: ${JSON.stringify(surfaceBounds)}`,
      )
      const preloadReady = await auxiliaryPage.evaluate(() => Boolean(window.cclinkAuxiliary))
      assert(preloadReady, 'Minimal auxiliary preload was not exposed')
      await auxiliaryPage.evaluate(() => {
        window.__detachableOwnerEvents = { tasks: [], downloads: [], nativeMenus: [] }
        window.cclinkAuxiliary.onTaskChanged(({ task }) => {
          window.__detachableOwnerEvents.tasks.push({ tabId: task.tabId, status: task.status })
        })
        window.cclinkAuxiliary.onDownloadChanged(({ download }) => {
          window.__detachableOwnerEvents.downloads.push({
            tabId: download.tabId,
            status: download.status,
            filename: download.suggestedFilename,
          })
        })
        window.cclinkAuxiliary.onNativeContextMenuOpened((payload) => {
          window.__detachableOwnerEvents.nativeMenus.push(payload)
        })
      })
      const mainProjection = await mainPage.evaluate(async (id) => {
        const { useWorkbenchWindowStore } = await import('/src/stores/workbench-window-store.ts')
        return useWorkbenchWindowStore.getState().placements[id]
      }, tabId)
      assert(mainProjection?.windowId.startsWith('aux-'), 'Main renderer did not hide detached tab')
      await mainPage.evaluate(async (id) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const { flushPendingWorkbenchTabWrites } = await import('/src/utils/workbench-tab-model.ts')
        useTabStore.setState((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === id ? { ...tab, webResourceDraftRef: undefined } : tab,
          ),
        }))
        await flushPendingWorkbenchTabWrites()
      }, tabId)
      return `${mainProjection.windowId} with ${surfaceBounds.width}x${surfaceBounds.height} surface; transient draft move succeeded before persistence`
    },
  )

  await check('reload the main renderer without duplicating the detached Tab', async () => {
    await mainPage.reload({ waitUntil: 'domcontentloaded' })
    await mainPage.waitForSelector('.main-window', { timeout: 30_000 })
    await mainPage.waitForFunction(
      async (id) => {
        const { useWorkbenchWindowStore } = await import('/src/stores/workbench-window-store.ts')
        return useWorkbenchWindowStore.getState().placements[id]?.windowId.startsWith('aux-')
      },
      tabId,
      { timeout: 10_000 },
    )
    assert(
      (await mainPage.getByRole('tab').filter({ hasText: 'Detachable M1' }).count()) === 0,
      'Detached Browser Tab was rendered again after main reload',
    )
    assert(!browserPage.isClosed(), 'Detached Browser Page closed during main reload')
    assert(
      (await browserPage.locator('#draft').inputValue()) === 'unsent draft',
      'Detached Browser state changed during main reload',
    )
    return 'placement hydrated before Browser reconciliation; no duplicate Tab appeared'
  })

  await check(
    'keep the main Workbench usable for real Editor input while Browser is detached',
    async () => {
      await mainPage.evaluate(async () => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        useTabStore.getState().openTab({
          type: 'editor',
          title: 'M1 主窗口草稿',
          icon: '📄',
          forceNew: true,
        })
      })
      const editor = mainPage.locator('.tiptap').first()
      await editor.waitFor({ state: 'visible', timeout: 5_000 })
      await editor.click()
      await mainPage.keyboard.type('main editor remains usable')
      assert(
        (await editor.textContent())?.includes('main editor remains usable'),
        'Main Editor did not accept input while Browser was detached',
      )
      assert(!browserPage.isClosed(), 'Detached Browser closed while editing in main')
      return 'main Editor accepted input without disturbing the Browser Page'
    },
  )

  await check(
    'preserve WebContents/Page identity, form, scroll and volatile JavaScript state',
    async () => {
      assert(!browserPage.isClosed(), 'Original Playwright Page was closed')
      const state = await browserPage.evaluate(() => ({
        draft: document.querySelector('#draft')?.value,
        marker: window.__volatileMarker,
        scrollY: window.scrollY,
      }))
      const identityAfter = await mainPage.evaluate(
        (id) => window.cclinkStudio.browser.getRuntimeIdentity(id),
        tabId,
      )
      assert(
        JSON.stringify(identityAfter) === JSON.stringify(identityBefore),
        'Runtime identity changed',
      )
      assert(state.draft === 'unsent draft', 'Unsubmitted form state was lost')
      assert(state.marker === 'preserve-me', 'Volatile JavaScript state was lost')
      assert(state.scrollY > 500, 'Scroll position was lost')
      assert(browserPage.url().endsWith('/form?step=2'), 'In-page history position was lost')
      const authenticated = (await browserPage.context().cookies()).some(
        (cookie) => cookie.name === 'detachableSmokeSession' && cookie.value === 'authenticated',
      )
      assert(authenticated, 'Authenticated Session was lost')
      const zoomAfter = await browserPage.evaluate(() => window.devicePixelRatio)
      assert(Math.abs(zoomAfter - zoomBefore) < 0.001, 'Browser zoom state changed')
      const visualScaleAfter = await browserPage.evaluate(() => window.visualViewport?.scale ?? 1)
      assert(
        Math.abs(visualScaleAfter - 1) < 0.001,
        `Detached Browser retained stale visual zoom: ${visualScaleAfter}`,
      )
      const runtimeDiagnostic = await mainPage.evaluate(
        (id) => window.cclinkStudio.browser.getRuntimeDiagnostics(id),
        tabId,
      )
      assert(
        Math.abs((runtimeDiagnostic.fitWidth?.actualVisualScale ?? 0) - 1) < 0.001,
        `Main diagnostics missed visual zoom reset: ${JSON.stringify(runtimeDiagnostic.fitWidth)}`,
      )
      return 'same Page/runtime generation; visual scale reset to 1'
    },
  )

  await check(
    'route BrowserTask, download, native menu, find and popup from the auxiliary owner',
    async () => {
      await mainPage.evaluate((id) => window.cclinkStudio.browser.pauseTask(id), taskRunId)
      await auxiliaryPage.waitForFunction(
        (id) =>
          window.__detachableOwnerEvents.tasks.some(
            (event) => event.tabId === id && event.status === 'paused',
          ),
        tabId,
      )
      await auxiliaryPage.waitForFunction(() =>
        /任务：paused/.test(
          document.querySelector('.auxiliary-browser-activity')?.textContent || '',
        ),
      )
      await mainPage.evaluate((id) => window.cclinkStudio.browser.resumeTask(id), taskRunId)
      await callMcpTool(mcpPort, 'browser_screenshot', {})

      await mainPage.evaluate(() => window.cclinkStudio.agent.setPermissionMode('auto'))
      try {
        const downloadPromise = callMcpTool(mcpPort, 'browser_wait_for_download', {
          timeout: 10_000,
        }).catch((error) => error)
        await callMcpTool(mcpPort, 'browser_click', { selector: '#download' })
        const downloadResult = await downloadPromise
        if (downloadResult instanceof Error) throw downloadResult
      } finally {
        await mainPage.evaluate(() => window.cclinkStudio.agent.setPermissionMode('categorized'))
      }
      await auxiliaryPage.waitForFunction(
        (id) =>
          window.__detachableOwnerEvents.downloads.some(
            (event) => event.tabId === id && event.status === 'completed',
          ),
        tabId,
      )
      await auxiliaryPage.waitForFunction(() =>
        /下载：completed/.test(
          document.querySelector('.auxiliary-browser-activity')?.textContent || '',
        ),
      )
      const taskAfterDownload = await mainPage.evaluate(
        (id) => window.cclinkStudio.browser.getTask(id),
        taskRunId,
      )
      assert(taskAfterDownload?.downloadIds.length === 1, 'Download was not linked to BrowserTask')

      await browserPage.locator('h1').click({ button: 'right' })
      await auxiliaryPage.waitForFunction(
        (id) => window.__detachableOwnerEvents.nativeMenus.some((event) => event.tabId === id),
        tabId,
      )
      await browserPage.keyboard.press('Escape').catch(() => undefined)

      await mainPage.evaluate(
        (id) => window.cclinkStudio.browser.dispatchFindShortcutForSmoke(id),
        tabId,
      )
      const findInput = auxiliaryPage.getByRole('textbox', { name: '在页面中查找' })
      await findInput.waitFor({ state: 'visible', timeout: 5_000 })
      await findInput.fill('Detachable')
      await auxiliaryPage.waitForFunction(() =>
        /1\/1/.test(document.querySelector('.auxiliary-browser-find')?.textContent || ''),
      )
      await auxiliaryPage.getByTitle('关闭查找').click()

      await browserPage.locator('#popup').click()
      const popupTabId = await mainPage
        .waitForFunction(
          async () => {
            const { useTabStore } = await import('/src/stores/tab-store.ts')
            return useTabStore.getState().tabs.find((tab) => tab.id.startsWith('browser-popup-'))
              ?.id
          },
          undefined,
          { timeout: 10_000 },
        )
        .then((handle) => handle.jsonValue())
      assert(popupTabId, 'Auxiliary popup was not adopted into the main host')
      const popupIdentity = await mainPage.evaluate(
        (id) => window.cclinkStudio.browser.getRuntimeIdentity(id),
        popupTabId,
      )
      assert(popupIdentity?.tabId === popupTabId, 'Popup runtime was not registered')
      await mainPage.evaluate((id) => {
        void window.cclinkStudio.browser.destroyView(id)
        void import('/src/stores/tab-store.ts').then(({ useTabStore }) =>
          useTabStore.getState().closeTab(id),
        )
      }, popupTabId)
      await mainPage.evaluate((id) => window.cclinkStudio.browser.finishTask(id), taskRunId)
      return 'task/download/menu/find events stayed with owner and popup was adopted by main'
    },
  )

  await check(
    'keep the auxiliary Browser alive through the production workspace transition',
    async () => {
      const switched = await switchWorkspaceInApp(mainPage, {
        kind: 'local',
        path: alternateWorkspace,
      })
      assert(switched, 'Production workspace transition to B was rejected')
      assert(!browserPage.isClosed(), 'Browser Page closed after main workspace switch')
      assert(
        await auxiliaryPage.locator('.auxiliary-browser-window').isVisible(),
        'Auxiliary shell disappeared',
      )
      const tabPresentInB = await mainPage.evaluate(async (id) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        return useTabStore.getState().tabs.some((tab) => tab.id === id)
      }, tabId)
      assert(!tabPresentInB, 'Workspace A Browser leaked into workspace B renderer projection')
      const marker = await browserPage.evaluate(() => window.__volatileMarker)
      assert(marker === 'preserve-me', 'Browser state changed after workspace switch')
      return 'auxiliary remains bound to original workspace'
    },
  )

  await check(
    'return while main is in workspace B, then restore the Tab only in workspace A',
    async () => {
      await auxiliaryPage.getByRole('button', { name: '送回主窗口' }).click()
      await auxiliaryPage.waitForEvent('close', { timeout: 10_000 }).catch(() => undefined)
      await mainPage.waitForFunction(
        async (id) => {
          const { useWorkbenchWindowStore } = await import('/src/stores/workbench-window-store.ts')
          return useWorkbenchWindowStore.getState().placements[id]?.windowId === 'main'
        },
        tabId,
        { timeout: 10_000 },
      )
      const identityReturned = await mainPage.evaluate(
        (id) => window.cclinkStudio.browser.getRuntimeIdentity(id),
        tabId,
      )
      assert(
        JSON.stringify(identityReturned) === JSON.stringify(identityBefore),
        'Return rebuilt runtime',
      )
      assert(!browserPage.isClosed(), 'Browser Page closed during return')
      const leakedIntoB = await mainPage.evaluate(async (id) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        return useTabStore.getState().tabs.some((tab) => tab.id === id)
      }, tabId)
      assert(!leakedIntoB, 'Returned workspace A Tab leaked into workspace B')

      const switchedBack = await switchWorkspaceInApp(mainPage, { kind: 'global' })
      assert(switchedBack, 'Production workspace transition back to A was rejected')
      await mainPage.waitForFunction(
        async (id) => {
          const { useTabStore } = await import('/src/stores/tab-store.ts')
          return useTabStore.getState().tabs.some((tab) => tab.id === id)
        },
        tabId,
        { timeout: 10_000 },
      )
      const restoredTab = mainPage.getByRole('tab').filter({ hasText: 'Detachable M1' }).first()
      await restoredTab.waitFor({ state: 'visible', timeout: 5_000 })
      await restoredTab.click()
      return 'auxiliary disposed in B; Tab became visible only after returning to A'
    },
  )

  await check('move through the real command palette and native-close back to main', async () => {
    await mainPage.keyboard.press('Meta+Shift+P')
    const paletteInput = mainPage.getByPlaceholder('输入命令...')
    await paletteInput.waitFor({ state: 'visible', timeout: 5_000 })
    await paletteInput.fill('移至新窗口')
    await mainPage.locator('.command-palette-item').filter({ hasText: '移至新窗口' }).click()
    const nativeClosePage = await waitForPage(
      browser,
      (page) => page.url().startsWith(`${rendererOrigin}/`) && page.url().includes('#auxiliary'),
    )
    await nativeClosePage.close()
    await mainPage.waitForFunction(
      async (id) => {
        const { useWorkbenchWindowStore } = await import('/src/stores/workbench-window-store.ts')
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const placement = useWorkbenchWindowStore.getState().placements[id]
        return (
          placement?.windowId === 'main' &&
          placement.active &&
          useTabStore.getState().activeTabId === id
        )
      },
      tabId,
      { timeout: 10_000 },
    )
    const identityAfterNativeClose = await mainPage.evaluate(
      (id) => window.cclinkStudio.browser.getRuntimeIdentity(id),
      tabId,
    )
    assert(
      JSON.stringify(identityAfterNativeClose) === JSON.stringify(identityBefore),
      'Native auxiliary close destroyed or rebuilt the Browser runtime',
    )
    return 'native close returned the Page and synchronized the highlighted active Tab'
  })

  let restoredBrowserPage
  await check('normalize a detached Tab to main across a real App restart', async () => {
    const browserTab = mainPage.getByRole('tab').filter({ hasText: 'Detachable M1' }).first()
    await browserTab.click()
    await browserTab.click({ button: 'right' })
    await mainPage.getByRole('menu', { name: '上下文菜单' }).waitFor({ state: 'visible' })
    await mainPage.getByRole('menuitem', { name: '移至新窗口' }).click()
    const detachedBeforeRestart = await waitForPage(
      browser,
      (page) => page.url().startsWith(`${rendererOrigin}/`) && page.url().includes('#auxiliary'),
    )
    await detachedBeforeRestart.waitForSelector('.auxiliary-browser-window', { timeout: 10_000 })
    const previousLog = await readLog()

    runRestart('restart')
    const restartedCdpPort = await waitForCdpPort(previousLog)
    activeCdpPort = restartedCdpPort
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${restartedCdpPort}`)
    mainPage = await waitForPage(browser, (page) => page.url().startsWith(`${rendererOrigin}/`))
    await mainPage.waitForSelector('.main-window', { timeout: 30_000 })
    await mainPage.waitForFunction(
      async (id) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        return useTabStore.getState().tabs.some((tab) => tab.id === id)
      },
      tabId,
      { timeout: 15_000 },
    )
    const auxiliaryPages = browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => page.url().includes('#auxiliary'))
    assert(auxiliaryPages.length === 0, 'M1 unexpectedly restored an auxiliary placement')

    const restoredTab = mainPage.getByRole('tab').filter({ hasText: 'Detachable M1' }).first()
    await restoredTab.waitFor({ state: 'visible', timeout: 10_000 })
    await restoredTab.click()
    await mainPage.waitForFunction(
      async (id) => Boolean(await window.cclinkStudio.browser.getRuntimeIdentity(id)),
      tabId,
      { timeout: 15_000 },
    )
    restoredBrowserPage = await waitForPage(
      browser,
      (page) => page.url().startsWith(testUrl),
      15_000,
    )
    assert(!restoredBrowserPage.isClosed(), 'Restored Browser Page did not become usable in main')
    return 'logical tabId restored in main and no auxiliary placement was recreated'
  })

  await check('explicit Tab close releases View, Page and BrowserTask association', async () => {
    const closeTask = await mainPage.evaluate(
      (id) => window.cclinkStudio.browser.startTask(id, 'explicit close cleanup smoke'),
      tabId,
    )
    const browserTab = mainPage.getByRole('tab').filter({ hasText: 'Detachable M1' }).first()
    await browserTab.locator('.tab-close').click()
    await mainPage.waitForFunction(
      async (id) => !(await window.cclinkStudio.browser.getRuntimeIdentity(id)),
      tabId,
      { timeout: 10_000 },
    )
    await mainPage.waitForFunction(
      async (id) => {
        const task = await window.cclinkStudio.browser.getTask(id)
        return task?.status === 'cancelled' && task.failureReason === 'tab_closed'
      },
      closeTask.id,
      { timeout: 10_000 },
    )
    if (!restoredBrowserPage.isClosed()) {
      await restoredBrowserPage.waitForEvent('close', { timeout: 10_000 })
    }
    assert(restoredBrowserPage.isClosed(), 'Playwright Page survived explicit Tab close')
    const tabStillPresent = await mainPage.evaluate(async (id) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      return useTabStore.getState().tabs.some((tab) => tab.id === id)
    }, tabId)
    assert(!tabStillPresent, 'Logical Browser Tab survived explicit close')
    return 'runtime removed, Page closed and task cancelled with tab_closed'
  })

  await check('close the main window with an auxiliary open and exit the App cleanly', async () => {
    const shutdownTabId = await mainPage.evaluate(async (url) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      useTabStore.getState().openTab({
        type: 'browser',
        title: 'Detachable Shutdown',
        icon: '🌐',
        initialUrl: url,
        workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
        forceNew: true,
      })
      return useTabStore.getState().activeTabId
    }, testUrl)
    assert(shutdownTabId, 'Shutdown Browser tab was not created')
    await mainPage.waitForFunction(
      async (id) => Boolean(await window.cclinkStudio.browser.getRuntimeIdentity(id)),
      shutdownTabId,
      { timeout: 15_000 },
    )
    const shutdownTab = mainPage.getByRole('tab').filter({ hasText: 'Detachable Shutdown' }).first()
    await shutdownTab.click({ button: 'right' })
    await mainPage.getByRole('menu', { name: '上下文菜单' }).waitFor({ state: 'visible' })
    await mainPage.getByRole('menuitem', { name: '移至新窗口' }).click()
    const shutdownAuxiliary = await waitForPage(
      browser,
      (page) => page.url().startsWith(`${rendererOrigin}/`) && page.url().includes('#auxiliary'),
    )
    await shutdownAuxiliary.waitForSelector('.auxiliary-browser-window', { timeout: 10_000 })

    const beforeCloseLog = await readLog()
    const closeResult = await mainPage.evaluate(() => window.cclinkStudio.window.requestClose())
    assert(closeResult.success, 'Trusted main renderer close request was rejected')
    await waitForCleanAppExit(beforeCloseLog, activeCdpPort)
    const shutdownLog = await readLog()
    assert(
      shutdownLog.includes('[CCLink Studio] 优雅退出完成'),
      'App did not complete graceful shutdown',
    )
    return 'main close requested App quit; auxiliary did not orphan the process'
  })
} finally {
  if (browser) await browser.close().catch(() => undefined)
  server.close()
  if (alternateWorkspace) await rm(alternateWorkspace, { recursive: true, force: true })
  try {
    runRestart('stop')
  } catch {
    // Best-effort cleanup; report the functional checks below.
  }
}

const failed = results.filter((result) => !result.ok)
if (failed.length) {
  console.error(`\nDetachable tabs M1 smoke failed: ${failed.length}/${results.length}`)
  process.exit(1)
}
console.log(`\nDetachable tabs M1 smoke passed: ${results.length}/${results.length}`)
