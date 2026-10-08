import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, realpath, rename, chmod, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

// Explicit isolated fixture root only; never touch an installed user application.
const root = await realpath(process.argv[2] ?? '')
assert(root.startsWith('/private/tmp/cclink-update-signed-smoke-'))
const helper = resolve('out/update-helper/cclink-update-helper')
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '', CCLINK_STUDIO_PACKAGED_SMOKE: '1' }
const children = new Set()
const mounted = []
const fixturePaths = []
const experimentId = randomUUID().slice(0, 8)
// Range-download artifacts may be provided by the caller; only rename inside this isolated root.
for (const name of ['old', 'new']) {
  try {
    await rename(join(root, `${name}.parallel.dmg`), join(root, `${name}.dmg`))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

async function waitFor(get, timeout = 60000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await get()
    if (value) return value
    await new Promise((done) => setTimeout(done, 200))
  }
  throw new Error('Signed helper smoke timed out')
}

async function record(path) {
  return JSON.parse(await readFile(path, 'utf8').catch(() => 'null'))
}

async function connect(pid) {
  const port = await waitFor(async () => {
    try {
      const output = execFileSync(
        '/usr/sbin/lsof',
        ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN'],
        { encoding: 'utf8' },
      )
      const ports = [...output.matchAll(/127\.0\.0\.1:(\d+)/g)].map((match) => match[1])
      for (const value of ports) {
        const response = await fetch(`http://127.0.0.1:${value}/json/version`).catch(() => null)
        if (response?.ok) return value
      }
    } catch {
      /* process is still starting */
    }
    return null
  })
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((value) => value.url().startsWith('file:')),
  )
  await page.waitForSelector('.main-window', { timeout: 60000 })
  await page.waitForFunction(() => !!window.cclinkStudio?.update)
  return { browser, page }
}

