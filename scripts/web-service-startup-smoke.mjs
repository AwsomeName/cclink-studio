#!/usr/bin/env node
// Uses the built Studio and real state files in an isolated profile. No live accounts or model calls.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const rootDir = resolve(import.meta.dirname, '..')
const fixture = await mkdtemp(join(homedir(), '.cclink-web-startup-smoke-'))
const evidence = await mkdtemp(join(tmpdir(), 'cclink-web-startup-evidence-'))
const profile = join(fixture, 'profile')
const workspace = join(fixture, 'workspace')
const resourcePath = join(profile, 'web-resources', 'web-resources.json')
const affairPath = join(profile, 'web-affairs', 'web-affairs.json')
const resources = {
  schemaVersion: 3,
  revision: 0,
  websites: [],
  principals: [],
  accounts: [],
  accountGroups: [],
}
const affairs = { schemaVersion: 9, revision: 0, affairs: [] }
const corrupt = '{invalid-state token=smoke-secret /Users/private/example'
const results = []
let app
let page
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8')
  response.end(
    '<!doctype html><title>Local browsing still works</title><p>Isolated browser fixture</p>',
  )
})

async function launch() {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [rootDir],
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
      CLAUDE_CONFIG_DIR: join(fixture, 'claude-config'),
    },
    timeout: 30_000,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15_000)
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  await page.waitForFunction(async (path) => {
    try {
      await window.cclinkStudio.webResources.getSnapshot({ workspaceRef: { kind: 'local', path } })
      await window.cclinkStudio.webAffairs.getSnapshot({ workspaceRef: { kind: 'local', path } })
      return true
    } catch {
      return false
    }
  }, workspace)
}

async function close() {
  if (app) await app.close()
  app = null
}

async function getResults() {
  return page.evaluate(async (path) => {
    const scope = { workspaceRef: { kind: 'local', path } }
    return {
      resources: await window.cclinkStudio.webResources.getSnapshot(scope),
      affairs: await window.cclinkStudio.webAffairs.getSnapshot(scope),
      file: await window.cclinkStudio.fs.readFile(`${path}/smoke.md`),
    }
  }, workspace)
}

async function checkNotice(label, failure, screenshot) {
  await page.getByRole('button', { name: label, exact: true }).click()
  const notice = page.locator('.web-service-startup-notice')
  await notice.waitFor()
  const message = await notice.innerText()
  assert.match(message, /启动失败/)
  assert.match(message, /重新启动|再重新启动/)
  assert.doesNotMatch(message, /smoke-secret|\/Users\/private/)
  // Exercise the real copy button without replacing the developer's system clipboard.
  await page.evaluate(() => {
    window.__startupSmokeCopied = null
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.__startupSmokeCopied = value
        },
      },
    })
  })
  await notice.getByRole('button', { name: '复制启动诊断' }).click()
  await notice.getByRole('status').getByText('诊断已复制', { exact: true }).waitFor()
  const copied = await page.evaluate(() => window.__startupSmokeCopied)
  assert.deepEqual(JSON.parse(copied), failure)
  assert.doesNotMatch(copied, /smoke-secret|\/Users\//)
  await notice.screenshot({ path: join(evidence, screenshot) })
}

function pass(name) {
  results.push({ name, status: 'pass' })
  console.log(`PASS ${name}`)
}

