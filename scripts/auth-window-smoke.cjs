const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const RESULT_PREFIX = 'CCLINK_AUTH_SMOKE_RESULT='
const PROFILE_PARTITION = 'persist:cclink-auth-window-smoke'
const STORAGE_KEY = 'cclink-auth-window-smoke'
const STORAGE_VALUE = 'retained-across-restart'
const COOKIE_NAME = 'cclink_auth_window_smoke'
const TEST_EMAIL = `cclink-browser-compat-${process.pid}-${Date.now()}@example.com`
const GOOGLE_OAUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=910913558771-jo298qljjvd2vh4b1rmkcb8m97mdbsbk.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fwww.v2ex.com%2Fauth%2Fgoogle&response_type=code&scope=profile%20email&prompt=select_account'
const GOOGLE_VARIANTS = ['clean', 'cdp', 'automation-controlled', 'ua-normalized', 'current']
const REQUIRE_GOOGLE_LIVE = process.env.CCLINK_AUTH_SMOKE_REQUIRE_GOOGLE === '1'
const PROFILE_ONLY = process.env.CCLINK_AUTH_SMOKE_PROFILE_ONLY === '1'
const CLEAN_GOOGLE_MAX_ATTEMPTS = 3
const NETWORK_ERROR_CODES = new Set([
  -2, -7, -21, -100, -101, -102, -105, -106, -109, -118, -137, -356,
])

