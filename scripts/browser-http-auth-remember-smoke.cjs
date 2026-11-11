const { spawn } = require('node:child_process')
const { createRequire } = require('node:module')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { build } = createRequire(require.resolve('vite'))('esbuild')

void run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cclink-basic-remember-'))
  const fixtureApp = path.join(temporary, 'app')
  const userData = path.join(temporary, 'user-data')
  let expectedPassword = ' smoke-password '
  const server = http.createServer((request, response) => {
    const expected = `Basic ${Buffer.from(`smoke-user:${expectedPassword}`).toString('base64')}`
    if (request.headers.authorization !== expected) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Remember Smoke"' })
      response.end('Unauthorized')
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<title>Remembered Basic Auth</title><main>Authenticated</main>')
    }
  })
  try {
    fs.mkdirSync(fixtureApp, { recursive: true })
    fs.writeFileSync(
      path.join(fixtureApp, 'package.json'),
      JSON.stringify({ name: 'basic-remember-fixture', version: '1.0.0', main: 'main/index.cjs' }),
    )
    await build({
      entryPoints: ['scripts/fixtures/browser-http-auth-remember.ts'],
      outfile: path.join(fixtureApp, 'main/index.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      logLevel: 'warning',
    })
    await build({
      entryPoints: ['src/preload/browser-http-auth.ts'],
      outfile: path.join(fixtureApp, 'preload/browserHttpAuth.js'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      logLevel: 'warning',
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://basic.test:${server.address().port}/dashboard`
    const results = []
    for (const phase of [
      'save',
      'restore',
      'replace',
      'restore-new',
      'isolated',
      'isolated-again',
      'clear',
    ]) {
      if (phase === 'replace') expectedPassword = ' changed-password '
      results.push(await launch(fixtureApp, userData, url, phase))
      if (phase === 'save') {
        const file = path.join(userData, 'credentials/credentials.json')
        if ((fs.statSync(file).mode & 0o777) !== 0o600)
          throw new Error('Credential file permissions differ from 0600')
      }
    }
    console.log(
      JSON.stringify({ ok: true, separateElectronProcesses: results.length, results }, null, 2),
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

function launch(fixtureApp, userData, url, phase) {
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [fixtureApp], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        CCLINK_BASIC_SMOKE_PHASE: phase,
        CCLINK_BASIC_SMOKE_DATA: userData,
        CCLINK_BASIC_SMOKE_URL: url,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${phase} timed out: ${output}`))
    }, 30_000)
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      const line = output.split(/\r?\n/).find((entry) => entry.startsWith('BASIC_REMEMBER_RESULT='))
      if (code !== 0 || !line) reject(new Error(`${phase} failed (${code}): ${output}`))
      else resolve(JSON.parse(line.slice('BASIC_REMEMBER_RESULT='.length)))
    })
  })
}
