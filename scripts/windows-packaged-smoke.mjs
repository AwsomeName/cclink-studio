#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('此 smoke 必须在 Windows x64 上运行')
}
const execFileAsync = promisify(execFile)
const output = resolve(import.meta.dirname, '../dist/windows')
const evidence = join(output, 'smoke')
const temporary = await mkdtemp(join(tmpdir(), 'cclink-windows-smoke-'))
const userData = join(temporary, 'user-data')
const workspace = join(temporary, 'workspace')
// 静默安装会写 Windows 卸载注册项，因此仅允许在隔离 CI runner 上执行。
const testInstallation = process.env.CI === 'true'
const appDir = testInstallation ? join(temporary, 'installed') : join(output, 'win-unpacked')
const executable = join(appDir, 'cclink-studio.exe')
const report = { platform: process.platform, arch: process.arch, checks: [] }
await mkdir(evidence, { recursive: true })
await mkdir(workspace, { recursive: true })
const log = await open(join(evidence, 'application.log'), 'w')
let child
let browser
const fixture = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(
    '<!doctype html><title>Windows packaged browser</title><h1>Windows browser works</h1>',
  )
})

async function waitFor(check, label, timeout = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (await check()) return
    if (child && child.exitCode !== null) throw new Error(`App 提前退出：${child.exitCode}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`等待超时：${label}`)
}
function pass(name) {
  report.checks.push({ name, status: 'pass' })
  console.log(`PASS ${name}`)
}

try {
  if (testInstallation) {
    const installers = (await readdir(output)).filter((name) => name.endsWith('-test-setup.exe'))
    assert.equal(installers.length, 1)
    await execFileAsync(join(output, installers[0]), ['/S', `/D=${appDir}`], { timeout: 180_000 })
    await waitFor(
      () =>
        readFile(executable).then(
          () => true,
          () => false,
        ),
      'NSIS 安装',
      60_000,
    )
    pass('NSIS silent installation on isolated Windows runner')
  }
  child = spawn(executable, [], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CCLINK_STUDIO_PACKAGED_SMOKE: '1',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', log.fd, log.fd],
  })
  child.on('error', (error) => {
    report.spawnError = error.message
  })
  const portFile = join(userData, 'DevToolsActivePort')
  await waitFor(
    () =>
      readFile(portFile, 'utf8').then(
        () => true,
        () => false,
      ),
    'CDP 启动',
  )
  const [port] = (await readFile(portFile, 'utf8')).trim().split('\n')
  assert.match(port, /^\d+$/)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  let page
  await waitFor(async () => {
    for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
      if (await candidate.locator('.main-window').count()) {
        page = candidate
        return true
      }
    }
    return false
  }, '免登录工作台')
  assert.equal(await page.locator('.runtime-unavailable').count(), 0)
  await page.locator('.status-bar').waitFor()
  const diagnostics = await page.evaluate(() => window.cclinkStudio.workspaceState.diagnostics())
  assert.equal(resolve(diagnostics.userDataPath).toLowerCase(), resolve(userData).toLowerCase())
  await page.screenshot({ path: join(evidence, 'workbench.png') })
  pass('installed application starts without login using isolated userData')

  const file = join(workspace, 'windows-smoke.md')
  const fileResult = await page.evaluate(
    async ({ workspace, file }) => {
      const active = await window.cclinkStudio.workspaceState.setActiveLocalWorkspace(workspace)
      if (!active.success) throw new Error(active.error)
      await window.cclinkStudio.fs.writeFile(file, '# Windows smoke\n\nFile round trip')
      return window.cclinkStudio.fs.readFile(file)
    },
    { workspace, file },
  )
  assert.match(fileResult.content, /File round trip/)
  pass('local workspace file write and read through preload IPC')

  const sessionId = `windows-smoke-${Date.now()}`
  const terminal = await page.evaluate(
    async ({ workspace, sessionId, shell }) => {
      const events = []
      const off = window.cclinkStudio.terminal.onExecutionEvent((event) => {
        if (event.sessionId === sessionId) events.push(event)
      })
      try {
        const started = await window.cclinkStudio.terminal.startPty({
          terminalSessionId: sessionId,
          runtime: {
            location: 'local',
            transport: 'local',
            backend: 'local-shell',
            workspaceRef: { kind: 'local', path: workspace },
            cwd: workspace,
            shell,
          },
          size: { columns: 80, rows: 24 },
        })
        if (!started.success) throw new Error(started.error)
        const written = await window.cclinkStudio.terminal.writePty({
          terminalSessionId: sessionId,
          data: '@echo off\recho cclink-windows-pty>pty-result.txt\rtype pty-result.txt\r',
        })
        if (!written.success) throw new Error(written.error)
        const start = Date.now()
        while (Date.now() - start < 15_000) {
          const output = events
            .filter((event) => event.kind === 'output')
            .map((event) => event.data)
            .join('')
          if (output.includes('cclink-windows-pty')) return { started, output }
          await new Promise((resolveWait) => setTimeout(resolveWait, 100))
        }
        throw new Error('Windows PTY 没有输出')
      } finally {
        await window.cclinkStudio.terminal.terminatePty(sessionId)
        off()
      }
    },
    { workspace, sessionId, shell: process.env.COMSPEC || 'cmd.exe' },
  )
  await waitFor(
    () =>
      readFile(join(workspace, 'pty-result.txt'), 'utf8').then(
        (text) => text.trim() === 'cclink-windows-pty',
        () => false,
      ),
    'PTY 命令实际执行',
  )
  assert.ok(terminal.started.success)
  pass('native Windows PTY executes a command and returns output')

  await new Promise((resolveListen) => fixture.listen(0, '127.0.0.1', resolveListen))
  const url = `http://127.0.0.1:${fixture.address().port}/`
  await page.locator('.tab-new-button').first().click()
  await page.locator('.tab-create-menu button', { hasText: '浏览器页' }).click()
  const address = page.locator('.browser-toolbar .url-input')
  await address.fill(url)
  await address.press('Enter')
  let browserPage
  await waitFor(() => {
    browserPage = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((target) => target.url() === url)
    return Boolean(browserPage)
  }, '内嵌浏览器导航')
  await browserPage.getByRole('heading', { name: 'Windows browser works' }).waitFor()
  await browserPage.screenshot({ path: join(evidence, 'browser.png') })
  pass('embedded browser opens and renders a page through the workbench UI')
  report.status = 'pass'
} catch (error) {
  report.status = 'fail'
  report.error = error.stack || String(error)
  throw error
} finally {
  await browser?.close().catch(() => undefined)
  if (child?.exitCode === null) {
    await execFileAsync('taskkill', ['/pid', String(child.pid), '/t', '/f']).catch(() => undefined)
  }
  await log.close()
  fixture.closeAllConnections()
  await new Promise((resolveClose) => fixture.close(resolveClose))
  if (testInstallation) {
    const uninstaller = (await readdir(appDir).catch(() => [])).find((name) =>
      /^Uninstall.*\.exe$/i.test(name),
    )
    if (uninstaller) {
      await execFileAsync(join(appDir, uninstaller), ['/S'], { timeout: 60_000 }).catch(
        () => undefined,
      )
    }
  }
  await writeFile(join(evidence, 'results.json'), `${JSON.stringify(report, null, 2)}\n`)
  await rm(temporary, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined)
}
