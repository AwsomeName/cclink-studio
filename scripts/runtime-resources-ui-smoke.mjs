#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { runDir, logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const userDataPath = join(runDir, 'user-data')
const screenshotPath = join(runDir, 'runtime-resources-installed.png')
const stepFixturePath = join(
  process.cwd(),
  'node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.stp',
)
let started = false

async function waitForCdpPort(timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const log = await readFile(logFile, 'utf8').catch(() => '')
    const matches = [...log.matchAll(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//g)]
    const match = matches.at(-1)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('没有找到开发版 CDP 端口')
}

async function connectRenderer() {
  const port = await waitForCdpPort()
  let browser = null
  const connectStartedAt = Date.now()
  while (!browser && Date.now() - connectStartedAt < 20_000) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  if (!browser) throw new Error(`无法连接开发版 CDP 端口 ${port}`)
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (page) {
      await page.setViewportSize({ width: 1440, height: 920 })
      await page.waitForSelector('.main-window', { timeout: 20_000 })
      return { browser, page }
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('没有找到 CCLink Studio renderer')
}

async function openComponents(page) {
  if ((await page.locator('.settings-page').count()) === 0) {
    await page.locator('.activity-bar-icon[title="设置"]').click()
  }
  await page.waitForSelector('.settings-page', { timeout: 10_000 })
  await page.locator('.settings-nav-item', { hasText: '组件管理' }).click()
  await page.waitForSelector('.component-table', { timeout: 10_000 })
}

async function rowFor(page, name) {
  const row = page.locator('.component-table tbody tr', { hasText: name })
  if ((await row.count()) !== 1) throw new Error(`${name} 清单行不唯一`)
  return row
}

async function installRow(page, name, expectedLabel) {
  const row = await rowFor(page, name)
  const before = await row.locator('td').allTextContents()
  const button = row.getByRole('button', { name: '安装' })
  if (!before.some((value) => value.includes(expectedLabel))) {
    if (!(await button.isEnabled())) throw new Error(`${name} 安装按钮不可用`)
    await button.click()
    await page.waitForFunction(
      ({ rowName, label }) => {
        const target = Array.from(document.querySelectorAll('.component-table tbody tr')).find(
          (candidate) => candidate.textContent?.includes(rowName),
        )
        return target?.textContent?.includes(label) ?? false
      },
      { rowName: name, label: expectedLabel },
      { timeout: 10 * 60 * 1000 },
    )
  }
  const after = await row.locator('td').allTextContents()
  if (!after.some((value) => value.includes(expectedLabel))) {
    throw new Error(`${name} 安装状态错误: ${JSON.stringify(after)}`)
  }
  if (await button.isEnabled()) throw new Error(`${name} 安装后仍允许重复安装`)
  return after
}

async function verifyInstalledRows(page) {
  const expectations = [
    ['OCCT Runtime', '已安装 · Studio 管理', '版本 0.0.23'],
    ['Android scrcpy server', '已安装 · Studio 管理', '版本 2.3.1'],
    ['agent-device Android Helper', '已下载 · 待宿主支持', '版本 0.17.2'],
  ]
  for (const [name, state, version] of expectations) {
    await page.waitForFunction(
      ({ rowName, expectedState }) => {
        const target = Array.from(document.querySelectorAll('.component-table tbody tr')).find(
          (candidate) => candidate.textContent?.includes(rowName),
        )
        return target?.textContent?.includes(expectedState) ?? false
      },
      { rowName: name, expectedState: state },
      { timeout: 15_000 },
    )
    const values = await (await rowFor(page, name)).locator('td').allTextContents()
    if (!values.some((value) => value.includes(state))) {
      throw new Error(`${name} 状态丢失: ${JSON.stringify(values)}`)
    }
    if (!values.some((value) => value.includes(version))) {
      throw new Error(`${name} 版本丢失: ${JSON.stringify(values)}`)
    }
  }
}

async function main() {
  try {
    try {
      runRestart('stop')
    } catch {
      // 没有旧进程也可以继续。
    }
    await rm(userDataPath, { recursive: true, force: true })
    await rm(logFile, { force: true })
    runRestart('start')
    started = true

    const first = await connectRenderer()
    await first.page.waitForSelector('.settings-page', { timeout: 15_000 })
    await openComponents(first.page)
    const occt = await installRow(first.page, 'OCCT Runtime', '已安装 · Studio 管理')
    const scrcpy = await installRow(first.page, 'Android scrcpy server', '已安装 · Studio 管理')
    const helpers = await installRow(
      first.page,
      'agent-device Android Helper',
      '已下载 · 待宿主支持',
    )
    await first.page.evaluate(() =>
      window.cclinkStudio.settings.set({ cadBackend: 'occt-experimental' }),
    )
    const cadStatus = await first.page.evaluate(() => window.cclinkStudio.cad.getBackendStatus())
    if (!cadStatus.available || cadStatus.source !== 'managed' || cadStatus.version !== '0.0.23') {
      throw new Error(`OCCT 没有切换到受管资源: ${JSON.stringify(cadStatus)}`)
    }
    const cadConversion = await first.page.evaluate(
      (inputPath) =>
        window.cclinkStudio.cad.convertModel({ inputPath, targetFormat: 'stl', force: true }),
      stepFixturePath,
    )
    if (!cadConversion.success || !cadConversion.metadata?.generator.includes('managed')) {
      throw new Error(`受管 OCCT 真实 STEP 转换失败: ${JSON.stringify(cadConversion)}`)
    }
    await first.page.screenshot({ path: screenshotPath, fullPage: true })
    await first.browser.close()

    runRestart('restart')
    const replacement = await connectRenderer()
    await openComponents(replacement.page)
    await verifyInstalledRows(replacement.page)
    await replacement.browser.close()

    process.stdout.write(
      `${JSON.stringify(
        {
          success: true,
          firstInstallOpenedComponents: true,
          appReplacementReuse: true,
          occt,
          scrcpy,
          helpers,
          cadStatus,
          cadConversion: {
            success: cadConversion.success,
            generator: cadConversion.metadata.generator,
            bounds: cadConversion.metadata.bounds,
          },
          screenshotPath,
        },
        null,
        2,
      )}\n`,
    )
  } finally {
    if (started) {
      try {
        runRestart('stop')
      } catch {
        // best effort
      }
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
