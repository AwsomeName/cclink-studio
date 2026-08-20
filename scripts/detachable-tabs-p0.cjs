const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const RESULT_PREFIX = 'CCLINK_DETACHABLE_TABS_P0_RESULT='
const DEFAULT_TIMEOUT_MS = 45_000

if (!process.versions.electron) {
  void runController().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
} else {
  void runElectronPhase().catch((error) => {
    const { app } = require('electron')
    emitElectronResult(
      {
        ok: false,
        phase: readArgument('--phase') ?? 'unknown',
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      },
      1,
      app,
    )
  })
}

async function runController() {
  const phase = readArgument('--controller-phase') ?? 'p0a'
  if (!['p0a', 'p0b', 'all'].includes(phase)) {
    throw new Error(`Unsupported P0 controller phase: ${phase}`)
  }

  const electronPath = require('electron')
  const phases = phase === 'all' ? ['p0a', 'p0b'] : [phase]
  const results = []

  for (const currentPhase of phases) {
    const userDataPath = fs.mkdtempSync(
      path.join(os.tmpdir(), `cclink-detachable-tabs-${currentPhase}-`),
    )
    try {
      const result = await runElectronChild(electronPath, currentPhase, userDataPath)
      results.push(result)
      if (!result.ok) break
    } finally {
      fs.rmSync(userDataPath, { recursive: true, force: true })
    }
  }

  const output =
    phase === 'all'
      ? { ok: results.length === 2 && results.every((result) => result.ok), results }
      : results[0]
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  process.exitCode = output?.ok ? 0 : 1
}

