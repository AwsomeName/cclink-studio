#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

process.env.CCLINK_STUDIO_UPDATE_CURRENT_VERSION = '1.0.0'

const { logFile, rendererOrigin, runDir, runRestart } = createSmokeRuntime(import.meta.url)
const userDataPath = join(runDir, 'user-data')
const cacheRoot = join(userDataPath, 'updates')
const releaseDirectory = join(cacheRoot, '1.2.3-arm64-smoke')
const assetName = 'cclink-studio-1.2.3-arm64.dmg'
const assetContent = Buffer.from('CCLink Studio verified update recovery smoke')
const assetSha256 = createHash('sha256').update(assetContent).digest('hex')
const manifest = {
  schemaVersion: 2,
  channel: 'stable',
  tag: 'v1.2.3',
  version: '1.2.3',
  sourceSha: 'a'.repeat(40),
  minimumSystemVersion: '13.0',
  assets: {
    arm64: {
      dmg: { name: assetName, size: assetContent.length, sha256: assetSha256 },
      zip: {
        name: 'cclink-studio-1.2.3-arm64.zip',
        size: assetContent.length,
        sha256: assetSha256,
      },
    },
  },
}

async function main() {
  await rm(userDataPath, { recursive: true, force: true })
  await mkdir(releaseDirectory, { recursive: true })
  await writeFile(join(releaseDirectory, assetName), assetContent, { mode: 0o600 })
  await writeFile(
    join(releaseDirectory, 'verified.json'),
    `${JSON.stringify(
      {
        schemaVersion: 3,
        manifest,
        manifestDigest: digestManifest(manifest),
        architecture: 'arm64',
        publishedAt: '2026-07-29T00:00:00.000Z',
        releaseNotes: 'Update recovery smoke fixture',
        prerelease: false,
        asset: { name: assetName, size: assetContent.length, sha256: assetSha256 },
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )

  const initialLog = await readFile(logFile, 'utf8').catch(() => '')
  runRestart('restart')
  const cdpPort = await waitForCdpPort(30_000, initialLog)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  try {
    const page = await findRendererPage(browser)
    await page.waitForSelector('.main-window', { timeout: 30_000 })
    const updateButton = page.locator('[title="检查和下载 CCLink Studio 更新"]')
    await updateButton.waitFor({ state: 'visible', timeout: 10_000 })
    const label = await updateButton.innerText()
    assert(label.includes('更新已下载'), `expected restored update status, received: ${label}`)
    await updateButton.click()
    await page
      .getByText('更新已下载并通过校验', { exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page
      .getByRole('button', { name: '打开安装包', exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.main-window', { timeout: 30_000 })
    const restoredAfterReload = await page
      .locator('[title="检查和下载 CCLink Studio 更新"]')
      .innerText()
    assert(
      restoredAfterReload.includes('更新已下载'),
      `renderer reload lost update state: ${restoredAfterReload}`,
    )
    console.log('PASS update cache restores into the real Studio UI - readyToInstall')
  } finally {
    await browser.close()
    runRestart('stop')
    await rm(userDataPath, { recursive: true, force: true })
  }
}

function digestManifest(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function waitForCdpPort(timeoutMs = 30_000, previousLog = '') {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const completeLog = await readFile(logFile, 'utf8').catch(() => '')
    const log =
      previousLog && completeLog.startsWith(previousLog)
        ? completeLog.slice(previousLog.length)
        : completeLog
    const match =
      log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//) ||
      log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`CDP port not found in ${logFile}`)
}

async function findRendererPage(browser) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Renderer page ${rendererOrigin}/ not found`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

main().catch(async (error) => {
  try {
    runRestart('stop')
  } catch {
    // Best effort process cleanup.
  }
  await rm(userDataPath, { recursive: true, force: true }).catch(() => undefined)
  console.error(`FAIL update cache recovery smoke - ${error.message || String(error)}`)
  process.exit(1)
})
