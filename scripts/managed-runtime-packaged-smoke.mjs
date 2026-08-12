#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { chromium } from 'playwright-core'

const execFileAsync = promisify(execFile)
const projectRoot = resolve(import.meta.dirname, '..')
const sourceApp = resolve(
  process.env.CCLINK_STUDIO_PACKAGED_APP_PATH ??
    join(projectRoot, 'dist/mac-arm64/CCLink Studio 开源版.app'),
)
const runRoot = await mkdtemp(join(tmpdir(), 'cclink-managed-packaged-smoke-'))
const installRoot = join(runRoot, 'Applications')
const installedApp = join(installRoot, basename(sourceApp))
const userDataPath = join(runRoot, 'user-data')
const screenshotPath = join(runRoot, 'managed-runtime-packaged-reuse.png')
const installRecordPath = join(
  userDataPath,
  'runtime-components',
  'claude-runtime',
  'darwin-arm64',
  '2.1.211',
  'install-record.json',
)
const resourceInstallRecords = {
  'OCCT Runtime': join(
    userDataPath,
    'runtime-components',
    'occt-runtime',
    '0.0.23',
    'install-record.json',
  ),
  'Android scrcpy server': join(
    userDataPath,
    'runtime-components',
    'scrcpy-server',
    '2.3.1',
    'install-record.json',
  ),
  'agent-device Android Helper': join(
    userDataPath,
    'runtime-components',
    'agent-device-android-helpers',
    '0.17.2',
    'install-record.json',
  ),
}
const stepFixturePath = join(
  projectRoot,
  'node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.stp',
)
let activeApp = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function cloneApp() {
  await rm(installedApp, { recursive: true, force: true })
  await execFileAsync('/bin/cp', ['-cR', sourceApp, installedApp], {
    timeout: 5 * 60 * 1000,
    maxBuffer: 1024 * 1024,
  })
}

async function waitForFile(path, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await stat(path)
      return
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`等待文件超时：${path}`)
}

async function startPackagedApp(label) {
  const portFile = join(userDataPath, 'DevToolsActivePort')
  await rm(portFile, { force: true })
  const logPath = join(runRoot, `${label}.log`)
  const log = await open(logPath, 'w', 0o600)
  const executable = join(installedApp, 'Contents', 'MacOS', 'CCLink Studio 开源版')
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      CCLINK_STUDIO_PACKAGED_SMOKE: '1',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: userDataPath,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', log.fd, log.fd],
  })
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  activeApp = { child, exited, log, logPath }

  try {
    await Promise.race([
      waitForFile(portFile, 30_000),
      exited.then(async (code) => {
        throw new Error(
          `packaged App 提前退出 (${code})：${await readFile(logPath, 'utf8').catch(() => '')}`,
        )
      }),
    ])
    const [port] = (await readFile(portFile, 'utf8')).trim().split('\n')
    assert(/^\d+$/.test(port), `无效 CDP 端口：${port}`)
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = await findWorkbenchPage(browser)
    return { browser, page }
  } catch (error) {
    await stopPackagedApp()
    throw error
  }
}

async function findWorkbenchPage(browser) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      if ((await page.locator('.main-window').count()) > 0) return page
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('packaged App 没有出现工作台窗口')
}

async function stopPackagedApp(browser) {
  if (browser) await browser.close().catch(() => undefined)
  if (!activeApp) return
  const current = activeApp
  activeApp = null
  if (current.child.exitCode === null) current.child.kill('SIGTERM')
  await Promise.race([
    current.exited,
    new Promise((resolveWait) => setTimeout(resolveWait, 10_000)),
  ])
  if (current.child.exitCode === null) current.child.kill('SIGKILL')
  await current.log.close().catch(() => undefined)
}

async function openClaudeRow(page) {
  if ((await page.locator('.settings-page').count()) === 0) {
    await page.locator('.activity-bar-icon[title="设置"]').click()
    await page.waitForSelector('.settings-page', { timeout: 10_000 })
  }
  await page.locator('.settings-nav-item', { hasText: '组件管理' }).click()
  await page.waitForSelector('.component-table', { timeout: 10_000 })
  const row = page.locator('.component-table tbody tr', { hasText: 'Claude Code Runtime' })
  assert((await row.count()) === 1, 'Claude Runtime 清单行不唯一')
  return row
}

async function componentRow(page, name) {
  const row = page.locator('.component-table tbody tr', { hasText: name })
  assert((await row.count()) === 1, `${name} 清单行不唯一`)
  return row
}