if (!process.versions.electron) {
  void runController()
} else {
  void runElectronPhase().catch((error) => {
    const { app } = require('electron')
    const result = {
      outcome: 'phase-error',
      error: error instanceof Error ? error.message : String(error),
    }
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`, () => app.exit(1))
  })
}

async function runController() {
  if (PROFILE_ONLY && REQUIRE_GOOGLE_LIVE) {
    throw new Error('Profile-only auth smoke cannot require live Google verification')
  }

  const electronPath = require('electron')
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cclink-auth-smoke-'))

  try {
    const writeResult = await runChild(electronPath, 'write', userDataPath)
    const readResult = await runChild(electronPath, 'read', userDataPath)
    const googleResults = {}
    if (!PROFILE_ONLY) {
      for (const variant of GOOGLE_VARIANTS) {
        googleResults[variant] = await runGoogleVariant(electronPath, userDataPath, variant)
      }
    }
    const cleanGoogleOutcome = googleResults.clean?.outcome
    const googleStatus = PROFILE_ONLY
      ? 'not-run-profile-only'
      : cleanGoogleOutcome === 'account-validation-reached'
        ? 'passed'
        : cleanGoogleOutcome === 'network-unavailable'
          ? 'inconclusive-network'
          : 'failed'
    const result = {
      profilePersistence:
        writeResult.storageWritten === true &&
        writeResult.cookieWritten === true &&
        readResult.storageValue === STORAGE_VALUE &&
        readResult.cookieValue === STORAGE_VALUE,
      writeResult,
      readResult,
      googleCompatible: PROFILE_ONLY ? null : googleStatus === 'passed',
      googleStatus,
      googleLiveRequired: REQUIRE_GOOGLE_LIVE,
      profileOnly: PROFILE_ONLY,
      googleResults,
    }
    const googleGatePassed =
      PROFILE_ONLY ||
      googleStatus === 'passed' ||
      (googleStatus === 'inconclusive-network' && !REQUIRE_GOOGLE_LIVE)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    process.exitCode = result.profilePersistence && googleGatePassed ? 0 : 1
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  }
}

async function runGoogleVariant(electronPath, userDataPath, variant) {
  const maxAttempts = variant === 'clean' ? CLEAN_GOOGLE_MAX_ATTEMPTS : 1
  const attemptOutcomes = []
  let result = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await runChild(electronPath, 'google', userDataPath, variant)
    attemptOutcomes.push(result.outcome)
    if (!['network-unavailable', 'pending'].includes(result.outcome)) break
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)))
    }
  }

  return { ...result, attemptOutcomes }
}

function runChild(electronPath, phase, userDataPath, variant = null) {
  return new Promise((resolve, reject) => {
    const args = [__filename, `--phase=${phase}`, `--user-data=${userDataPath}`]
    if (variant) args.push(`--variant=${variant}`)
    const child = spawn(electronPath, args, {
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(
      () => {
        child.kill('SIGTERM')
        reject(new Error(`Electron phase ${phase} timed out: ${stderr || stdout}`))
      },
      phase === 'google' ? 90_000 : 30_000,
    )
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
        reject(new Error(`Electron phase ${phase} failed (code ${code}): ${stderr || stdout}`))
        return
      }
      resolve({
        ...JSON.parse(line.slice(RESULT_PREFIX.length)),
        processExitCode: code,
      })
    })
  })
}

async function runElectronPhase() {
  const { app, BrowserWindow, session } = require('electron')
  const phase = readArgument('--phase')
  const userDataPath = readArgument('--user-data')
  const variant = readArgument('--variant') ?? 'clean'
  if (!phase || !userDataPath) throw new Error('Missing smoke-test phase or user-data path')

  app.setPath('userData', userDataPath)
  if (variant === 'cdp' || variant === 'current') {
    app.commandLine.appendSwitch('remote-debugging-port', '0')
  }
  if (variant === 'automation-controlled' || variant === 'current') {
    app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
  }
  await app.whenReady()

  const profileSession = session.fromPartition(PROFILE_PARTITION)
  let result
  if (phase === 'write') result = await writeProfileState(BrowserWindow, profileSession)
  else if (phase === 'read') result = await readProfileState(BrowserWindow, profileSession)
  else if (phase === 'google') {
    result = await testGoogleCompatibility(BrowserWindow, profileSession, variant)
  } else throw new Error(`Unknown phase: ${phase}`)

  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`)
  app.quit()
}

function readArgument(name) {
  const prefix = `${name}=`
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null
}

function createCleanWindow(BrowserWindow, profileSession, show = false) {
  return new BrowserWindow({
    show,
    width: 1100,
    height: 800,
    webPreferences: {
      session: profileSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
}

async function writeProfileState(BrowserWindow, profileSession) {
  const window = createCleanWindow(BrowserWindow, profileSession)
  await window.loadFile(path.resolve(__dirname, '../src/main/playwright/test-page.html'))
  await window.webContents.executeJavaScript(
    `localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(STORAGE_VALUE)})`,
  )
  await profileSession.cookies.set({
    url: 'https://www.v2ex.com/',
    name: COOKIE_NAME,
    value: STORAGE_VALUE,
    path: '/',
    secure: true,
    httpOnly: true,
    expirationDate: Date.now() / 1000 + 3600,
  })
  await profileSession.cookies.flushStore()
  await profileSession.flushStorageData()
  const cookie = (await profileSession.cookies.get({ url: 'https://www.v2ex.com/' })).find(
    (candidate) => candidate.name === COOKIE_NAME,
  )
  window.destroy()
  return { storageWritten: true, cookieWritten: cookie?.value === STORAGE_VALUE }
}

async function readProfileState(BrowserWindow, profileSession) {
  const window = createCleanWindow(BrowserWindow, profileSession)
  await window.loadFile(path.resolve(__dirname, '../src/main/playwright/test-page.html'))
  const storageValue = await window.webContents.executeJavaScript(
    `localStorage.getItem(${JSON.stringify(STORAGE_KEY)})`,
  )
  const cookie = (await profileSession.cookies.get({ url: 'https://www.v2ex.com/' })).find(
    (candidate) => candidate.name === COOKIE_NAME,
  )
  window.destroy()
  return { storageValue, cookieValue: cookie?.value ?? null }
}

async function testGoogleCompatibility(BrowserWindow, profileSession, variant) {
  const window = createCleanWindow(BrowserWindow, profileSession, true)
  let navigationFailure = null
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return
      navigationFailure = { errorCode, errorDescription, validatedURL }
    },
  )
  const initialUserAgent = window.webContents.getUserAgent()
  if (variant === 'ua-normalized' || variant === 'current') {
    window.webContents.setUserAgent(initialUserAgent.replace(/\s+Electron\/[\d.]+/i, ''))
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    void window.loadURL(url)
    return { action: 'deny' }
  })

  let loadError = null
  try {
    await window.loadURL(GOOGLE_OAUTH_URL)
  } catch (error) {
    loadError = error
  }

  if (loadError) {
    const errorCode =
      navigationFailure?.errorCode ??
      (typeof loadError.errno === 'number' ? loadError.errno : undefined)
    const errorDescription =
      navigationFailure?.errorDescription ??
      (loadError instanceof Error ? loadError.message : String(loadError))
    const windowDestroyed = window.isDestroyed()
    const failedUrl = navigationFailure?.validatedURL ?? safeWindowUrl(window)
    const effectiveUserAgent = safeUserAgent(window, initialUserAgent)
    destroyWindow(window)
    return {
      outcome: classifyNavigationFailure(errorCode, errorDescription),
      url: summarizeUrl(failedUrl),
      errorCode: errorCode ?? null,
      errorDescription,
      windowDestroyed,
      initialUserAgent,
      effectiveUserAgent,
    }
  }

  await waitForCondition(() => window.webContents.getURL().includes('accounts.google.com'), 15_000)

  const emailInputFound = await waitForCondition(async () => {
    return executeWithTimeout(
      window,
      `Boolean(document.querySelector('input[type="email"], input[name="identifier"]'))`,
    )
  }, 15_000)
  if (!emailInputFound) {
    const pageText = await safePageText(window)
    const url = safeWindowUrl(window)
    const effectiveUserAgent = safeUserAgent(window, initialUserAgent)
    destroyWindow(window)
    return {
      outcome: classifyGoogleOutcome(url, pageText),
      url: summarizeUrl(url),
      initialUserAgent,
      effectiveUserAgent,
    }
  }

  await executeWithTimeout(
    window,
    `(() => {
    const input = document.querySelector('input[type="email"], input[name="identifier"]')
    input.focus()
    input.value = ${JSON.stringify(TEST_EMAIL)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    const next = document.querySelector('#identifierNext button, #identifierNext')
    if (next) next.click()
  })()`,
  )

  await waitForCondition(async () => {
    const url = window.webContents.getURL()
    const text = await safePageText(window)
    return classifyGoogleOutcome(url, text) !== 'pending'
  }, 20_000)

  const url = safeWindowUrl(window)
  const pageText = await safePageText(window)
  const outcome = classifyGoogleOutcome(url, pageText)
  const effectiveUserAgent = safeUserAgent(window, initialUserAgent)
  destroyWindow(window)
  return { outcome, url: summarizeUrl(url), initialUserAgent, effectiveUserAgent }
}

function safeWindowUrl(window) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return ''
  return window.webContents.getURL()
}