function runElectronChild(electronPath, phase, userDataPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      electronPath,
      [__filename, `--phase=${phase}`, `--user-data=${userDataPath}`],
      {
        env: {
          ...process.env,
          ELECTRON_ENABLE_LOGGING: '0',
          ELECTRON_RUN_AS_NODE: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Electron ${phase} timed out: ${stderr || stdout}`))
    }, DEFAULT_TIMEOUT_MS)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timeout)
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(RESULT_PREFIX))
      if (!line) {
        reject(
          new Error(
            `Electron ${phase} exited without a result (code ${code}): ${stderr || stdout}`,
          ),
        )
        return
      }
      const result = JSON.parse(line.slice(RESULT_PREFIX.length))
      resolve({ ...result, processExitCode: code, stderr: stderr.trim() || undefined })
    })
  })
}

async function runElectronPhase() {
  const { app } = require('electron')
  const phase = readArgument('--phase')
  const userDataPath = readArgument('--user-data')
  if (!phase || !userDataPath) throw new Error('Missing --phase or --user-data')

  app.setPath('userData', userDataPath)
  app.commandLine.appendSwitch('remote-debugging-port', '0')
  await app.whenReady()

  let result
  if (phase === 'p0a') result = await runP0a()
  else if (phase === 'p0b') result = await runP0b()
  else throw new Error(`Unsupported Electron P0 phase: ${phase}`)

  emitElectronResult(result, result.ok ? 0 : 1, app)
}

async function runP0a() {
  const { BrowserWindow, WebContentsView, session } = require('electron')
  const { chromium } = require('playwright-core')
  const token = randomUUID()
  const tabId = `p0-tab-${token}`
  const profilePartition = `persist:cclink-detachable-tabs-p0a-${process.pid}`
  const profileSession = session.fromPartition(profilePartition)
  const server = await createFixtureServer(token)
  const pageUrl = `${server.origin}/page?token=${encodeURIComponent(token)}`
  const navigation = { started: 0, finished: 0 }
  const windows = []
  let browser = null
  let cdpSession = null
  let view = null
  let currentHost = null

  try {
    const windowA = createHostWindow(BrowserWindow, 'P0a A')
    const windowB = createHostWindow(BrowserWindow, 'P0a B')
    windows.push(windowA, windowB)
    await Promise.all([loadHostShell(windowA, 'P0a A'), loadHostShell(windowB, 'P0a B')])

    view = new WebContentsView({
      webPreferences: {
        session: profileSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    view.setBounds({ x: 0, y: 0, width: 900, height: 650 })
    view.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) navigation.started += 1
    })
    view.webContents.on('did-finish-load', () => {
      navigation.finished += 1
    })

    attachView(windowA, view)
    currentHost = windowA
    await view.webContents.loadURL(pageUrl)
    await waitForCondition(() => navigation.finished === 1, 5_000, 'initial page load')

    const cdpPort = await discoverCdpPort(require('electron').app.getPath('userData'))
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
    const context = browser.contexts()[0]
    assert(context, 'Playwright did not expose a browser context')
    const page = await waitForPage(context, pageUrl)
    cdpSession = await context.newCDPSession(page)
    const targetBefore = await cdpSession.send('Target.getTargetInfo')
    const webContentsIdBefore = view.webContents.id
    const sessionStoragePathBefore = profileSession.storagePath
    const navigationBeforeMoves = { ...navigation }
    const pageRegistry = new Map([[tabId, page]])

    await page.evaluate((expectedToken) => {
      window.__P0_STATE__.volatile = `volatile:${expectedToken}`
      document.querySelector('#p0-input').value = `input:${expectedToken}`
      window.scrollTo(0, 640)
      document.cookie = `p0_cookie=${expectedToken}; SameSite=Lax`
    }, token)
    await waitForCondition(
      async () => (await page.evaluate(() => Math.round(window.scrollY))) >= 600,
      3_000,
      'fixture scroll state',
    )
    const stateBefore = await capturePageState(page)

    currentHost = transferView(currentHost, windowB, view)
    await assertIdentityContinuity({
      phase: 'A-to-B',
      view,
      profileSession,
      sessionStoragePathBefore,
      browserContext: context,
      page,
      pageRegistry,
      tabId,
      cdpSession,
      targetIdBefore: targetBefore.targetInfo.targetId,
      webContentsIdBefore,
      navigation,
      navigationBeforeMoves,
      stateBefore,
    })

    currentHost = transferView(currentHost, windowA, view)
    await assertIdentityContinuity({
      phase: 'B-to-A',
      view,
      profileSession,
      sessionStoragePathBefore,
      browserContext: context,
      page,
      pageRegistry,
      tabId,
      cdpSession,
      targetIdBefore: targetBefore.targetInfo.targetId,
      webContentsIdBefore,
      navigation,
      navigationBeforeMoves,
      stateBefore,
    })

    let injectedFailureObserved = false
    try {
      transferView(currentHost, windowB, view, () => {
        throw new Error('injected-target-attach-failure')
      })
    } catch (error) {
      injectedFailureObserved =
        error instanceof Error && error.message === 'injected-target-attach-failure'
      attachView(windowA, view)
      currentHost = windowA
    }
    assert(injectedFailureObserved, 'The injected target attach failure was not observed')
    await assertIdentityContinuity({
      phase: 'rollback-to-A',
      view,
      profileSession,
      sessionStoragePathBefore,
      browserContext: context,
      page,
      pageRegistry,
      tabId,
      cdpSession,
      targetIdBefore: targetBefore.targetInfo.targetId,
      webContentsIdBefore,
      navigation,
      navigationBeforeMoves,
      stateBefore,
    })

    return {
      ok: true,
      phase: 'p0a',
      electronVersion: process.versions.electron,
      platform: process.platform,
      architecture: process.arch,
      assertions: {
        movedAtoB: true,
        movedBtoA: true,
        injectedAttachFailureRolledBack: true,
        sameWebContentsId: view.webContents.id === webContentsIdBefore,
        sameSessionObject: view.webContents.session === profileSession,
        sameSessionStoragePath: profileSession.storagePath === sessionStoragePathBefore,
        samePlaywrightPageObject:
          pageRegistry.get(tabId) === page && context.pages().includes(page),
        sameCdpTarget: true,
        noNavigationOrReload: sameNavigation(navigation, navigationBeforeMoves),
        volatilePageStatePreserved: samePageState(await capturePageState(page), stateBefore),
      },
      identity: {
        tabId,
        webContentsId: webContentsIdBefore,
        cdpTargetId: targetBefore.targetInfo.targetId,
        sessionStoragePath: sessionStoragePathBefore,
        bootId: stateBefore.bootId,
        performanceTimeOrigin: stateBefore.performanceTimeOrigin,
        navigation: navigationBeforeMoves,
      },
    }
  } finally {
    if (cdpSession) await cdpSession.detach().catch(() => undefined)
    if (currentHost && view && !currentHost.isDestroyed()) {
      currentHost.contentView.removeChildView(view)
    }
    if (view && !view.webContents.isDestroyed()) view.webContents.close()
    for (const window of windows.reverse()) {
      if (!window.isDestroyed()) window.destroy()
    }
    // connectOverCDP() 返回的 Browser.close() 会向 Electron 发送 Browser.close，
    // 导致主进程在结果输出前退出。这里由 emitElectronResult 后的 app.exit() 统一收尾。
    browser = null
    await server.close()
  }
}

async function runP0b() {
  const { app, BaseWindow, BrowserWindow, WebContentsView, session } = require('electron')
  const { chromium } = require('playwright-core')
  const token = randomUUID()
  const tabId = `p0b-tab-${token}`
  const profilePartition = `persist:cclink-detachable-tabs-p0b-${process.pid}`
  const profileSession = session.fromPartition(profilePartition)
  const server = await createFixtureServer(token)
  const pageUrl = `${server.origin}/page?token=${encodeURIComponent(token)}&phase=p0b`
  const popupUrl = `${server.origin}/popup?token=${encodeURIComponent(token)}`
  const windows = []
  const popupWindows = []
  let recoveryHost = null
  let browser = null
  let cdpSession = null
  let view = null
  let currentHost = null
  let consoleListener = null
  let popup = null

  try {
    const source = createHostWindow(BrowserWindow, 'P0b source')
    const target = createHostWindow(BrowserWindow, 'P0b target')
    const restored = createHostWindow(BrowserWindow, 'P0b restored')
    windows.push(source, target, restored)
    await Promise.all([
      loadHostShell(source, 'P0b source'),
      loadHostShell(target, 'P0b target'),
      loadHostShell(restored, 'P0b restored'),
    ])

    view = new WebContentsView({
      webPreferences: {
        session: profileSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    view.setBounds({ x: 0, y: 0, width: 900, height: 650 })
    view.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        show: false,
        webPreferences: {
          session: profileSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      },
    }))
    view.webContents.on('did-create-window', (window) => {
      popupWindows.push(window)
      window.hide()
    })

    attachView(source, view)
    currentHost = source
    await view.webContents.loadURL(pageUrl)

    const cdpPort = await discoverCdpPort(app.getPath('userData'))
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
    const { context, page } = await waitForPageAcrossContexts(browser, pageUrl)
    const sourceFocus = await focusView(app, source, view, page, 'source')
    cdpSession = await context.newCDPSession(page)
    const targetBefore = await cdpSession.send('Target.getTargetInfo')
    const webContentsIdBefore = view.webContents.id
    const pageRegistry = new Map([[tabId, page]])
    const stateBefore = await capturePageState(page)
    const visibilityBefore = stateBefore.visibilityState
    const ownerEvents = []
    let ownerWindowId = 'source'
    let ownerGeneration = 1
    const listenerCountBefore = view.webContents.listenerCount('console-message')
    consoleListener = (details) => {
      const message = details.message
      if (!message.startsWith('p0-owner-event:')) return
      ownerEvents.push({ ownerWindowId, generation: ownerGeneration, message })
    }
    view.webContents.on('console-message', consoleListener)
    assert(
      view.webContents.listenerCount('console-message') === listenerCountBefore + 1,
      'P0b owner event listener was not installed exactly once',
    )

    await emitOwnerEvent(page, token, 'source')
    await waitForCondition(() => ownerEvents.length === 1, 3_000, 'source owner event')

    const popupPromise = page.waitForEvent('popup')
    await page.evaluate((url) => {
      window.__P0_POPUP__ = window.open(url, 'cclink-p0-popup')
    }, popupUrl)
    popup = await popupPromise
    await popup.waitForLoadState('domcontentloaded')
    const openerBefore = await capturePopupOpener(popup)
    assert(openerBefore.hasOpener, 'Popup did not retain window.opener before transfer')
    assert(
      openerBefore.parentBootId === stateBefore.bootId,
      'Popup opener points to the wrong parent',
    )

    currentHost = transferView(currentHost, target, view)
    ownerWindowId = 'target'
    ownerGeneration = 2
    const targetFocus = await focusView(app, target, view, page, 'target')
    await emitOwnerEvent(page, token, 'target')
    await waitForCondition(() => ownerEvents.length === 2, 3_000, 'target owner event')
    await assertP0bIdentity({
      phase: 'target',
      view,
      page,
      pageRegistry,
      tabId,
      context,
      cdpSession,
      targetIdBefore: targetBefore.targetInfo.targetId,
      webContentsIdBefore,
      stateBefore,
    })
    const openerAfterTarget = await capturePopupOpener(popup)
    assert(
      openerAfterTarget.hasOpener && openerAfterTarget.parentBootId === stateBefore.bootId,
      'Popup opener changed after target attach',
    )

    currentHost.contentView.removeChildView(view)
    currentHost = null
    if (!source.isDestroyed()) source.destroy()
    if (!target.isDestroyed()) target.destroy()
    let targetAttachFailureObserved = false
    try {
      attachView(target, view)
    } catch (error) {
      targetAttachFailureObserved =
        error instanceof Error && error.message === 'Cannot attach a View to a destroyed host'
    }
    assert(targetAttachFailureObserved, 'Destroyed target attach failure was not observed')
    recoveryHost = new BaseWindow({ show: false, width: 1, height: 1 })
    recoveryHost.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    ownerWindowId = 'recovery'
    ownerGeneration = 3
    await delay(150)
    const visibilityInRecovery = await page.evaluate(() => document.visibilityState)
    assert(
      visibilityInRecovery === visibilityBefore,
      `Recovery Host changed Page visibility from ${visibilityBefore} to ${visibilityInRecovery}`,
    )
    await emitOwnerEvent(page, token, 'recovery')
    await waitForCondition(() => ownerEvents.length === 3, 3_000, 'recovery owner event')
    await assertP0bIdentity({
      phase: 'recovery',
      view,
      page,
      pageRegistry,
      tabId,
      context,
      cdpSession,
      targetIdBefore: targetBefore.targetInfo.targetId,
      webContentsIdBefore,
      stateBefore,
    })

    recoveryHost.contentView.removeChildView(view)
    attachView(restored, view)
    currentHost = restored
    ownerWindowId = 'restored'
    ownerGeneration = 4
    const restoredFocus = await focusView(app, restored, view, page, 'restored')
    await emitOwnerEvent(page, token, 'restored')
    await waitForCondition(() => ownerEvents.length === 4, 3_000, 'restored owner event')
    await assertP0bIdentity({
      phase: 'restored',
      view,
      page,
      pageRegistry,
      tabId,
      context,
      cdpSession,
      targetIdBefore: targetBefore.targetInfo.targetId,
      webContentsIdBefore,
      stateBefore,
    })
    const openerAfterRecovery = await capturePopupOpener(popup)
    assert(
      openerAfterRecovery.hasOpener && openerAfterRecovery.parentBootId === stateBefore.bootId,
      'Popup opener changed after Recovery Host round trip',
    )

    assert(
      ownerEvents.map((event) => `${event.ownerWindowId}:${event.generation}`).join(',') ===
        'source:1,target:2,recovery:3,restored:4',
      `Owner events were routed incorrectly: ${JSON.stringify(ownerEvents)}`,
    )
    assert(
      view.webContents.listenerCount('console-message') === listenerCountBefore + 1,
      'Owner event listener was duplicated during transfers',
    )

    if (popup && !popup.isClosed()) await popup.close()
    await waitForCondition(() => popup.isClosed(), 3_000, 'popup close')
    popup = null
    view.webContents.removeListener('console-message', consoleListener)
    consoleListener = null
    assert(
      view.webContents.listenerCount('console-message') === listenerCountBefore,
      'Owner event listener was not released',
    )
    currentHost.contentView.removeChildView(view)
    currentHost = null
    const webContents = view.webContents
    webContents.close()
    await waitForCondition(() => webContents.isDestroyed(), 5_000, 'View WebContents destruction')
    await waitForCondition(() => page.isClosed(), 5_000, 'Playwright Page close')
    assert(
      !context.pages().some((candidate) => candidate.url() === pageUrl),
      'Closed Page leaked in context',
    )
    assert(recoveryHost.contentView.children.length === 0, 'Recovery Host retained a child View')

    return {
      ok: true,
      phase: 'p0b',
      electronVersion: process.versions.electron,
      platform: process.platform,
      architecture: process.arch,
      assertions: {
        popupOpenerPreserved: true,
        sourcePageFocused: sourceFocus.hasFocus && sourceFocus.activeElementId === 'p0-input',
        targetPageFocused: targetFocus.hasFocus && targetFocus.activeElementId === 'p0-input',
        restoredPageFocused: restoredFocus.hasFocus && restoredFocus.activeElementId === 'p0-input',
        ownerEventsRoutedOnce: true,
        destroyedTargetAttachFailureEnteredRecoveryHost: targetAttachFailureObserved,
        recoveryHostPreservedVisibility: visibilityInRecovery === visibilityBefore,
        recoveryHostPreservedIdentity: true,
        listenerReleased: true,
        webContentsDestroyed: webContents.isDestroyed(),
        playwrightPageClosed: page.isClosed(),
        recoveryHostEmpty: recoveryHost.contentView.children.length === 0,
      },
      identity: {
        tabId,
        webContentsId: webContentsIdBefore,
        cdpTargetId: targetBefore.targetInfo.targetId,
        pageBootId: stateBefore.bootId,
        visibilityBefore,
        visibilityInRecovery,
        ownerSequence: ownerEvents.map((event) => ({
          windowId: event.ownerWindowId,
          generation: event.generation,
        })),
        focusSnapshots: { source: sourceFocus, target: targetFocus, restored: restoredFocus },
      },
    }
  } finally {
    if (cdpSession) await cdpSession.detach().catch(() => undefined)
    if (popup && !popup.isClosed()) await popup.close().catch(() => undefined)
    const remainingWebContents = view?.webContents
    if (consoleListener && remainingWebContents && !remainingWebContents.isDestroyed()) {
      remainingWebContents.removeListener('console-message', consoleListener)
    }
    if (currentHost && view && !currentHost.isDestroyed()) {
      currentHost.contentView.removeChildView(view)
    }
    if (recoveryHost && view && !recoveryHost.isDestroyed()) {
      recoveryHost.contentView.removeChildView(view)
    }
    if (remainingWebContents && !remainingWebContents.isDestroyed()) remainingWebContents.close()
    for (const popupWindow of popupWindows.reverse()) {
      if (!popupWindow.isDestroyed()) popupWindow.destroy()
    }
    for (const window of windows.reverse()) {
      if (!window.isDestroyed()) window.destroy()
    }
    if (recoveryHost && !recoveryHost.isDestroyed()) recoveryHost.destroy()
    browser = null
    await server.close()
  }
}

async function assertP0bIdentity(options) {
  assert(
    options.view.webContents.id === options.webContentsIdBefore,
    `${options.phase}: WebContents changed`,
  )
  assert(
    options.pageRegistry.get(options.tabId) === options.page,
    `${options.phase}: tabId Page changed`,
  )
  assert(options.context.pages().includes(options.page), `${options.phase}: Page left its context`)
  const target = await options.cdpSession.send('Target.getTargetInfo')
  assert(
    target.targetInfo.targetId === options.targetIdBefore,
    `${options.phase}: CDP target changed`,
  )
  assert(
    samePageState(await capturePageState(options.page), options.stateBefore),
    `${options.phase}: parent page state changed`,
  )
}

async function emitOwnerEvent(page, token, phase) {
  await page.evaluate(
    ({ marker, eventPhase }) => console.log(`p0-owner-event:${marker}:${eventPhase}`),
    { marker: token, eventPhase: phase },
  )
}

function capturePopupOpener(popup) {
  return popup.evaluate(() => ({
    hasOpener: Boolean(window.opener && !window.opener.closed),
    parentBootId: window.opener?.__P0_STATE__?.bootId ?? null,
  }))
}

function createHostWindow(BrowserWindow, title) {
  return new BrowserWindow({
    title,
    show: false,
    width: 900,
    height: 650,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
}

function loadHostShell(window, label) {
  const html = `<!doctype html><meta charset="utf-8"><title>${label}</title><body>${label}</body>`
  return window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function attachView(host, view) {
  if (host.isDestroyed()) throw new Error('Cannot attach a View to a destroyed host')
  host.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 900, height: 650 })
}

async function focusView(app, host, view, page, phase) {
  host.show()
  app.focus({ steal: true })
  host.focus()
  view.webContents.focus()
  await page.locator('#p0-input').click()
  let focusSnapshot = null
  try {
    await waitForCondition(
      async () => {
        const pageFocus = await view.webContents.executeJavaScript(
          '({ hasFocus: document.hasFocus(), activeElementId: document.activeElement?.id ?? null })',
        )
        focusSnapshot = {
          hostFocused: host.isFocused(),
          webContentsFocused: view.webContents.isFocused(),
          ...pageFocus,
        }
        return pageFocus.hasFocus && pageFocus.activeElementId === 'p0-input'
      },
      5_000,
      `${phase} page focus`,
    )
  } catch (error) {
    throw new Error(`${error.message}; last state=${JSON.stringify(focusSnapshot)}`)
  }
  return focusSnapshot
}

function transferView(source, target, view, beforeTargetAttach) {
  if (!source || source.isDestroyed()) throw new Error('Source host is unavailable')
  source.contentView.removeChildView(view)
  try {
    beforeTargetAttach?.()
    attachView(target, view)
    return target
  } catch (error) {
    throw error
  }
}

async function assertIdentityContinuity(options) {
  await delay(100)
  assert(
    options.view.webContents.id === options.webContentsIdBefore,
    `${options.phase}: WebContents changed`,
  )
  assert(
    options.view.webContents.session === options.profileSession,
    `${options.phase}: Session object changed`,
  )
  assert(
    options.profileSession.storagePath === options.sessionStoragePathBefore,
    `${options.phase}: Session storage path changed`,
  )
  assert(
    options.pageRegistry.get(options.tabId) === options.page,
    `${options.phase}: tabId no longer maps to the same Playwright Page`,
  )
  assert(
    options.browserContext.pages().includes(options.page),
    `${options.phase}: Playwright Page disappeared from its context`,
  )
  const target = await options.cdpSession.send('Target.getTargetInfo')
  assert(
    target.targetInfo.targetId === options.targetIdBefore,
    `${options.phase}: CDP target changed`,
  )
  assert(
    sameNavigation(options.navigation, options.navigationBeforeMoves),
    `${options.phase}: a navigation or reload occurred`,
  )
  const currentState = await capturePageState(options.page)
  assert(
    samePageState(currentState, options.stateBefore),
    `${options.phase}: volatile page state changed`,
  )
}

function sameNavigation(actual, expected) {
  return actual.started === expected.started && actual.finished === expected.finished
}

function samePageState(actual, expected) {
  return (
    actual.bootId === expected.bootId &&
    actual.loadCount === expected.loadCount &&
    actual.volatile === expected.volatile &&
    actual.inputValue === expected.inputValue &&
    actual.cookie === expected.cookie &&
    actual.performanceTimeOrigin === expected.performanceTimeOrigin &&
    actual.scrollY === expected.scrollY
  )
}

async function capturePageState(page) {
  return page.evaluate(() => ({
    bootId: window.__P0_STATE__.bootId,
    loadCount: window.__P0_STATE__.loadCount,
    volatile: window.__P0_STATE__.volatile,
    inputValue: document.querySelector('#p0-input').value,
    cookie: document.cookie,
    performanceTimeOrigin: performance.timeOrigin,
    scrollY: Math.round(window.scrollY),
    visibilityState: document.visibilityState,
  }))
}

async function createFixtureServer(token) {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, 'http://127.0.0.1')
    if (requestUrl.pathname === '/popup') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>CCLink detachable tab popup</title></head>
<body>popup:${token}</body></html>`)
      return
    }
    if (requestUrl.pathname !== '/page') {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>CCLink detachable tab P0a</title></head>
  <body style="margin:0;min-height:4000px">
    <input id="p0-input" value="initial">
    <script>
      const loadCount = Number(sessionStorage.getItem('p0-load-count') || '0') + 1
      sessionStorage.setItem('p0-load-count', String(loadCount))
      window.__P0_STATE__ = {
        bootId: crypto.randomUUID(),
        loadCount,
        volatile: 'initial',
        fixtureToken: ${JSON.stringify(token)}
      }
    </script>
  </body>
</html>`)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'Fixture server did not expose a port')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

async function discoverCdpPort(userDataPath) {
  const portFile = path.join(userDataPath, 'DevToolsActivePort')
  await waitForCondition(() => fs.existsSync(portFile), 10_000, 'DevToolsActivePort')
  const content = fs.readFileSync(portFile, 'utf8')
  const port = Number.parseInt(content.split(/\r?\n/)[0], 10)
  assert(Number.isInteger(port) && port > 0 && port < 65_536, 'CDP port is invalid')
  return port
}

async function waitForPage(context, expectedUrl) {
  let page = context.pages().find((candidate) => candidate.url() === expectedUrl)
  if (page) return page
  await waitForCondition(
    () => {
      page = context.pages().find((candidate) => candidate.url() === expectedUrl)
      return Boolean(page)
    },
    10_000,
    'Playwright Page discovery',
  )
  return page
}

async function waitForPageAcrossContexts(browser, expectedUrl) {
  let match = null
  await waitForCondition(
    () => {
      for (const context of browser.contexts()) {
        const page = context.pages().find((candidate) => candidate.url() === expectedUrl)
        if (page) {
          match = { context, page }
          return true
        }
      }
      return false
    },
    10_000,
    'Playwright Page discovery across contexts',
  )
  return match
}

async function waitForCondition(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return
    } catch (error) {
      lastError = error
    }
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ''}`)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function readArgument(name) {
  const prefix = `${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null
}

function emitElectronResult(result, exitCode, app) {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`, () => app.exit(exitCode))
}