async function installRuntimeResource(page, name, expectedState) {
  const row = await componentRow(page, name)
  const button = row.getByRole('button', { name: '安装' })
  assert(await button.isEnabled(), `${name} 安装按钮不可用`)
  await button.click()
  await page.waitForFunction(
    ({ rowName, state }) => {
      const target = Array.from(document.querySelectorAll('.component-table tbody tr')).find(
        (candidate) => candidate.textContent?.includes(rowName),
      )
      return target?.textContent?.includes(state) ?? false
    },
    { rowName: name, state: expectedState },
    { timeout: 10 * 60 * 1000 },
  )
  assert(!(await button.isEnabled()), `${name} 安装后仍允许重复安装`)
}

async function verifyRuntimeResource(page, name, expectedState, version) {
  await page.waitForFunction(
    ({ rowName, state }) => {
      const target = Array.from(document.querySelectorAll('.component-table tbody tr')).find(
        (candidate) => candidate.textContent?.includes(rowName),
      )
      return target?.textContent?.includes(state) ?? false
    },
    { rowName: name, state: expectedState },
    { timeout: 60_000 },
  )
  const row = await componentRow(page, name)
  const cells = await row.locator('td').allTextContents()
  assert(
    cells.some((value) => value.includes(`版本 ${version}`)),
    `${name} 版本丢失`,
  )
  assert(!(await row.getByRole('button', { name: '安装' }).isEnabled()), `${name} 错误要求重装`)
}

async function waitForManagedRuntimeActive(page, timeoutMs = 60_000) {
  const startedAt = Date.now()
  let lastStatus = null
  while (Date.now() - startedAt < timeoutMs) {
    lastStatus = await page.evaluate(() => window.cclinkStudio.settings.getClaudeRuntimeStatus())
    if (lastStatus.success && lastStatus.status?.active?.source === 'managed') return lastStatus
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`等待 managed Runtime 激活超时：${JSON.stringify(lastStatus)}`)
}

