#!/usr/bin/env node

if (process.versions.electron) {
  void runElectronFixture().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    require('electron').app.exit(1)
  })
} else {
  void runController().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exitCode = 1
  })
}

async function runController() {
  const fs = require('node:fs')
  const http = require('node:http')
  const os = require('node:os')
  const path = require('node:path')
  const { _electron } = require('playwright-core')
  const ts = require('typescript')

  const rootDir = path.resolve(__dirname, '..')
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cclink-cookie-security-smoke-'))
  const bundledActionPath = path.join(tempDir, 'playwright-actions.cjs')
  let electronApp = null
  let server = null
  try {
    const actionSource = fs.readFileSync(
      path.join(rootDir, 'src/main/playwright/playwright-actions.ts'),
      'utf8',
    )
    const transpiled = ts.transpileModule(actionSource, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: 'playwright-actions.ts',
    })
    fs.writeFileSync(bundledActionPath, transpiled.outputText, 'utf8')
    server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Cookie security smoke</title><main>ready</main>')
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture address unavailable')
    const origin = `http://127.0.0.1:${address.port}`

    electronApp = await _electron.launch({
      args: [__filename, `--fixture-url=${origin}/`],
      timeout: 20_000,
    })
    const context = electronApp.context()
    await waitFor(
      () => context.pages().some((page) => page.url().startsWith(origin)),
      15_000,
      'WebContentsView fixture page',
    )

    const canary = 'cookie-canary-http-only-secret'
    const expires = Math.floor(Date.now() / 1000) + 3600
    await context.addCookies([
      { name: 'sid', value: canary, url: `${origin}/`, httpOnly: true, expires },
      { name: 'sid_backup', value: 'backup', url: `${origin}/`, expires },
      { name: 'sid.test', value: 'dot', url: `${origin}/`, expires },
      { name: 'sid+test', value: 'plus', url: `${origin}/`, expires },
      {
        name: 'sid',
        value: 'admin',
        domain: '127.0.0.1',
        path: '/admin',
        secure: false,
        expires,
      },
    ])

    const { executePlaywrightAction } = require(bundledActionPath)
    const bridge = { getContext: () => context }
    const metadata = await executePlaywrightAction(
      null,
      { type: 'getCookies', urls: [origin] },
      bridge,
    )
    const serializedMetadata = JSON.stringify(metadata)
    assert(
      !serializedMetadata.includes(canary),
      'HttpOnly Cookie canary escaped into action result',
    )
    assert(!serializedMetadata.includes('sid'), 'Cookie name escaped into action result')
    assert(!serializedMetadata.includes('httpOnly'), 'HttpOnly field escaped into action result')

    const before = await context.cookies()
    const rootCookie = before.find((cookie) => cookie.name === 'sid' && cookie.path === '/')
    assert(rootCookie, 'root sid fixture missing')
    const cleared = await executePlaywrightAction(
      null,
      {
        type: 'clearCookies',
        names: ['sid'],
        domain: rootCookie.domain,
        path: '/',
      },
      bridge,
    )
    const after = await context.cookies()
    const identities = after
      .map((cookie) => `${cookie.name}|${cookie.domain}|${cookie.path}`)
      .sort()
    assert(cleared.cleared === 1, `expected one exact Cookie deletion, got ${cleared.cleared}`)
    assert(!identities.includes(`sid|${rootCookie.domain}|/`), 'root sid survived')
    for (const expected of ['sid_backup', 'sid.test', 'sid+test']) {
      assert(
        after.some((cookie) => cookie.name === expected),
        `${expected} was deleted by fuzzy matching`,
      )
    }
    assert(
      after.some((cookie) => cookie.name === 'sid' && cookie.path === '/admin'),
      'same-name Cookie on adjacent path was deleted',
    )

    process.stdout.write(
      `${JSON.stringify({
        success: true,
        webContentsView: true,
        cookieCountBefore: before.length,
        cookieCountAfter: after.length,
        metadata,
        remainingNames: after.map((cookie) => cookie.name).sort(),
      })}\n`,
    )
  } finally {
    await electronApp?.close().catch(() => undefined)
    if (server) await new Promise((resolve) => server.close(resolve))
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function runElectronFixture() {
  const { app, BrowserWindow, WebContentsView, session } = require('electron')
  const fixtureUrl = readArgument('--fixture-url')
  if (!fixtureUrl) throw new Error('missing --fixture-url')
  await app.whenReady()
  const window = new BrowserWindow({ show: false, width: 800, height: 600 })
  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition('cclink-cookie-security-smoke'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  await view.webContents.loadURL(fixtureUrl)
}

function readArgument(name) {
  const prefix = `${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${label} timed out`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