try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  await Promise.all(
    [workspace, join(profile, 'web-resources'), join(profile, 'web-affairs')].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  )
  await writeFile(join(workspace, 'smoke.md'), '# Local workspace remains available\n')
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({
      lastWorkspacePath: workspace,
      recentWorkspacePaths: [workspace],
      componentSetupPageSeenVersion: 2,
    }),
  )
  for (const path of [resourcePath, affairPath]) {
    await writeFile(path, corrupt)
    await writeFile(`${path}.bak`, corrupt)
  }
  await launch()
  const failed = await getResults()
  for (const [name, result] of [
    ['web-resources', failed.resources],
    ['web-affairs', failed.affairs],
  ]) {
    assert.equal(result.success, false)
    assert.equal(result.error.code, 'SERVICE_UNAVAILABLE')
    assert.equal(result.error.startupFailure.service, name)
    assert.equal(result.error.startupFailure.code, 'STATE_INVALID')
    assert.equal(result.error.startupFailure.stage, 'read-state')
  }
  assert.match(failed.file.content, /Local workspace remains available/)
  await page.getByRole('button', { name: '浏览器', exact: true }).click()
  await page.getByRole('button', { name: '在当前项目新建浏览器', exact: true }).click()
  await page.locator('.browser-new-tab').waitFor()
  const urlInput = page.getByPlaceholder('输入 URL...')
  await urlInput.fill(`http://127.0.0.1:${server.address().port}/`)
  await urlInput.press('Enter')
  await page.waitForFunction(async () => {
    const tabId = await window.cclinkStudio.browser.getActiveViewId()
    if (!tabId) return false
    const diagnostics = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
    return diagnostics.visibleTitle === 'Local browsing still works'
  })
  pass('Ordinary browser loads a real local page while account storage is unavailable')
  await checkNotice('网站与账号', failed.resources.error.startupFailure, 'resources-corrupt.png')
  await checkNotice('事务', failed.affairs.error.startupFailure, 'affairs-corrupt.png')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('clipboard blocked')
        },
      },
    })
  })
  await page.getByRole('button', { name: '复制启动诊断' }).click()
  await page.getByRole('status').getByText('复制失败，请展开诊断后手动复制').waitFor()
  await page.getByText('查看启动诊断', { exact: true }).click()
  assert.match(await page.locator('.web-service-startup-notice pre').innerText(), /STATE_INVALID/)
  pass(
    'Both failed domains remain inspectable, copy is bounded, clipboard failure has a manual fallback, local file access survives',
  )
  await close()
  for (const path of [resourcePath, affairPath]) {
    assert.equal(await readFile(path, 'utf8'), corrupt)
    assert.equal(await readFile(`${path}.bak`, 'utf8'), corrupt)
  }
  pass('Corrupt originals and backups are preserved')

  await writeFile(resourcePath, JSON.stringify(resources))
  await writeFile(affairPath, JSON.stringify(affairs))
  await launch()
  const restored = await getResults()
  assert.equal(restored.resources.success, true)
  assert.equal(restored.affairs.success, true)
  await page.getByRole('button', { name: '网站与账号', exact: true }).click()
  assert.equal(await page.locator('.web-service-startup-notice').count(), 0)
  await page.getByRole('button', { name: '事务', exact: true }).click()
  await page.locator('.web-affairs-empty').waitFor()
  assert.equal(await page.locator('.web-service-startup-notice').count(), 0)
  pass('Repair and restart restore both domains without stale failure notices')
  await close()

  await chmod(resourcePath, 0)
  await writeFile(`${affairPath}.recovery`, corrupt)
  await launch()
  const blocked = await getResults()
  assert.equal(blocked.resources.error.startupFailure.code, 'STORAGE_PERMISSION_DENIED')
  assert.equal(blocked.affairs.error.startupFailure.stage, 'recover-runtime')
  await checkNotice(
    '网站与账号',
    blocked.resources.error.startupFailure,
    'resources-permission.png',
  )
  await checkNotice('事务', blocked.affairs.error.startupFailure, 'affairs-recovery.png')
  pass('Real read permission failure differs from corrupt execution recovery')
  await close()
  await chmod(resourcePath, 0o600)
  assert.equal(await readFile(`${affairPath}.recovery`, 'utf8'), corrupt)
  await rm(`${affairPath}.recovery`)

  await writeFile(resourcePath, corrupt)
  await writeFile(`${resourcePath}.bak`, JSON.stringify(resources))
  await launch()
  const backup = await getResults()
  assert.equal(backup.resources.success, true)
  assert.equal(backup.affairs.success, true)
  assert.deepEqual(JSON.parse(await readFile(resourcePath, 'utf8')), resources)
  pass('A valid backup still recovers automatically')
} finally {
  await close()
  await new Promise((done) => server.close(done))
  await chmod(resourcePath, 0o600).catch(() => {})
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ results }, null, 2))
  await rm(fixture, { recursive: true, force: true })
  console.log(`Evidence: ${evidence}`)
}
