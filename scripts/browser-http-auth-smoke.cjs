const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const RESULT_PREFIX = 'CCLINK_BROWSER_HTTP_AUTH_RESULT='
const TEST_USERNAME = 'smoke-user'
const TEST_PASSWORD = 'smoke-password'

if (!process.versions.electron) {
  void runController().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
} else {
  void runElectronPhase().catch((error) => {
    const { app } = require('electron')
    emitResult(
      { ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error) },
      1,
      app,
    )
  })
}

async function runController() {
  const electronPath = require('electron')
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cclink-http-auth-smoke-'))
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(electronPath, [__filename, `--user-data=${userDataPath}`], {
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0', ELECTRON_RUN_AS_NODE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error(`Electron Basic Auth smoke timed out: ${stderr || stdout}`))
      }, 30_000)
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
          reject(new Error(`Electron Basic Auth smoke exited ${code}: ${stderr || stdout}`))
          return
        }
        resolve({ ...JSON.parse(line.slice(RESULT_PREFIX.length)), processExitCode: code })
      })
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = result.ok ? 0 : 1
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
}

async function runElectronPhase() {
  const { app, BrowserWindow, WebContentsView, session } = require('electron')
  const userDataPath = readArgument('--user-data')
  if (!userDataPath) throw new Error('Missing --user-data')
  app.setPath('userData', userDataPath)
  await app.whenReady()

  let authorizedRequests = 0
  let rejectedRequests = 0
  const expectedAuthorization = `Basic ${Buffer.from(`${TEST_USERNAME}:${TEST_PASSWORD}`).toString('base64')}`
  const server = http.createServer((request, response) => {
    if (request.headers.authorization !== expectedAuthorization) {
      rejectedRequests += 1
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="CCLink Smoke"' })
      response.end('Unauthorized')
      return
    }
    authorizedRequests += 1
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><title>Basic Auth passed</title><main id="result">protected</main>',
    )
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture address unavailable')
  const targetUrl = `http://127.0.0.1:${address.port}/dashboard`
  const browserSession = session.fromPartition('cclink-http-auth-smoke')
  const window = new BrowserWindow({ show: false, width: 800, height: 600 })
  const view = new WebContentsView({
    webPreferences: {
      session: browserSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })

  const events = []
  const challengeDetails = []
  let challengeCount = 0
  view.webContents.on('did-start-navigation', (_event, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace)
      events.push({ type: 'did-start-navigation', origin: new URL(url).origin })
  })
  view.webContents.on('login', (event, details, authInfo, callback) => {
    events.push({ type: 'login', origin: new URL(details.url).origin })
    challengeDetails.push({
      scheme: authInfo.scheme,
      isProxy: authInfo.isProxy,
      realm: authInfo.realm,
    })
    event.preventDefault()
    challengeCount += 1
    if (challengeCount === 1) callback(TEST_USERNAME, 'intentionally-wrong')
    else callback(TEST_USERNAME, TEST_PASSWORD)
  })

  await withTimeout(view.webContents.loadURL(targetUrl), 15_000, 'protected page navigation')
  const marker = await view.webContents.executeJavaScript(
    `document.querySelector('#result')?.textContent ?? null`,
  )
  const firstStart = events.findIndex((event) => event.type === 'did-start-navigation')
  const firstLogin = events.findIndex((event) => event.type === 'login')
  const result = {
    ok:
      marker === 'protected' &&
      challengeCount === 2 &&
      rejectedRequests >= 2 &&
      authorizedRequests === 1 &&
      firstStart >= 0 &&
      firstLogin > firstStart &&
      challengeDetails.every(
        (details) =>
          details.scheme === 'basic' &&
          details.isProxy === false &&
          details.realm === 'CCLink Smoke',
      ),
    marker,
    challengeCount,
    rejectedRequests,
    authorizedRequests,
    didStartBeforeLogin: firstLogin > firstStart,
    challengeDetails,
  }

  window.destroy()
  await new Promise((resolve) => server.close(resolve))
  emitResult(result, result.ok ? 0 : 1, app)
}

function readArgument(name) {
  const prefix = `${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs),
    ),
  ])
}

function emitResult(result, exitCode, app) {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`, () => app.exit(exitCode))
}