function safeUserAgent(window, fallback) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return fallback
  return window.webContents.getUserAgent()
}

function destroyWindow(window) {
  if (!window.isDestroyed()) window.destroy()
}

function classifyNavigationFailure(errorCode, errorDescription) {
  if (
    NETWORK_ERROR_CODES.has(errorCode) ||
    /ERR_(?:FAILED|TIMED_OUT|CONNECTION_|INTERNET_|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|QUIC_PROTOCOL_ERROR)/i.test(
      errorDescription,
    )
  ) {
    return 'network-unavailable'
  }
  return 'navigation-failed'
}

function summarizeUrl(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url
  }
}

function classifyGoogleOutcome(url, text) {
  if (
    url.includes('/signin/rejected') ||
    /浏览器或应用可能不安全|browser or app may not be secure/i.test(text)
  ) {
    return 'rejected-as-unsafe-browser'
  }
  if (/找不到您的 Google 账号|couldn.?t find your google account/i.test(text)) {
    return 'account-validation-reached'
  }
  if (/验证您是本人|verify it.?s you|输入您的密码|enter your password/i.test(text)) {
    return 'account-validation-reached'
  }
  return 'pending'
}

async function safePageText(window) {
  return executeWithTimeout(window, `document.body?.innerText?.slice(0, 4000) || ''`).catch(
    () => '',
  )
}

function executeWithTimeout(window, script, timeoutMs = 3_000) {
  return Promise.race([
    window.webContents.executeJavaScript(script),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('executeJavaScript timed out')), timeoutMs),
    ),
  ])
}

async function waitForCondition(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await Promise.resolve(predicate()).catch(() => false)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}