try {
  const apps = []
  for (const name of ['old', 'new']) {
    const mount = join(root, `${name}-volume`)
    await mkdir(mount, { recursive: true })
    execFileSync(
      '/usr/bin/hdiutil',
      [
        'attach',
        '-readonly',
        '-nobrowse',
        '-noautoopen',
        '-mountpoint',
        mount,
        join(root, `${name}.dmg`),
      ],
      { stdio: 'ignore' },
    )
    mounted.push(mount)
    const app = join(mount, 'CCLink Studio 开源版.app')
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
    execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', app])
    apps.push(app)
  }
  for (const mode of [
    'success',
    'signature-tamper',
    'cancel',
    'permission-denied',
    'worker-crash',
    'startup-timeout',
  ]) {
    const testRoot = join(root, `${mode}-${experimentId}`)
    await mkdir(testRoot, { mode: 0o700 })
    const targetPath = join(testRoot, 'Studio.app')
    fixturePaths.push(targetPath)
    const stage = join(testRoot, '.cclink-update-fixture')
    const transactionRoot = join(testRoot, 'transaction')
    const candidatePath = join(stage, 'candidate.app')
    await mkdir(stage, { mode: 0o700 })
    await mkdir(transactionRoot, { mode: 0o700 })
    execFileSync('/usr/bin/ditto', [apps[0], targetPath])
    execFileSync('/usr/bin/ditto', [apps[1], candidatePath])
    const { spawnSync } = await import('node:child_process')
    const teamId = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', targetPath], {
      encoding: 'utf8',
    }).stderr.match(/TeamIdentifier=(\w+)/)[1]
    const testEnv = { ...env, CCLINK_STUDIO_TEST_USER_DATA_PATH: join(testRoot, 'user-data') }
    const old = spawn(join(targetPath, 'Contents/MacOS/CCLink Studio 开源版'), [], {
      env: testEnv,
      stdio: 'ignore',
    })
    children.add(old)
    const oldUi = await connect(old.pid)
    assert.equal(
      (await oldUi.page.evaluate(() => window.cclinkStudio.update.getSnapshot())).currentVersion,
      '0.1.103',
    )
    const nonce = randomUUID()
    await writeFile(
      join(transactionRoot, 'transaction.json'),
      JSON.stringify({
        targetPath,
        candidatePath,
        currentVersion: '0.1.103',
        targetVersion: '0.1.104',
        teamId,
        nonce,
        parentPid: old.pid,
      }),
      { mode: 0o600 },
    )
    if (mode === 'signature-tamper') {
      await appendFile(join(candidatePath, 'Contents/Info.plist'), '\n')
    }
    if (mode === 'permission-denied') await chmod(testRoot, 0o555)
    const install = spawn(helper, [transactionRoot], { env: testEnv, stdio: 'inherit' })
    children.add(install)
    if (mode === 'signature-tamper') {
      await waitFor(() => install.exitCode !== null)
      assert.equal(install.exitCode, 3)
      assert.equal(
        (await oldUi.page.evaluate(() => window.cclinkStudio.update.getSnapshot())).currentVersion,
        '0.1.103',
      )
      await oldUi.page.evaluate(() => window.cclinkStudio.window.requestClose()).catch(() => {})
      await oldUi.browser.close()
      console.log('PASS damaged candidate is rejected without closing or replacing the old App')
      continue
    }
    await waitFor(async () => {
      if (install.exitCode !== null)
        throw new Error(
          `Helper exited before readiness: ${install.exitCode}; diagnostic=${JSON.stringify(await record(join(transactionRoot, 'verification-error.json')))}`,
        )
      return record(join(transactionRoot, 'ready.json'))
    })
    if (mode === 'cancel') {
      await writeFile(join(transactionRoot, 'cancel.json'), JSON.stringify({ nonce }), {
        mode: 0o600,
      })
      await waitFor(() => install.exitCode !== null)
      assert.equal(install.exitCode, 5)
      assert.equal(
        (await oldUi.page.evaluate(() => window.cclinkStudio.update.getSnapshot())).currentVersion,
        '0.1.103',
      )
      await oldUi.page.evaluate(() => window.cclinkStudio.window.requestClose()).catch(() => {})
      await oldUi.browser.close()
      console.log(
        'PASS parent stays running until explicit normal shutdown; cancellation leaves it intact',
      )
      continue
    }
    await writeFile(join(transactionRoot, 'commit.json'), JSON.stringify({ nonce }), {
      mode: 0o600,
    })
    await oldUi.page.evaluate(() => window.cclinkStudio.window.requestClose()).catch(() => {})
    await oldUi.browser.close()
    const launched =
      mode === 'permission-denied'
        ? null
        : await waitFor(() => record(join(transactionRoot, 'launched.json')))
    if (mode === 'success') {
      const newUi = await connect(launched.pid)
      assert.equal(
        (await newUi.page.evaluate(() => window.cclinkStudio.update.getSnapshot())).currentVersion,
        '0.1.104',
      )
      // Published baseline predates built-in startup receipts. This observer verifies the actual UI.
      await writeFile(
        join(transactionRoot, 'started.json'),
        JSON.stringify({ nonce, version: '0.1.104', pid: launched.pid }),
        { mode: 0o600 },
      )
      assert.equal(
        (await waitFor(() => record(join(transactionRoot, 'result.json')))).status,
        'succeeded',
      )
      await newUi.page.evaluate(() => window.cclinkStudio.window.requestClose()).catch(() => {})
      await newUi.browser.close()
      console.log('PASS signed 0.1.103 → 0.1.104 atomic swap and real UI startup')
    } else {
      if (mode === 'worker-crash') {
        const worker = await record(join(transactionRoot, 'worker.json'))
        process.kill(worker.pid, 'SIGTERM')
      }
      assert.equal(
        (await waitFor(() => record(join(transactionRoot, 'result.json')), 180000)).status,
        mode === 'permission-denied' ? 'failed' : 'rolled_back',
      )
      if (mode === 'permission-denied') await chmod(testRoot, 0o700)
      const version = execFileSync(
        '/usr/bin/plutil',
        [
          '-extract',
          'CFBundleShortVersionString',
          'raw',
          '-o',
          '-',
          join(targetPath, 'Contents/Info.plist'),
        ],
        { encoding: 'utf8' },
      ).trim()
      assert.equal(version, '0.1.103')
      const restored = await waitFor(() => record(join(transactionRoot, 'restored.json')))
      const oldRestoredUi = await connect(restored.pid)
      assert.equal(
        (await oldRestoredUi.page.evaluate(() => window.cclinkStudio.update.getSnapshot()))
          .currentVersion,
        '0.1.103',
      )
      await oldRestoredUi.page
        .evaluate(() => window.cclinkStudio.window.requestClose())
        .catch(() => {})
      await oldRestoredUi.browser.close()
      console.log(`PASS ${mode}: old signed App restored and actual old UI reopened`)
    }
  }
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  const { spawnSync } = await import('node:child_process')
  const processes = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout
  for (const line of processes.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/)
    if (match && fixturePaths.some((path) => match[2].startsWith(`${path}/Contents/MacOS/`))) {
      try {
        process.kill(Number(match[1]), 'SIGTERM')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  }
  for (const mount of mounted.reverse())
    execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'ignore' })
}
