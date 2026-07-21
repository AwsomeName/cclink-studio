#!/usr/bin/env node
import { rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const packageMetadata = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)
const expectedProductName = packageMetadata.productName
const keepRunning = process.argv.includes('--keep-running')
const results = []
let startedBySmoke = false
let tempWorkspaceDir = null

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

async function runCheck(name, fn) {
  try {
    const detail = await fn()
    pass(name, detail)
  } catch (error) {
    fail(name, error)
  }
}

async function main() {
  runRestart('restart')
  startedBySmoke = true

  const cdpPort = await waitForCdpPort()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const page = await findRendererPage(browser)
  const rendererDiagnostics = []
  page.on('pageerror', (error) => rendererDiagnostics.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') rendererDiagnostics.push(`console: ${message.text()}`)
  })
  await page.waitForLoadState('domcontentloaded')

  await runCheck('renderer shell is usable without login', async () => {
    try {
      await page.waitForFunction(
        () =>
          Boolean(
            document.querySelector('.main-window') ||
            document.querySelector('.runtime-unavailable'),
          ),
        undefined,
        { timeout: 30_000 },
      )
    } catch {
      const diagnostics = rendererDiagnostics.slice(-5).join(' | ') || 'no renderer errors captured'
      throw new Error(`renderer shell did not settle within 30s; ${diagnostics}`)
    }
    const shell = await page.evaluate(() => ({
      title: document.title,
      hasRuntimeUnavailable: Boolean(document.querySelector('.runtime-unavailable')),
      hasMainWindow: Boolean(document.querySelector('.main-window')),
      hasTopbar: Boolean(document.querySelector('.app-topbar')),
      hasStatusBar: Boolean(document.querySelector('.status-bar')),
      bodyText: document.body.innerText,
      apiKeys: Object.keys(window.cclinkStudio || {}).sort(),
    }))
    assert(shell.title === expectedProductName, `unexpected title: ${shell.title}`)
    assert(!shell.hasRuntimeUnavailable, 'renderer reports runtime unavailable')
    assert(shell.hasMainWindow, 'main window is missing')
    assert(shell.hasTopbar, 'topbar is missing')
    assert(shell.hasStatusBar, 'status bar is missing')
    for (const forbidden of ['auth', 'subscription', 'sync', 'cclink', 'remote']) {
      assert(!shell.apiKeys.includes(forbidden), `forbidden preload API exposed: ${forbidden}`)
    }
    const blockedUiCopy = ['登录 CCLink', '订阅', '配额', `Remote ${'Workspace'}`]
    assert(
      blockedUiCopy.every((text) => !shell.bodyText.includes(text)),
      'login or paid UI copy leaked',
    )
    return `apis=${shell.apiKeys.length}`
  })

  await runCheck('official integration defaults to oss no-op', async () => {
    const status = await page.evaluate(() => window.cclinkStudio.official.getStatus())
    assert(status.id === 'oss-noop', `unexpected official id: ${status.id}`)
    assert(status.buildProfile === 'oss', `unexpected build profile: ${status.buildProfile}`)
    assert(status.available === false, 'official integration should be unavailable in OSS')
    assert(
      Object.values(status.features).every((enabled) => enabled === false),
      'official feature enabled',
    )
    return status.reason
  })

  await runCheck('local identity exists without account login', async () => {
    const identity = await page.evaluate(() => window.cclinkStudio.identity.getLocalIdentity())
    assert(identity.localId?.startsWith('local_'), 'localId is invalid')
    assert(identity.deviceId?.startsWith('device_'), 'deviceId is invalid')
    assert(identity.boundCloudUserId == null, 'local smoke should not bind a cloud user')
    return identity.deviceName
  })

  await runCheck('settings read/write is local and reversible', async () => {
    const result = await page.evaluate(async () => {
      const before = await window.cclinkStudio.settings.getAll()
      const nextValue = !before.showHiddenFiles
      const setResult = await window.cclinkStudio.settings.set({ showHiddenFiles: nextValue })
      const afterSet = await window.cclinkStudio.settings.getAll()
      const restoreResult = await window.cclinkStudio.settings.set({
        showHiddenFiles: before.showHiddenFiles,
      })
      const afterRestore = await window.cclinkStudio.settings.getAll()
      return { before, nextValue, setResult, afterSet, restoreResult, afterRestore }
    })
    assert(result.setResult.success, result.setResult.error || 'settings set failed')
    assert(result.afterSet.showHiddenFiles === result.nextValue, 'settings value did not change')
    assert(result.restoreResult.success, result.restoreResult.error || 'settings restore failed')
    assert(
      result.afterRestore.showHiddenFiles === result.before.showHiddenFiles,
      'settings value was not restored',
    )
    return 'showHiddenFiles restored'
  })

  await runCheck('filesystem can create, read, rename, and delete local files', async () => {
    const result = await page.evaluate(async (dir) => {
      const home = await window.cclinkStudio.fs.getHomePath()
      const workspaceDir = `${home}/.cclink-studio-smoke-${Date.now()}`
      const file = `${workspaceDir}/draft.md`
      const renamed = `${workspaceDir}/renamed.md`
      await window.cclinkStudio.fs.writeFile(file, '# Smoke\n\nlocal file')
      const read = await window.cclinkStudio.fs.readFile(file)
      const stat = await window.cclinkStudio.fs.stat(file)
      await window.cclinkStudio.fs.rename(file, renamed)
      const entries = await window.cclinkStudio.fs.readDir(workspaceDir)
      await window.cclinkStudio.fs.delete(renamed)
      return { workspaceDir, read, stat, entries }
    })
    tempWorkspaceDir = result.workspaceDir
    assert(result.read.content.includes('local file'), 'read content mismatch')
    assert(result.stat.type === 'file', 'stat did not report a file')
    assert(
      result.entries.some((entry) => entry.name === 'renamed.md'),
      'renamed file not listed',
    )
    return result.workspaceDir
  })

  await runCheck('browser view responds through local preload API', async () => {
    const result = await page.evaluate(async () => {
      const url = await window.cclinkStudio.browser.getCurrentURL('browser')
      const history = await window.cclinkStudio.browser.listHistory(5)
      const snapshots = await window.cclinkStudio.browser.listSnapshots()
      return { url, history, snapshots }
    })
    assert(typeof result.url === 'string', 'browser current URL should be a string')
    assert(Array.isArray(result.history), 'browser history should be an array')
    assert(Array.isArray(result.snapshots), 'browser snapshots should be an array')
    return result.url || 'blank'
  })

  await runCheck('agent and MCP capability status is available locally', async () => {
    const result = await page.evaluate(async () => {
      const status = await window.cclinkStudio.agent.getStatus()
      const capabilities = await window.cclinkStudio.agent.getCapabilities()
      const mode = await window.cclinkStudio.agent.getPermissionMode()
      return { status, capabilities, mode }
    })
    assert(result.status && typeof result.status === 'object', 'agent status is missing')
    assert(Array.isArray(result.capabilities), 'agent capabilities should be an array')
    assert(
      ['auto', 'categorized', 'strict'].includes(result.mode),
      `bad permission mode: ${result.mode}`,
    )
    return `capabilities=${result.capabilities.length}, permission=${result.mode}`
  })

  await runCheck('terminal PTY can start and stop locally', async () => {
    const result = await page.evaluate(async () => {
      const sessionId = `smoke-terminal-${Date.now()}`
      const runtime = {
        location: 'local',
        transport: 'local',
        backend: 'local-shell',
        workspaceRef: { kind: 'local', path: '/tmp' },
        cwd: '/tmp',
      }
      const events = []
      const off = window.cclinkStudio.terminal.onExecutionEvent((event) => {
        if (event.sessionId === sessionId) events.push(event)
      })
      const started = await window.cclinkStudio.terminal.startPty({
        terminalSessionId: sessionId,
        runtime,
        size: { columns: 80, rows: 24 },
      })
      if (started.success) {
        const startedAt = Date.now()
        while (Date.now() - startedAt < 5000 && !events.some((event) => event.kind === 'started')) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        const promptStartedAt = Date.now()
        while (
          Date.now() - promptStartedAt < 5000 &&
          !events.some((event) => event.kind === 'output')
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        await window.cclinkStudio.terminal.writePty({
          terminalSessionId: sessionId,
          data: 'pwd\rprintf "cclink-studio-smoke\\n"\rexit\r',
        })
      }
      const outputStartedAt = Date.now()
      while (Date.now() - outputStartedAt < 5000) {
        const output = events
          .filter((event) => event.kind === 'output')
          .map((event) => event.data)
          .join('')
        if (output.includes('cclink-studio-smoke')) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      const terminated = await window.cclinkStudio.terminal.terminatePty(sessionId)
      off()
      return { started, terminated, events }
    })
    assert(result.started.success, result.started.error || 'terminal failed to start')
    const output = result.events
      .filter((event) => event.kind === 'output')
      .map((event) => event.data)
      .join('')
    assert(output.includes('cclink-studio-smoke'), 'terminal output marker was not observed')
    assert(output.includes('/tmp'), `terminal did not execute in /tmp: ${output}`)
    return `pid=${result.started.processId ?? 'unknown'}`
  })

  await runCheck('android absence degrades without blocking the shell', async () => {
    const result = await page.evaluate(async () => {
      try {
        const devices = await window.cclinkStudio.android.listPhysicalDevices()
        return { ok: true, devices }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })
    assert(
      result.ok || /adb|Android|device|未找到/i.test(result.message),
      'unexpected android error',
    )
    return result.ok ? `devices=${result.devices.length}` : result.message
  })

  await browser.close()

  const failed = results.filter((result) => result.status === 'fail')
  if (startedBySmoke && !keepRunning) runRestart('stop')
  if (tempWorkspaceDir) rmSync(tempWorkspaceDir, { recursive: true, force: true })
  if (failed.length > 0) {
    console.error(`\nLocal smoke failed: ${failed.length}/${results.length}`)
    process.exit(1)
  }
  console.log(`\nLocal smoke passed: ${results.length}/${results.length}`)
}

main().catch((error) => {
  if (startedBySmoke && !keepRunning) {
    try {
      runRestart('stop')
    } catch {
      // best effort cleanup
    }
  }
  if (tempWorkspaceDir) rmSync(tempWorkspaceDir, { recursive: true, force: true })
  console.error(error)
  process.exit(1)
})
