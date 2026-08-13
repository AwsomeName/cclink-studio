#!/usr/bin/env node
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { runDir, logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const userDataPath = join(runDir, 'user-data')
const screenshotPath = join(runDir, 'managed-runtime-installed.png')
const reuseUserData = process.argv.includes('--reuse-user-data')
let started = false

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const log = await readLog()
    const matches = [...log.matchAll(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//g)]
    const match = matches.at(-1)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('没有找到开发版 CDP 端口')
}

async function connectRenderer() {
  const port = await waitForCdpPort()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
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
  await browser.close()
  throw new Error('没有找到 CCLink Studio renderer')
}

async function openComponents(page) {
  if ((await page.locator('.settings-page').count()) === 0) {
    await page.locator('.activity-bar-icon[title="设置"]').click()
    await page.waitForSelector('.settings-page', { timeout: 10_000 })
  }
  const componentsNav = page.locator('.settings-nav-item', { hasText: '组件管理' })
  if ((await componentsNav.count()) !== 1) throw new Error('组件管理导航不唯一')
  await componentsNav.click()
  await page.waitForSelector('.component-table', { timeout: 10_000 })
  const row = page.locator('.component-table tbody tr', { hasText: 'Claude Code Runtime' })
  if ((await row.count()) !== 1) throw new Error('Claude Runtime 清单行不唯一')
  return row
}

function assertIncludes(values, expected, message) {
  if (!values.some((value) => value.includes(expected))) {
    throw new Error(`${message}: ${JSON.stringify(values)}`)
  }
}

async function main() {
  try {
    try {
      runRestart('stop')
    } catch {
      // 没有旧进程也可以继续。
    }
    if (!reuseUserData) await rm(userDataPath, { recursive: true, force: true })
    await rm(logFile, { force: true })
    runRestart('start')
    started = true

    const first = await connectRenderer()
    if (!reuseUserData) {
      await first.page.waitForSelector('.settings-page', { timeout: 15_000 })
    }
    const firstRow = await openComponents(first.page)
    const before = await firstRow.locator('td').allTextContents()
    if (
      !before.some(
        (value) =>
          value.includes('未安装') ||
          value.includes('已安装 · system') ||
          value.includes('已安装 · Studio 管理'),
      )
    ) {
      throw new Error(`首次安装状态不明确: ${JSON.stringify(before)}`)
    }
    assertIncludes(before, '仅 2.1.211', '没有显示限定版本')
    assertIncludes(before, '2.1.211', '没有显示可用版本')
    const installButton = firstRow.getByRole('button', { name: '安装' })
    if (!before.some((value) => value.includes('已安装 · Studio 管理'))) {
      if (!(await installButton.isEnabled())) throw new Error('Claude Runtime 安装按钮不可用')
      await installButton.click()
      await first.page.waitForFunction(
        () => {
          const row = Array.from(document.querySelectorAll('.component-table tbody tr')).find(
            (candidate) => candidate.textContent?.includes('Claude Code Runtime'),
          )
          return row?.textContent?.includes('已安装 · Studio 管理') ?? false
        },
        undefined,
        { timeout: 10 * 60 * 1000 },
      )
    }
    const afterInstall = await firstRow.locator('td').allTextContents()
    assertIncludes(afterInstall, '已安装 · Studio 管理', '安装完成状态没有更新')
    assertIncludes(afterInstall, '版本 2.1.211', '安装版本没有更新')
    if ((await firstRow.getByRole('button', { name: '安装' }).count()) !== 0) {
      throw new Error('已安装版本仍显示安装按钮')
    }
    for (const action of ['检查', '修复', '卸载']) {
      if (!(await firstRow.getByRole('button', { name: action, exact: true }).isEnabled())) {
        throw new Error(`Claude Runtime ${action}按钮不可用`)
      }
    }
    await firstRow.getByRole('button', { name: '检查', exact: true }).click()
    await first.page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.settings-description')).some((candidate) =>
          candidate.textContent?.includes('当前可信目录没有更新'),
        ),
      undefined,
      { timeout: 30_000 },
    )
    await first.page.screenshot({ path: screenshotPath, fullPage: true })
    await first.browser.close()

    runRestart('restart')
    const replacement = await connectRenderer()
    const replacementRow = await openComponents(replacement.page)
    const afterReplacement = await replacementRow.locator('td').allTextContents()
    assertIncludes(afterReplacement, '已安装 · Studio 管理', '替换 App 后安装状态丢失')
    assertIncludes(afterReplacement, '版本 2.1.211', '替换 App 后版本信息丢失')
    replacement.page.once('dialog', (dialog) => dialog.accept())
    await replacementRow.getByRole('button', { name: '卸载', exact: true }).click()
    await replacement.page.waitForFunction(
      () => {
        const row = Array.from(document.querySelectorAll('.component-table tbody tr')).find(
          (candidate) => candidate.textContent?.includes('Claude Code Runtime'),
        )
        return Boolean(row?.textContent?.includes('未安装') && row.textContent.includes('安装'))
      },
      undefined,
      { timeout: 30_000 },
    )
    await replacement.browser.close()

    process.stdout.write(
      `${JSON.stringify(
        {
          success: true,
          firstRunOpenedComponents: !reuseUserData,
          installedVersion: '2.1.211',
          appReplacementReuse: true,
          updateCheck: 'no trusted update',
          uninstall: true,
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