async function main() {
  assert(process.platform === 'darwin' && process.arch === 'arm64', '仅支持 macOS arm64 验收')
  await stat(sourceApp)
  await mkdir(installRoot, { recursive: true })
  await cloneApp()

  const first = await startPackagedApp('app-a')
  const firstRow = await openClaudeRow(first.page)
  const firstCells = await firstRow.locator('td').allTextContents()
  assert(
    firstCells.some((value) => value.includes('仅 2.1.211')),
    'App A 未显示限定版本',
  )
  const installButton = firstRow.getByRole('button', { name: '安装' })
  assert(await installButton.isEnabled(), 'App A 安装按钮不可用')
  await installButton.click()
  await first.page.waitForFunction(
    () => {
      const row = Array.from(document.querySelectorAll('.component-table tbody tr')).find(
        (candidate) => candidate.textContent?.includes('Claude Code Runtime'),
      )
      const failed = Array.from(document.querySelectorAll('.settings-description')).some(
        (candidate) => candidate.textContent?.includes('DOWNLOAD_FAILED'),
      )
      return (row?.textContent?.includes('已安装 · Studio 管理') ?? false) || failed
    },
    undefined,
    { timeout: 10 * 60 * 1000 },
  )
  const installStatus = await first.page.evaluate(() =>
    window.cclinkStudio.runtimeComponents.getManagedClaudeStatus(),
  )
  assert(
    installStatus.phase === 'installed',
    `App A managed Runtime 安装失败：${JSON.stringify(installStatus.failure)}`,
  )
  await installRuntimeResource(first.page, 'OCCT Runtime', '已安装 · Studio 管理')
  await installRuntimeResource(first.page, 'Android scrcpy server', '已安装 · Studio 管理')
  await installRuntimeResource(first.page, 'agent-device Android Helper', '已下载 · 待宿主支持')
  const managedCad = await first.page.evaluate(async (inputPath) => {
    await window.cclinkStudio.settings.set({ cadBackend: 'occt-experimental' })
    return {
      status: await window.cclinkStudio.cad.getBackendStatus(),
      conversion: await window.cclinkStudio.cad.convertModel({
        inputPath,
        targetFormat: 'stl',
        force: true,
      }),
    }
  }, stepFixturePath)
  assert(
    managedCad.status.available && managedCad.status.source === 'managed',
    `packaged App 未使用受管 OCCT：${JSON.stringify(managedCad.status)}`,
  )
  assert(
    managedCad.conversion.success && managedCad.conversion.metadata?.generator.includes('managed'),
    `packaged App 受管 OCCT 转换失败：${JSON.stringify(managedCad.conversion)}`,
  )
  const persistedConfig = await first.page.evaluate(async () => {
    const secretResult = await window.cclinkStudio.settings.setSecret(
      'apiKey',
      'packaged-smoke-placeholder-not-a-real-key',
    )
    const settingsResult = await window.cclinkStudio.settings.set({
      modelName: 'claude-sonnet-4-6',
      permissionMode: 'strict',
      claudeRuntimeSource: 'managed',
      claudeManagedVersion: '2.1.211',
    })
    const connectionResult = await window.cclinkStudio.settings.testClaudeModelConnection({
      source: 'managed',
      version: '2.1.211',
    })
    return { settingsResult, secretResult, connectionResult }
  })
  assert(persistedConfig.settingsResult.success, 'App A 测试配置写入失败')
  assert(persistedConfig.secretResult.success, 'App A 测试凭证写入失败')
  assert(
    persistedConfig.connectionResult.success &&
      !persistedConfig.connectionResult.result?.success &&
      persistedConfig.connectionResult.result?.code === 'AUTHENTICATION_FAILED',
    `managed SDK 协议链路没有返回预期认证失败：${JSON.stringify(persistedConfig.connectionResult)}`,
  )
  const originalRecord = await readFile(installRecordPath, 'utf8')
  const originalResourceRecords = Object.fromEntries(
    await Promise.all(
      Object.entries(resourceInstallRecords).map(async ([name, path]) => [
        name,
        await readFile(path, 'utf8'),
      ]),
    ),
  )
  await stopPackagedApp(first.browser)

  // Simulate the macOS update flow: the process is closed and the whole .app is replaced.
  await cloneApp()
  const second = await startPackagedApp('app-b')
  const secondRow = await openClaudeRow(second.page)
  await second.page.waitForFunction(
    () => {
      const row = Array.from(document.querySelectorAll('.component-table tbody tr')).find(
        (candidate) => candidate.textContent?.includes('Claude Code Runtime'),
      )
      return row?.textContent?.includes('已安装 · Studio 管理') ?? false
    },
    undefined,
    { timeout: 60_000 },
  )
  const secondCells = await secondRow.locator('td').allTextContents()
  assert(
    secondCells.some((value) => value.includes('已安装 · Studio 管理')),
    '替换 .app 后 managed Runtime 安装状态丢失',
  )
  assert(
    secondCells.some((value) => value.includes('版本 2.1.211')),
    '替换 .app 后 managed Runtime 版本丢失',
  )
  assert(
    !(await secondRow.getByRole('button', { name: '安装' }).isEnabled()),
    '替换后错误地要求重装',
  )
  assert((await readFile(installRecordPath, 'utf8')) === originalRecord, '替换后安装记录被改写')
  await verifyRuntimeResource(second.page, 'OCCT Runtime', '已安装 · Studio 管理', '0.0.23')
  await verifyRuntimeResource(second.page, 'Android scrcpy server', '已安装 · Studio 管理', '2.3.1')
  await verifyRuntimeResource(
    second.page,
    'agent-device Android Helper',
    '已下载 · 待宿主支持',
    '0.17.2',
  )
  for (const [name, path] of Object.entries(resourceInstallRecords)) {
    assert(
      (await readFile(path, 'utf8')) === originalResourceRecords[name],
      `替换后 ${name} 安装记录被改写`,
    )
  }
  const replacementState = await second.page.evaluate(async () => ({
    settings: await window.cclinkStudio.settings.getAll(),
    secretStatus: await window.cclinkStudio.settings.getSecretStatus(),
  }))
  assert(
    replacementState.settings.modelName === 'claude-sonnet-4-6' &&
      replacementState.settings.permissionMode === 'strict' &&
      replacementState.settings.claudeRuntimeSource === 'managed' &&
      replacementState.settings.claudeManagedVersion === '2.1.211',
    '替换 .app 后用户配置丢失',
  )
  assert(replacementState.secretStatus.apiKeyConfigured, '替换 .app 后本地凭证丢失')
  const replacementRuntime = await waitForManagedRuntimeActive(second.page)
  assert(
    replacementRuntime.success && replacementRuntime.status?.active?.source === 'managed',
    `替换 .app 后 managed Runtime 未恢复为 active：${JSON.stringify(replacementRuntime)}`,
  )
  await second.page.screenshot({ path: screenshotPath, fullPage: true })
  await second.page.evaluate(() => window.cclinkStudio.settings.clearSecret('apiKey'))
  await stopPackagedApp(second.browser)

  process.stdout.write(
    `${JSON.stringify(
      {
        success: true,
        packagedAppReplacement: true,
        reusedWithoutDownload: true,
        settingsPreserved: true,
        credentialPreserved: true,
        managedProtocolStarted: true,
        expectedAuthFailureClassified: true,
        installedVersion: '2.1.211',
        runtimeResourcesReused: ['OCCT 0.0.23', 'scrcpy 2.3.1', 'agent-device Helper 0.17.2'],
        managedOcctConversion: true,
        isolatedUserData: userDataPath,
        screenshotPath,
      },
      null,
      2,
    )}\n`,
  )
}

main().catch(async (error) => {
  await stopPackagedApp()
  console.error(error)
  process.exitCode = 1
})
