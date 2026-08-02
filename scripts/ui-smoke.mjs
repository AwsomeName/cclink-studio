#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const keepRunning = process.argv.includes('--keep-running')
const uiReadyTimeoutMs = 30_000
const results = []
let startedBySmoke = false

function pass(name, detail = '') {
  results.push({ name, status: 'pass', detail })
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`)
}

function fail(name, error) {
  results.push({ name, status: 'fail', detail: error.message || String(error) })
  console.error(`FAIL ${name} - ${error.message || String(error)}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(timeoutMs = 30_000, previousLog = '') {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const completeLog = await readLog()
    const log =
      previousLog && completeLog.startsWith(previousLog)
        ? completeLog.slice(previousLog.length)
        : completeLog
    const portMatch =
      log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//) ||
      log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)
    if (portMatch) return portMatch[1]
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`CDP port not found in ${logFile}`)
}

async function findRendererPage(browser) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    const page = pages.find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Renderer page ${rendererOrigin}/ not found`)
}

async function runCheck(name, fn) {
  try {
    const detail = await fn()
    pass(name, detail)
  } catch (error) {
    fail(name, error)
  }
}

async function clickByTitle(page, title) {
  await page.locator(`[title="${title}"]`).first().click()
}

async function createTabFromMenu(page, label) {
  await page.locator('.tab-new-button').first().click()
  const menu = page.locator('.tab-create-menu')
  await menu.waitFor({ timeout: 10_000 })
  await menu.locator('button', { hasText: label }).first().click()
}

async function main() {
  const initialLog = await readLog()
  runRestart('restart')
  startedBySmoke = true

  const cdpPort = await waitForCdpPort(30_000, initialLog)
  let browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  let page = await findRendererPage(browser)
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })

  await runCheck('main renderer enforces its CSP source boundary', async () => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().resourceType() === 'document' &&
        response.url().startsWith(`${rendererOrigin}/`),
      { timeout: uiReadyTimeoutMs },
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await responsePromise
    await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })
    const probe = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const script = document.createElement('script')
          script.src = 'data:text/javascript,window.__cclinkCspProbeLoaded=true'
          script.onload = () => resolve({ loaded: true })
          script.onerror = () => resolve({ loaded: false })
          document.head.append(script)
          setTimeout(() => resolve({ loaded: Boolean(window.__cclinkCspProbeLoaded) }), 1_000)
        }),
    )
    assert(!probe.loaded, 'CSP allowed a data: script outside script-src')
    return 'blocked disallowed data script'
  })

  await runCheck('first screen has no login wall', async () => {
    await page.locator('.app-topbar').waitFor({ state: 'visible', timeout: uiReadyTimeoutMs })
    const primarySurface = page.locator('.workbench, .agent-panel-center-shell')
    await primarySurface.waitFor({ state: 'visible', timeout: uiReadyTimeoutMs })
    const text = await page.locator('body').innerText()
    assert(await page.locator('.main-window').isVisible(), 'main window is not visible')
    assert(
      !(await page.locator('.runtime-unavailable').count()),
      'runtime unavailable screen visible',
    )
    assert(await page.locator('.app-topbar').isVisible(), 'topbar is not visible')
    assert((await primarySurface.count()) === 1, 'expected exactly one primary work surface')
    assert(
      await primarySurface.isVisible(),
      'workbench or empty-session agent surface is not visible',
    )
    assert(!text.includes('登录 CCLink'), 'login copy should not block the shell')
    return 'main window ready'
  })

  await runCheck('activity bar switches local panels', async () => {
    await clickByTitle(page, '浏览器')
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === '浏览器',
      'browser panel missing',
    )
    await clickByTitle(page, 'Terminal')
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === 'Terminal',
      'terminal panel missing',
    )
    await clickByTitle(page, '文件')
    await page.waitForTimeout(200)
    const filesState = page
      .locator(
        '.project-files-empty, .project-files-section .file-tree-shell, .project-files-section .file-tree-loading, .project-files-section .file-tree-empty, .project-files-section > .project-panel-empty',
      )
      .first()
    await filesState.waitFor({ state: 'visible', timeout: 10_000 })
    return 'browser/terminal/files'
  })

  await runCheck('role center separates viewing a role from applying it', async () => {
    await clickByTitle(page, '角色')
    await page.locator('.agent-role-sidebar').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === '角色',
      'role sidebar title missing',
    )
    const roleRows = page.locator('.agent-role-row')
    await roleRows.first().waitFor({ state: 'visible', timeout: 10_000 })
    assert((await roleRows.count()) === 7, 'expected seven built-in roles')

    const appliedRow = page.locator('.agent-role-row.applied')
    assert((await appliedRow.count()) === 1, 'expected exactly one applied role')
    const appliedLabel = await appliedRow.locator('strong').innerText()
    const candidateRow = page.locator('.agent-role-row:not(.applied)').first()
    await candidateRow.click()
    await page.locator('.agent-role-detail').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      await page.getByRole('button', { name: '应用到当前会话' }).isEnabled(),
      'role apply action is not available',
    )
    assert(
      (await page.locator('.agent-role-row.applied strong').innerText()) === appliedLabel,
      'opening a role detail changed the conversation configuration',
    )
    assert(
      await page.getByRole('button', { name: '设为新会话默认' }).isVisible(),
      'new-conversation default action missing',
    )
    return 'seven roles, current receipt card, read-only detail, and explicit apply actions'
  })

  await runCheck('web resources accepts a non-predefined website', async () => {
    await clickByTitle(page, '网站与账号')
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === '网站与账号',
      'web resources panel missing',
    )

    const accountLabel = 'UI Smoke Account'
    const primaryProfile = 'web-affairs-ui-smoke'
    const primaryRow = () => page.locator(`.web-resource-row[title$="Profile: ${primaryProfile}"]`)
    const existing = primaryRow()
    if ((await existing.count()) === 0) {
      await page.getByRole('button', { name: '添加网站' }).click()
      const form = page.locator('.web-resources-form')
      await form.waitFor({ state: 'visible', timeout: 10_000 })
      await form.getByLabel('网站名称').fill('Web Affairs Smoke')
      await form.getByLabel('办理入口').fill('https://example.com/cclink-web-affairs-smoke')
      await form.getByPlaceholder('姓名或公司全称').fill('CCLink Smoke Company')
      await form.getByLabel('账号名称').fill(accountLabel)
      await form.getByLabel('Browser Profile').fill(primaryProfile)
      await form.getByRole('button', { name: '保存并建立连接' }).click()
    }

    await primaryRow().waitFor({ state: 'visible', timeout: 10_000 })
    const rowText = await primaryRow().innerText()
    assert(rowText.includes('CCLink Smoke Company'), 'principal is not visible')
    assert(rowText.includes('web-affairs-ui-smoke'), 'Browser Profile is not visible')

    const secondaryAccountLabel = 'UI Smoke Account Secondary'
    const secondaryProfile = 'web-affairs-ui-smoke-secondary'
    const secondaryRow = () =>
      page.locator(`.web-resource-row[title$="Profile: ${secondaryProfile}"]`)
    if ((await secondaryRow().count()) === 0) {
      await page.getByRole('button', { name: '添加网站' }).click()
      const form = page.locator('.web-resources-form')
      await form.waitFor({ state: 'visible', timeout: 10_000 })
      await form.getByLabel('网站名称').fill('Web Affairs Smoke')
      await form.getByLabel('办理入口').fill('https://example.com/cclink-web-affairs-smoke')
      await form.getByPlaceholder('姓名或公司全称').fill('CCLink Smoke Company')
      await form.getByLabel('账号名称').fill(secondaryAccountLabel)
      await form.getByLabel('Browser Profile').fill(secondaryProfile)
      await form.getByRole('button', { name: '保存并建立连接' }).click()
    }

    await primaryRow().waitFor({ state: 'visible', timeout: 10_000 })
    await secondaryRow().waitFor({ state: 'visible', timeout: 10_000 })
    await primaryRow().click()
    await page.locator('.web-resource-detail').waitFor({ state: 'visible', timeout: 10_000 })
    const detailText = await page.locator('.web-resource-detail').innerText()
    assert(detailText.includes('CCLink Smoke Company'), 'resource detail principal is missing')
    assert(detailText.includes('web-affairs-ui-smoke'), 'resource detail Profile is missing')
    assert(detailText.includes('Session Partition'), 'resource session diagnostics are missing')
    await page.waitForFunction(() => {
      const field = Array.from(document.querySelectorAll('.web-resource-detail-field')).find(
        (node) => node.querySelector('span')?.textContent === 'Session Partition',
      )
      return field?.querySelector('strong')?.textContent !== '待核验'
    })
    const firstPartition = await page
      .locator('.web-resource-detail-field', { hasText: 'Session Partition' })
      .locator('strong')
      .innerText()

    await secondaryRow().click()
    await page
      .locator('.web-resource-detail-header', { hasText: secondaryAccountLabel })
      .waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(() => {
      const field = Array.from(document.querySelectorAll('.web-resource-detail-field')).find(
        (node) => node.querySelector('span')?.textContent === 'Session Partition',
      )
      return field?.querySelector('strong')?.textContent !== '待核验'
    })
    const secondaryPartition = await page
      .locator('.web-resource-detail-field', { hasText: 'Session Partition' })
      .locator('strong')
      .innerText()
    assert(firstPartition !== secondaryPartition, 'two Browser Profiles share one partition')

    await browser.close()
    const resourceRestartLog = await readLog()
    runRestart('restart')
    const restartedCdpPort = await waitForCdpPort(30_000, resourceRestartLog)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${restartedCdpPort}`)
    page = await findRendererPage(browser)
    await page.setViewportSize({ width: 1440, height: 920 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })
    if ((await page.locator('.sidebar-header-title', { hasText: '网站与账号' }).count()) === 0) {
      await page
        .locator('[title="网站与账号"]')
        .first()
        .evaluate((element) => element.click())
    }
    await primaryRow().waitFor({ state: 'visible', timeout: 10_000 })
    await secondaryRow().waitFor({ state: 'visible', timeout: 10_000 })
    return 'app restart persistence and two Profile partitions verified'
  })

  await runCheck('web affair persists a five-node workflow and node progress', async () => {
    await clickByTitle(page, '事务')
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === '事务',
      'web affairs panel missing',
    )

    const affairTitle = 'UI Smoke Web Affair'
    const affairRow = () => page.locator('.web-affair-row', { hasText: affairTitle })
    if ((await affairRow().count()) === 0) {
      await page.getByRole('button', { name: '新建事务' }).click()
      const form = page.locator('.web-affairs-form')
      await form.waitFor({ state: 'visible', timeout: 10_000 })
      await form.getByLabel('事务名称').fill(affairTitle)
      await form.getByLabel('最终目标').fill('验证事务列表、流程、节点详情和重启恢复')
      await form.getByLabel('代表的业务主体').selectOption({ label: 'CCLink Smoke Company' })
      const account = form.locator('.web-affairs-account-choice', { hasText: 'UI Smoke Account' })
      if ((await account.count()) > 0) await account.first().locator('input').check()
      await form.getByRole('button', { name: '创建事务' }).click()
    } else {
      await affairRow().click()
    }

    await page.locator('.web-affair-tab').waitFor({ state: 'visible', timeout: 10_000 })
    const tabText = await page.locator('.web-affair-tab').innerText()
    assert(tabText.includes('相关资源'), 'affair resources section missing')
    assert(tabText.includes('整体流程'), 'affair flow section missing')
    assert(tabText.includes('节点办理情况'), 'affair node detail section missing')
    assert((await page.locator('.web-affair-flow-step').count()) === 5, 'expected five flow nodes')

    const firstNode = page.locator('.web-affair-flow-step button').first()
    const secondNode = page.locator('.web-affair-flow-step button').nth(1)
    if (!(await firstNode.evaluate((element) => element.classList.contains('completed')))) {
      await firstNode.click()
      await page.getByLabel('更新办理状态').selectOption('completed')
      await page.getByLabel(/结果或卡点说明/).fill('UI smoke 已核对第一节点')
      await page.getByRole('button', { name: '保存节点进度' }).click()
      await page.waitForFunction(() =>
        document.querySelector('.web-affair-flow-step button')?.classList.contains('completed'),
      )
    }
    assert(
      await secondNode.evaluate((element) => element.classList.contains('ready')),
      'completing the first node did not unlock the second node',
    )

    await browser.close()
    const affairRestartLog = await readLog()
    runRestart('restart')
    const restartedCdpPort = await waitForCdpPort(30_000, affairRestartLog)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${restartedCdpPort}`)
    page = await findRendererPage(browser)
    await page.setViewportSize({ width: 1440, height: 920 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('.main-window', { timeout: uiReadyTimeoutMs })
    await page.locator('.web-affair-tab', { hasText: affairTitle }).waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    if ((await page.locator('.sidebar-header-title', { hasText: '事务' }).count()) === 0) {
      await page
        .locator('[title="事务"]')
        .first()
        .evaluate((element) => element.click())
    }
    await affairRow().waitFor({ state: 'visible', timeout: 10_000 })
    return 'five-node affair, progress transition, and app restart persistence verified'
  })

  await runCheck(
    'web affair exposes A2-A4 handoff, wait, template, and flow-diff controls',
    async () => {
      const affairSidebarTitle = page.locator('.sidebar-header-title', { hasText: '事务' })
      if (
        (await affairSidebarTitle.count()) === 0 ||
        !(await affairSidebarTitle.first().isVisible())
      ) {
        await clickByTitle(page, '事务')
      }
      const affairTitle = 'UI Smoke Agent Affair'
      const affairRow = () => page.locator('.web-affair-row', { hasText: affairTitle })
      if ((await affairRow().count()) === 0) {
        await page.getByRole('button', { name: '新建事务' }).evaluate((element) => element.click())
        const form = page.locator('.web-affairs-form')
        await form.getByLabel('事务名称').fill(affairTitle)
        await form.getByLabel('最终目标').fill('验证 AI 交接、外部等待、模板和动态流程入口')
        await form.getByLabel('代表的业务主体').selectOption({ label: 'CCLink Smoke Company' })
        const account = form.locator('.web-affairs-account-choice', { hasText: 'UI Smoke Account' })
        await account.first().locator('input').check()
        await form.getByLabel('业务模板（可选）').selectOption('generic-web-affair@1')
        await form.getByRole('button', { name: '创建事务' }).click()
      } else {
        await affairRow().click()
      }

      await page.locator('.web-affair-tab', { hasText: affairTitle }).waitFor({ timeout: 10_000 })
      assert(
        (await page.locator('.web-affair-flow-step').count()) === 6,
        'template did not create six nodes',
      )

      await page.evaluate(async (title) => {
        const snapshot = await window.cclinkStudio.webAffairs.getSnapshot()
        if (!snapshot.success) throw new Error(snapshot.error.message)
        let affair = snapshot.data.affairs.find((item) => item.title === title)
        if (!affair) throw new Error('smoke affair missing')
        for (const node of affair.flow.nodes.slice(0, 2)) {
          if (node.status === 'completed') continue
          const updated = await window.cclinkStudio.webAffairs.updateNode({
            affairId: affair.id,
            nodeId: node.id,
            status: 'completed',
            resultNote: `Smoke 已完成 ${node.title}`,
          })
          if (!updated.success) throw new Error(updated.error.message)
          affair = updated.data
        }
      }, affairTitle)

      const webFormNode = page.locator('.web-affair-flow-step button.ready', {
        has: page.locator('strong', { hasText: '填写网页表单' }),
      })
      await webFormNode.waitFor({ timeout: 10_000 })
      await webFormNode.click()
      await page.getByRole('button', { name: '交给 AI' }).click()
      const preflight = page.locator('.web-affair-confirm-card', { hasText: '执行前账号核验' })
      await preflight.waitFor({ timeout: 10_000 })
      assert(
        (await preflight.innerText()).includes('web-affairs-ui-smoke'),
        'preflight Profile missing',
      )
      await preflight.getByRole('button', { name: '取消' }).click()

      await page
        .locator('.web-affair-flow-step button', {
          has: page.locator('strong', { hasText: '等待外部审核' }),
        })
        .click()
      await page.getByText('外部等待与重新检查', { exact: true }).waitFor({ timeout: 10_000 })
      assert(
        await page.getByText('最终确认卡固定展示', { exact: true }).isVisible(),
        'final confirmation card missing',
      )

      await page.getByRole('button', { name: '编辑未执行流程' }).click()
      assert(
        (await page.locator('.web-affair-flow-editor-row').count()) === 6,
        'flow editor missing nodes',
      )
      await page
        .locator('.web-affair-flow-editor-actions')
        .getByRole('button', { name: '取消' })
        .click()

      await page.evaluate(async (title) => {
        const snapshot = await window.cclinkStudio.webAffairs.getSnapshot()
        if (!snapshot.success) throw new Error(snapshot.error.message)
        const affair = snapshot.data.affairs.find((item) => item.title === title)
        if (!affair) throw new Error('smoke affair missing')
        const result = await window.cclinkStudio.webAffairs.proposeFlowDiff({
          affairId: affair.id,
          baseVersion: affair.flow.version,
          reason: 'Smoke 页面要求补充一次身份核验',
          operations: [
            {
              kind: 'add-node',
              tempId: 'smoke-extra-check',
              title: '补充身份核验',
              nodeType: 'human-task',
              executor: 'user',
            },
            {
              kind: 'add-edge',
              fromNodeId: affair.flow.nodes[0].id,
              toNodeId: 'smoke-extra-check',
            },
          ],
          impacts: ['新增人工核验步骤'],
          proposedBy: 'ai',
        })
        if (!result.success) throw new Error(result.error.message)
      }, affairTitle)
      const proposal = page.locator('.web-affair-proposals', {
        hasText: 'Smoke 页面要求补充一次身份核验',
      })
      await proposal.waitFor({ timeout: 10_000 })
      await proposal.getByRole('button', { name: '拒绝' }).click()
      await proposal.waitFor({ state: 'detached', timeout: 10_000 })
      return 'A2 preflight, A3 wait, A4 template/editor/proposal controls verified'
    },
  )

  await runCheck('settings page opens and searches locally', async () => {
    await clickByTitle(page, '设置')
    await page.waitForSelector('.settings-page', { timeout: 10_000 })
    assert(
      await page.getByRole('heading', { name: '设置' }).isVisible(),
      'settings heading missing',
    )
    await page.locator('.settings-search input').fill('agent')
    await page.waitForTimeout(200)
    const agentSearchResult = page.locator('.settings-search-result', { hasText: 'Agent 后端' })
    assert(await agentSearchResult.isVisible(), 'settings search result missing')
    await agentSearchResult.click()
    await page.waitForTimeout(200)
    assert(
      await page.getByRole('heading', { name: 'Agent' }).isVisible(),
      'agent settings section missing',
    )
    return 'settings search'
  })

  await runCheck('tab create menu opens editor, browser, and terminal tabs', async () => {
    const initialEditorCount = await page.locator('.tab-title', { hasText: '未命名.md' }).count()
    await createTabFromMenu(page, 'Markdown 草稿')
    await page.waitForFunction(
      (count) =>
        Array.from(document.querySelectorAll('.tab-title')).filter((node) =>
          node.textContent?.includes('未命名.md'),
        ).length > count,
      initialEditorCount,
      { timeout: 10_000 },
    )
    assert(await page.locator('.markdown-editor-wrapper').count(), 'markdown editor did not open')

    const initialBrowserCount = await page.locator('.tab-title', { hasText: '浏览器' }).count()
    await page.locator('.tab-new-browser-button').click()
    await page.waitForFunction(
      (count) =>
        Array.from(document.querySelectorAll('.tab-title')).filter((node) =>
          node.textContent?.includes('浏览器'),
        ).length > count,
      initialBrowserCount,
      { timeout: 10_000 },
    )

    const initialTerminalCount = await page.locator('.tab-title', { hasText: 'Terminal' }).count()
    await createTabFromMenu(page, 'Terminal')
    await page.waitForFunction(
      (count) =>
        Array.from(document.querySelectorAll('.tab-title')).filter((node) =>
          node.textContent?.includes('Terminal'),
        ).length > count,
      initialTerminalCount,
      { timeout: 10_000 },
    )
    return 'editor/browser/terminal'
  })

  await runCheck('no paid or account UI appears during smoke', async () => {
    const text = await page.locator('body').innerText()
    const blockedCopy = ['登录 CCLink', '订阅', '配额', `Remote ${'Workspace'}`]
    assert(
      blockedCopy.every((item) => !text.includes(item)),
      'paid/account copy leaked into UI',
    )
    return 'clean UI boundary'
  })

  await browser.close()

  const failed = results.filter((result) => result.status === 'fail')
  if (startedBySmoke && !keepRunning) runRestart('stop')
  if (failed.length > 0) {
    console.error(`\nUI smoke failed: ${failed.length}/${results.length}`)
    process.exit(1)
  }
  console.log(`\nUI smoke passed: ${results.length}/${results.length}`)
}

main().catch((error) => {
  if (startedBySmoke && !keepRunning) {
    try {
      runRestart('stop')
    } catch {
      // best effort cleanup
    }
  }
  console.error(error)
  process.exit(1)
})
