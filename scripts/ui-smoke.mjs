#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { rootDir, logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const keepRunning = process.argv.includes('--keep-running')
const agentPanelOnly = process.argv.includes('--agent-panel-only')
const uiReadyTimeoutMs = 30_000
const results = []
let startedBySmoke = false
const execFileAsync = promisify(execFile)

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

async function waitForCdpPort(timeoutMs = 45_000, previousLog = '') {
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

async function runGit(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' })
}

async function main() {
  const initialLog = await readLog()
  runRestart('restart')
  startedBySmoke = true

  const cdpPort = await waitForCdpPort(45_000, initialLog)
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

  await runCheck('local and remote use one Agent Panel and IME-safe Composer', async () => {
    const panelToggle = page.locator('.app-topbar-right .app-topbar-icon')
    if ((await panelToggle.getAttribute('title')) === '展开 Agent 面板') {
      await panelToggle.click()
    }

    const originalWorkspace = await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const state = useWorkspaceStore.getState()
      useWorkspaceStore.setState({
        activeWorkspaceRef: { kind: 'global' },
        generation: state.generation + 1,
      })
      return { ref: state.activeWorkspaceRef, generation: state.generation }
    })

    const panelProjection = async (runtime) =>
      page.locator(`[data-agent-panel-runtime="${runtime}"]`).evaluate((panel) => {
        const box = (selector) => {
          const rect = panel.querySelector(selector)?.getBoundingClientRect()
          const root = panel.getBoundingClientRect()
          return rect
            ? {
                x: Math.round(rect.x - root.x),
                y: Math.round(rect.y - root.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              }
            : null
        }
        return {
          rootWidth: Math.round(panel.getBoundingClientRect().width),
          landmarks: [...panel.querySelectorAll('[data-agent-landmark]')].map((element) =>
            element.getAttribute('data-agent-landmark'),
          ),
          actions: [...panel.querySelectorAll('[data-agent-action]')].map((element) =>
            element.getAttribute('data-agent-action'),
          ),
          boxes: {
            header: box('[data-agent-landmark="header"]'),
            context: box('[data-agent-landmark="context"]'),
            timeline: box('[data-agent-landmark="timeline"]'),
            composer: box('.agent-input-card'),
            actionBar: box('[data-agent-landmark="action-bar"]'),
            primaryAction: box('[data-agent-action="send"], [data-agent-action="stop"]'),
            addContextAction: box('[data-agent-action="addContext"]'),
            roleAction: box('[data-agent-action="role"]'),
            permissionAction: box('[data-agent-action="permissionMode"]'),
            contextUsageAction: box('[data-agent-action="contextUsage"]'),
            runtimeAction: box('[data-agent-action="runtime"]'),
          },
        }
      })
    const assertEquivalentPanel = (local, remote, variant) => {
      assert(
        JSON.stringify(local.landmarks) === JSON.stringify(remote.landmarks),
        `${variant} local/remote landmark order differs`,
      )
      assert(
        JSON.stringify(local.actions) === JSON.stringify(remote.actions),
        `${variant} local/remote action order differs`,
      )
      for (const key of ['header', 'context', 'composer', 'actionBar', 'primaryAction']) {
        const left = local.boxes[key]
        const right = remote.boxes[key]
        assert(left && right, `${variant} ${key} bounding box missing`)
        for (const metric of ['height']) {
          assert(
            Math.abs(left[metric] - right[metric]) <= 1,
            `${variant} ${key}.${metric} differs (${left[metric]} vs ${right[metric]})`,
          )
        }
        const leftPosition =
          key === 'primaryAction' ? local.rootWidth - left.x - left.width : left.x
        const rightPosition =
          key === 'primaryAction' ? remote.rootWidth - right.x - right.width : right.x
        assert(
          Math.abs(leftPosition - rightPosition) <= 1,
          `${variant} ${key} position/inset differs (${leftPosition} vs ${rightPosition})`,
        )
        const leftWidth = key === 'primaryAction' ? left.width : local.rootWidth - left.width
        const rightWidth = key === 'primaryAction' ? right.width : remote.rootWidth - right.width
        assert(
          Math.abs(leftWidth - rightWidth) <= 1,
          `${variant} ${key} width/inset differs (${leftWidth} vs ${rightWidth})`,
        )
      }
      for (const key of [
        'addContextAction',
        'roleAction',
        'permissionAction',
        'contextUsageAction',
        'runtimeAction',
      ]) {
        const left = local.boxes[key]
        const right = remote.boxes[key]
        assert(left && right, `${variant} ${key} bounding box missing`)
        assert(
          Math.abs(left.height - right.height) <= 1,
          `${variant} ${key}.height differs (${left.height} vs ${right.height})`,
        )
      }
      assert(
        remote.boxes.addContextAction.width === remote.boxes.addContextAction.height,
        `${variant} remote add-context action is not a square icon button`,
      )
    }

    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      useUIStore.getState().setAgentPanelMode('right', 'user')
    })
    const localPanel = page.locator('[data-agent-panel-runtime="local"]')
    await localPanel.waitFor({ state: 'visible', timeout: 10_000 })
    assert((await page.locator('.agent-panel').count()) === 1, 'expected one Agent Panel root')
    const localComposer = localPanel.locator('textarea.agent-input, textarea.agent-start-input')
    await localComposer.waitFor({ state: 'visible', timeout: 10_000 })
    assert((await localComposer.count()) === 1, 'local runtime rendered more than one Composer')
    await localComposer.fill('输入法候选')
    await localComposer.dispatchEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      isComposing: true,
      bubbles: true,
    })
    await page.waitForTimeout(100)
    assert(
      (await localComposer.inputValue()) === '输入法候选',
      'IME candidate confirmation submitted or cleared the local draft',
    )
    await localComposer.fill('/')
    const skillCandidates = page.locator('.agent-skill-menu [role="option"]')
    await skillCandidates.first().waitFor({ state: 'visible', timeout: 10_000 })
    await localComposer.press('Shift+Enter')
    assert(
      (await localComposer.inputValue()) === '/\n',
      'Shift+Enter selected a candidate instead of inserting a newline',
    )
    await localComposer.fill('')
    const localSideProjection = await panelProjection('local')

    await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const state = useWorkspaceStore.getState()
      useWorkspaceStore.setState({
        activeWorkspaceRef: {
          kind: 'remote',
          transport: 'cclink',
          endpointId: 'ui-smoke-endpoint',
          endpointName: 'UI Smoke',
          workspaceId: 'ui-smoke-workspace',
          path: '/ui-smoke-workspace',
        },
        generation: state.generation + 1,
      })
    })
    const remotePanel = page.locator('[data-agent-panel-runtime="remote"]')
    await remotePanel.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await page.locator('.agent-panel').count()) === 1,
      'remote runtime duplicated Panel roots',
    )
    assert(
      (await remotePanel.locator('textarea.agent-input').count()) === 1,
      'remote runtime did not reuse AgentComposer',
    )
    assert(
      (await page.locator('.remote-agent-panel, .remote-agent-composer').count()) === 0,
      'legacy remote Panel or Composer is still rendered',
    )
    const remoteSideProjection = await panelProjection('remote')
    assertEquivalentPanel(localSideProjection, remoteSideProjection, 'side')

    if (!agentPanelOnly) {
      await page.evaluate(async (snapshot) => {
        const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
        const state = useWorkspaceStore.getState()
        useWorkspaceStore.setState({
          activeWorkspaceRef: snapshot.ref,
          generation: Math.max(state.generation + 1, snapshot.generation + 1),
        })
      }, originalWorkspace)
      return 'single fixed side view, equivalent landmarks and boxes, IME-safe Enter, and Shift+Enter'
    }

    // center 是无 Workbench Tab 的首次会话 surface；先回到本地并清空 smoke Tab 投影。
    await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const state = useWorkspaceStore.getState()
      useWorkspaceStore.setState({
        activeWorkspaceRef: { kind: 'global' },
        generation: state.generation + 1,
      })
    })
    await page.locator('[data-agent-panel-runtime="local"]').waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    await page.waitForTimeout(1_000)
    await page.evaluate(async () => {
      const { useUIStore } = await import('/src/stores/ui-store.ts')
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      useTabStore.setState({ tabs: [], activeTabId: null })
      useUIStore.setState({
        agentPanelMode: 'center',
        agentPanelLastVisibleMode: 'center',
        agentPanelVisible: true,
        agentPanelModeSource: 'user',
        sidebarVisible: false,
        sidebarWidth: 250,
      })
    })
    await page.waitForTimeout(200)
    const localCenterPanel = page.locator(
      '[data-agent-panel-runtime="local"][data-agent-panel-variant="center"]',
    )
    assert(
      (await localCenterPanel.count()) === 1 && (await localCenterPanel.isVisible()),
      'local center Agent Panel is missing',
    )
    const localCenterProjection = await panelProjection('local')

    await page.evaluate(async () => {
      const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
      const state = useWorkspaceStore.getState()
      useWorkspaceStore.setState({
        activeWorkspaceRef: {
          kind: 'remote',
          transport: 'cclink',
          endpointId: 'ui-smoke-endpoint',
          endpointName: 'UI Smoke',
          workspaceId: 'ui-smoke-workspace',
          path: '/ui-smoke-workspace',
        },
        generation: state.generation + 1,
      })
    })
    const remoteCenterPanel = page.locator(
      '[data-agent-panel-runtime="remote"][data-agent-panel-variant="center"]',
    )
    await remoteCenterPanel.waitFor({ state: 'visible', timeout: 10_000 })
    const remoteCenterProjection = await panelProjection('remote')
    assertEquivalentPanel(localCenterProjection, remoteCenterProjection, 'center')

    return 'single fixed side/center view, equivalent landmarks and boxes, IME-safe Enter, and Shift+Enter'
  })

  if (agentPanelOnly) {
    await browser.close()
    const failed = results.filter((result) => result.status === 'fail')
    if (startedBySmoke && !keepRunning) runRestart('stop')
    if (failed.length > 0) {
      console.error(`\nAgent Panel UI smoke failed: ${failed.length}/${results.length}`)
      process.exit(1)
    }
    console.log(`\nAgent Panel UI smoke passed: ${results.length}/${results.length}`)
    return
  }

  await runCheck('workspace opener unifies local and CCLink remote entry', async () => {
    await clickByTitle(page, '打开工作空间')
    const opener = page.locator('.workspace-open-surface')
    await opener.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      await opener.getByRole('button', { name: /本地文件夹/ }).isVisible(),
      'local workspace source is missing',
    )
    assert(
      await opener.getByRole('button', { name: /CCLink 远程/ }).isVisible(),
      'CCLink remote source is missing',
    )

    await opener.getByRole('button', { name: /CCLink 远程/ }).click()
    await opener
      .locator('.cclink-login-card, .cclink-server-panel, .cclink-panel-state')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
    assert(await page.locator('.main-window').isVisible(), 'remote source replaced the local shell')

    await opener.getByRole('button', { name: '返回来源选择' }).click()
    await opener.getByRole('button', { name: /本地文件夹/ }).waitFor({ state: 'visible' })
    await opener.getByRole('button', { name: '关闭打开工作空间' }).click()
    await opener.waitFor({ state: 'hidden' })
    return 'shared source chooser and scoped remote step'
  })

  await runCheck('CCLink login is scoped to the remote entry and fails soft', async () => {
    await clickByTitle(page, 'CCLink 远程')
    const service = await page.evaluate(() => window.cclinkStudio.auth.getServiceStatus())
    if (service.configured) {
      await page
        .locator('.cclink-login-card, .cclink-server-panel')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
    } else {
      await page
        .locator('.cclink-panel-state', { hasText: '远程服务未配置' })
        .waitFor({ state: 'visible', timeout: 10_000 })
    }
    assert(await page.locator('.main-window').isVisible(), 'remote entry replaced the local shell')
    assert(await page.locator('.app-topbar').isVisible(), 'remote entry hid the local topbar')
    await clickByTitle(page, '文件')
    return service.configured ? 'remote-only login surface' : 'unconfigured degradation surface'
  })

  await runCheck('topbar switches the current project conversation and reopens Agent', async () => {
    const switcher = page.locator('.conversation-quick-switcher')
    await switcher.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await page.locator('.status-bar-conversation-switcher').count()) === 0,
      'legacy conversation switcher is still rendered in the status bar',
    )
    assert(
      (await switcher.evaluate((element) => getComputedStyle(element).webkitAppRegion)) ===
        'no-drag',
      'conversation controls are still part of the window drag region',
    )

    const panelToggle = page.locator('.app-topbar-right .app-topbar-icon')
    if ((await panelToggle.getAttribute('title')) === '收起 Agent 面板') {
      await panelToggle.click()
      await page.waitForFunction(
        () => document.querySelector('.conversation-quick-switcher')?.classList.contains('compact'),
        undefined,
        { timeout: 10_000 },
      )
    }

    await page.locator('.conversation-quick-tab').first().click()
    await page.waitForFunction(
      () =>
        document.querySelector('.conversation-quick-switcher')?.classList.contains('compact') ===
        false,
      undefined,
      { timeout: 10_000 },
    )
    const widths = await page.evaluate(() => ({
      panel: document.querySelector('.agent-side-shell')?.getBoundingClientRect().width ?? 0,
      topbar: document.querySelector('.app-topbar-right')?.getBoundingClientRect().width ?? 0,
    }))
    assert(widths.panel > 0, 'conversation switch did not reopen the Agent panel')
    assert(
      Math.abs(widths.panel - widths.topbar) < 1,
      `topbar switcher width is not aligned with Agent panel (${widths.topbar} vs ${widths.panel})`,
    )

    const quickTab = page.locator('.conversation-quick-tab').first()
    await quickTab.click({ button: 'right' })
    const contextMenu = page.locator('.unified-context-menu')
    await contextMenu.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      await contextMenu.getByRole('menuitem', { name: '重命名' }).isVisible(),
      'quick conversation menu is missing rename',
    )
    assert(
      await contextMenu.getByRole('menuitem', { name: '关闭会话' }).isVisible(),
      'quick conversation menu is missing close',
    )
    assert(
      await contextMenu.getByRole('menuitem', { name: '在中间 Tab 打开' }).isVisible(),
      'quick conversation menu is missing Workbench open',
    )
    await page.keyboard.press('Escape')
    await contextMenu.waitFor({ state: 'hidden', timeout: 10_000 })

    const conversationId = await quickTab.getAttribute('data-conversation-id')
    assert(conversationId, 'quick conversation drag identity is missing')
    const beforeDrop = await page.evaluate(async (id) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const agentState = useAgentStore.getState()
      const tabState = useTabStore.getState()
      return {
        activeConversationId: agentState.activeConversationId,
        conversationSurface: agentState.conversations[id]?.surface ?? null,
        existingTabId:
          tabState.tabs.find(
            (tab) => tab.type === 'conversation' && tab.conversation?.sessionId === id,
          )?.id ?? null,
        previousActiveTabId: tabState.activeTabId,
      }
    }, conversationId)

    await quickTab.dragTo(page.locator('.tab-bar'))
    await page.waitForFunction(
      async (id) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const state = useTabStore.getState()
        const active = state.tabs.find((tab) => tab.id === state.activeTabId)
        return active?.type === 'conversation' && active.conversation?.sessionId === id
      },
      conversationId,
      { timeout: 10_000 },
    )
    const afterFirstDrop = await page.evaluate(async (id) => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const agentState = useAgentStore.getState()
      const tabState = useTabStore.getState()
      return {
        activeConversationId: agentState.activeConversationId,
        conversationSurface: agentState.conversations[id]?.surface ?? null,
        conversationTabCount: tabState.tabs.filter(
          (tab) => tab.type === 'conversation' && tab.conversation?.sessionId === id,
        ).length,
        activeTabId: tabState.activeTabId,
      }
    }, conversationId)

    await quickTab.dragTo(page.locator('.tab-bar'))
    const afterSecondDropCount = await page.evaluate(async (id) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      return useTabStore
        .getState()
        .tabs.filter((tab) => tab.type === 'conversation' && tab.conversation?.sessionId === id)
        .length
    }, conversationId)
    assert(
      afterSecondDropCount === afterFirstDrop.conversationTabCount,
      'dropping the same conversation created a duplicate Tab',
    )
    assert(
      afterFirstDrop.activeConversationId === beforeDrop.activeConversationId &&
        afterFirstDrop.conversationSurface === beforeDrop.conversationSurface,
      'dropping the conversation moved or replaced the right-side Thread state',
    )

    await page.evaluate(
      async ({ openedTabId, existingTabId, previousActiveTabId }) => {
        const { useTabStore } = await import('/src/stores/tab-store.ts')
        const tabStore = useTabStore.getState()
        if (!existingTabId && openedTabId) tabStore.closeTab(openedTabId)
        if (
          previousActiveTabId &&
          useTabStore.getState().tabs.some((tab) => tab.id === previousActiveTabId)
        ) {
          useTabStore.getState().activateTab(previousActiveTabId)
        }
      },
      {
        openedTabId: afterFirstDrop.activeTabId,
        existingTabId: beforeDrop.existingTabId,
        previousActiveTabId: beforeDrop.previousActiveTabId,
      },
    )
    return 'topbar switcher, thread menu, drag-open, and Tab deduplication verified'
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
    const roleRows = page.locator('.agent-role-row[data-role-source="builtin"]')
    await roleRows.first().waitFor({ state: 'visible', timeout: 10_000 })
    assert((await roleRows.count()) === 7, 'expected seven built-in roles')
    await page.evaluate(async () => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const state = useAgentStore.getState()
      await state.applyRoleToConversation(
        { roleId: 'default-assistant', version: 1 },
        state.activeConversationId,
      )
    })
    await page
      .locator('.agent-role-row[data-role-source="builtin"].applied')
      .waitFor({ state: 'visible', timeout: 10_000 })

    const appliedRow = page.locator('.agent-role-row.applied')
    assert((await appliedRow.count()) === 1, 'expected exactly one applied role')
    const appliedLabel = await appliedRow.locator('strong').innerText()
    const candidateRow = page.locator('.agent-role-row:not(.applied)').first()
    await candidateRow.click()
    await page.locator('.agent-role-detail').waitFor({ state: 'visible', timeout: 10_000 })
    const roleConfigTabs = page.locator('.tab').filter({ hasText: '角色配置' })
    assert((await roleConfigTabs.count()) === 1, 'expected one global role configuration tab')
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
    for (let index = 0; index < (await roleRows.count()); index += 1) {
      const roleRow = roleRows.nth(index)
      const roleLabel = await roleRow.locator('strong').innerText()
      await roleRow.click()
      await page.locator('[data-role-soul]').waitFor({ state: 'visible', timeout: 10_000 })
      assert(
        await page.getByRole('heading', { name: '人格与原则 · SOUL.md' }).isVisible(),
        `role SOUL preview missing: ${roleLabel}`,
      )
      assert(
        (await page.locator('.agent-role-overview-section li').count()) > 0,
        `role overview content missing: ${roleLabel}`,
      )
      assert(
        (await page.locator('.agent-role-examples-section article').count()) > 0,
        `role examples missing: ${roleLabel}`,
      )
    }

    const challengerRow = roleRows.filter({ hasText: '反方挑战者' })
    await challengerRow.click()
    await page.locator('[data-role-soul]').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      await page.getByRole('heading', { name: '建议 Skills' }).isVisible(),
      'recommended Skills section missing',
    )
    const mountSkillButton = page.getByRole('button', { name: '挂载到当前会话' })
    if ((await mountSkillButton.count()) > 0) {
      await mountSkillButton.click()
    }
    await page.locator('.agent-skill-chip', { hasText: '方案拷问' }).waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    assert(
      await page.getByRole('button', { name: '已挂载' }).isDisabled(),
      'recommended Skill did not become an explicit mounted Skill',
    )
    const mountedSkillRefs = await page.evaluate(async () => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const state = useAgentStore.getState()
      return state.conversations[state.activeConversationId]?.mountedSkills ?? []
    })
    assert(
      JSON.stringify(mountedSkillRefs) === JSON.stringify([{ skillId: 'grill-me', version: 1 }]),
      'mounted Skill was not stored as a versioned reference',
    )
    const nextViewedRow = roleRows.last()
    const nextViewedLabel = await nextViewedRow.locator('strong').innerText()
    await nextViewedRow.click()
    assert(
      (await roleConfigTabs.count()) === 1,
      'switching roles created another configuration tab',
    )
    assert(
      (await page.locator('.agent-role-row.opened strong').innerText()) === nextViewedLabel,
      'singleton role configuration tab did not switch its viewed role',
    )
    assert(
      (await page.locator('.agent-role-row.applied strong').innerText()) === appliedLabel,
      'switching the viewed role changed the conversation configuration',
    )
    assert(
      await page.locator('.agent-skill-chip', { hasText: '方案拷问' }).isVisible(),
      'viewing another role silently removed the mounted Skill',
    )

    const editBuiltinCopyButton = page.getByRole('button', { name: '编辑副本', exact: true })
    assert(await editBuiltinCopyButton.isVisible(), 'built-in role did not expose an edit entry')
    await editBuiltinCopyButton.click()
    await page.locator('[data-role-editor]').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      await page.getByRole('button', { name: '保存为新版本' }).isVisible(),
      'editing a built-in copy did not enter the role editor',
    )

    const customRoleName = `UI Smoke 审稿人 ${Date.now()}`
    const customRoleV2Name = `${customRoleName} v2`
    await page.getByRole('button', { name: '＋ 新建角色' }).click()
    await page.locator('[data-role-editor]').waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByLabel('名称').fill(customRoleName)
    await page.getByLabel('简介').fill('验证本地角色不可变版本与持久化')
    await page.getByLabel('目标（每行一项）').fill('给出可执行的审阅意见')
    await page.getByLabel('行为规则（每行一项）').fill('先区分事实、推断和观点')
    await page.getByRole('button', { name: '创建角色' }).click()
    await page.getByRole('heading', { name: customRoleName, exact: true }).waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    assert(
      await page.locator('.agent-role-row', { hasText: customRoleName }).isVisible(),
      'new local role missing from My Roles',
    )
    await page.getByRole('button', { name: '编辑角色', exact: true }).click()
    await page.getByLabel('名称').fill(customRoleV2Name)
    await page.getByRole('button', { name: '保存为新版本' }).click()
    await page.getByRole('heading', { name: customRoleV2Name, exact: true }).waitFor({
      state: 'visible',
      timeout: 10_000,
    })
    const localVersions = await page.evaluate(async (name) => {
      const roles = await window.cclinkStudio.agent.listRoles()
      const latest = roles.find((role) => role.label === name)
      return latest ? roles.filter((role) => role.roleId === latest.roleId) : []
    }, customRoleV2Name)
    assert(localVersions.length === 2, 'editing a local role overwrote its previous version')
    assert(
      localVersions.some((role) => role.version === 1 && !role.isLatest) &&
        localVersions.some((role) => role.version === 2 && role.isLatest),
      'local role versions do not expose immutable latest/history state',
    )
    await page.getByRole('button', { name: '在新会话试用' }).click()
    const trialRoleRef = await page.evaluate(async () => {
      const { useAgentStore } = await import('/src/stores/agent-store.ts')
      const state = useAgentStore.getState()
      return state.conversations[state.activeConversationId]?.configuration.roleRef
    })
    assert(
      trialRoleRef?.roleId === localVersions[1].roleId && trialRoleRef?.version === 2,
      'trial conversation did not pin the selected custom role version',
    )
    await page.getByRole('button', { name: '归档', exact: true }).click()
    await page.waitForFunction(
      () => document.querySelector('.agent-role-detail-eyebrow')?.textContent?.includes('已归档'),
      undefined,
      { timeout: 10_000 },
    )
    assert(
      (await page.locator('.agent-role-detail-eyebrow').innerText()).includes('已归档'),
      'archiving a role did not update the visible role state',
    )
    assert(
      (
        await page.evaluate(async () => {
          const { useAgentStore } = await import('/src/stores/agent-store.ts')
          const state = useAgentStore.getState()
          return state.conversations[state.activeConversationId]?.configuration.roleRef
        })
      )?.roleId === localVersions[1].roleId,
      'archiving a role invalidated an existing pinned conversation',
    )
    await page.getByRole('button', { name: '恢复', exact: true }).click()
    return 'singleton role tab, seven SOUL previews, versioned Skill, and immutable local role versions'
  })

  await runCheck('status bar shows the current Git repository fact', async () => {
    const projectOpened = await page.evaluate(async (workspacePath) => {
      const { useFsStore } = await import('/src/stores/fs-store.ts')
      return useFsStore.getState().openRecentWorkspace(workspacePath)
    }, rootDir)
    assert(projectOpened, 'Git smoke workspace could not be opened')

    const snapshot = await page.evaluate(
      (workspacePath) => window.cclinkStudio.git.getSnapshot(workspacePath),
      rootDir,
    )
    assert(snapshot.availability === 'available', `Git snapshot unavailable: ${snapshot.error}`)

    const trigger = page.locator('.git-status-trigger')
    await trigger.waitFor({ state: 'visible', timeout: 10_000 })
    const triggerText = await trigger.innerText()
    assert(triggerText.includes(snapshot.branch ?? ''), 'status bar branch does not match Git')
    assert(
      triggerText.includes(String(snapshot.changeCount)),
      'status bar change count does not match Git',
    )
    const statusBarText = await page.locator('.status-bar').innerText()
    assert(!statusBarText.includes('Agent 就绪'), 'redundant Agent ready status is still visible')
    assert(!statusBarText.includes('编辑器'), 'redundant active Tab type is still visible')
    assert(
      !statusBarText.includes('备份到 Git'),
      'legacy Git backup status action is still visible',
    )

    await trigger.click()
    const popover = page.locator('.git-status-popover')
    await popover.waitFor({ state: 'visible', timeout: 10_000 })
    const popoverText = await popover.innerText()
    assert(popoverText.includes(snapshot.repositoryName ?? ''), 'Git repository name is missing')
    assert(popoverText.includes(snapshot.upstream ?? '未设置上游'), 'Git upstream is missing')
    await popover.locator('.git-status-row-button').click()
    await popover.waitFor({ state: 'hidden', timeout: 10_000 })
    const dialog = page.locator('.git-operation-dialog')
    await dialog.waitFor({ state: 'visible', timeout: 10_000 })
    const changesView = dialog.locator('.git-changes-view')
    await changesView.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await changesView.locator('.git-change-item').count()) >= snapshot.changeCount,
      'Git grouped changes are incomplete',
    )
    const readableChange = changesView.locator('.git-change-item:not(:has(.status-u))').first()
    if ((await readableChange.count()) > 0) {
      await readableChange.click()
      await page.waitForFunction(
        () =>
          Boolean(
            document.querySelector(
              '.git-operation-dialog .git-diff-content, .git-operation-dialog .git-diff-error',
            ),
          ),
        undefined,
        { timeout: 10_000 },
      )
    }
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
    return `${snapshot.branch} · ${snapshot.changeCount} changes · +${snapshot.additions} -${snapshot.deletions}`
  })

  await runCheck('Git commit and push preserve explicit file selection', async () => {
    const fixtureRoot = await mkdtemp(join(homedir(), '.cclink-studio-ui-git-'))
    const workspacePath = join(fixtureRoot, 'workspace')
    const remotePath = join(fixtureRoot, 'remote.git')
    try {
      await mkdir(workspacePath)
      await runGit(fixtureRoot, ['init', '--bare', remotePath])
      await runGit(workspacePath, ['init', '-b', 'main'])
      await runGit(workspacePath, ['config', 'user.name', 'UI Smoke'])
      await runGit(workspacePath, ['config', 'user.email', 'ui-smoke@example.com'])
      await writeFile(join(workspacePath, 'tracked.txt'), 'initial\n', 'utf8')
      await runGit(workspacePath, ['add', 'tracked.txt'])
      await runGit(workspacePath, ['commit', '-m', 'initial'])
      await runGit(workspacePath, ['remote', 'add', 'origin', remotePath])
      await runGit(workspacePath, ['push', '-u', 'origin', 'main'])
      await writeFile(join(workspacePath, 'tracked.txt'), 'changed\n', 'utf8')
      await writeFile(join(workspacePath, 'leave-untracked.txt'), 'keep local\n', 'utf8')

      const opened = await page.evaluate(async (path) => {
        const { useFsStore } = await import('/src/stores/fs-store.ts')
        return useFsStore.getState().openRecentWorkspace(path)
      }, workspacePath)
      assert(opened, 'temporary Git workspace could not be opened')

      const trigger = page.locator('.git-status-trigger')
      await trigger.waitFor({ state: 'visible', timeout: 10_000 })
      await trigger.click()
      const popover = page.locator('.git-status-popover')
      await popover.getByRole('button', { name: '提交…', exact: true }).click()
      const dialog = page.locator('.git-operation-dialog')
      await dialog.waitFor({ state: 'visible', timeout: 10_000 })
      const commitView = dialog.locator('.git-commit-view')
      await commitView.waitFor({ state: 'visible', timeout: 10_000 })
      await commitView.getByRole('button', { name: '全选', exact: true }).click()
      assert(
        (await commitView.getByRole('checkbox', { checked: true }).count()) === 2,
        'Git select all did not select every stageable file',
      )
      await commitView.getByRole('button', { name: '取消全选', exact: true }).click()
      assert(
        (await commitView.getByRole('checkbox', { checked: true }).count()) === 0,
        'Git clear all left stageable files selected',
      )
      await commitView.getByRole('checkbox', { name: 'tracked.txt', exact: true }).check()
      await commitView.getByPlaceholder('说明这次修改').fill('UI smoke explicit commit')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
      await trigger.click()
      await page
        .locator('.git-status-popover')
        .getByRole('button', { name: '提交…', exact: true })
        .click()
      await dialog.waitFor({ state: 'visible', timeout: 10_000 })
      assert(
        (await commitView.getByPlaceholder('说明这次修改').inputValue()) === '',
        'closing the Git dialog kept an obsolete commit message draft',
      )
      assert(
        (await commitView.getByRole('checkbox', { checked: true }).count()) === 0,
        'closing the Git dialog kept obsolete file selections',
      )
      await commitView.getByRole('checkbox', { name: 'tracked.txt', exact: true }).check()
      await commitView.getByPlaceholder('说明这次修改').fill('UI smoke explicit commit')
      await commitView.getByRole('button', { name: '提交 1 个文件', exact: true }).click()
      await dialog
        .locator('.git-operation-notice.success', { hasText: '提交成功' })
        .waitFor({ state: 'visible', timeout: 10_000 })

      const afterCommit = await page.evaluate(
        (path) => window.cclinkStudio.git.getSnapshot(path),
        workspacePath,
      )
      assert(afterCommit.ahead === 1, 'local commit did not become one commit ahead')
      assert(
        afterCommit.changes.some((change) => change.path === 'leave-untracked.txt'),
        'unselected untracked file was unexpectedly committed',
      )

      await dialog.getByRole('button', { name: '推送 1 个已有提交', exact: true }).click()
      await dialog
        .locator('.git-operation-notice.success', { hasText: 'Push 成功' })
        .waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForFunction(
        async (path) => (await window.cclinkStudio.git.getSnapshot(path)).ahead === 0,
        workspacePath,
        { timeout: 10_000 },
      )

      await writeFile(join(workspacePath, 'tracked.txt'), 'changed again\n', 'utf8')
      await dialog.getByRole('button', { name: '刷新 Git 状态', exact: true }).click()
      const staleAlert = dialog.locator('.git-operation-stale')
      await staleAlert.waitFor({ state: 'visible', timeout: 10_000 })
      await staleAlert.getByRole('button', { name: '使用最新状态', exact: true }).click()
      await commitView.getByRole('checkbox', { name: 'tracked.txt', exact: true }).check()
      await commitView.getByPlaceholder('说明这次修改').fill('UI smoke commit and push')
      await commitView.getByRole('button', { name: '提交并推送', exact: true }).click()
      await dialog
        .locator('.git-operation-notice.success', { hasText: '提交并 Push 成功' })
        .waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForFunction(
        async (path) => (await window.cclinkStudio.git.getSnapshot(path)).ahead === 0,
        workspacePath,
        { timeout: 10_000 },
      )
      const localHead = (await runGit(workspacePath, ['rev-parse', 'HEAD'])).stdout.trim()
      const remoteHead = (
        await runGit(fixtureRoot, ['--git-dir', remotePath, 'rev-parse', 'refs/heads/main'])
      ).stdout.trim()
      assert(localHead === remoteHead, 'remote HEAD does not match the confirmed local commit')
      await dialog.getByRole('button', { name: '关闭 Git 窗口', exact: true }).click()
      return 'direct close cleared draft, selected file committed, untracked file preserved, explicit and combined push verified'
    } finally {
      await page.evaluate(async (path) => {
        const { useFsStore } = await import('/src/stores/fs-store.ts')
        return useFsStore.getState().openRecentWorkspace(path)
      }, rootDir)
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  await runCheck('web resources accepts a non-predefined website', async () => {
    const projectOpened = await page.evaluate(async (workspacePath) => {
      const { useFsStore } = await import('/src/stores/fs-store.ts')
      return useFsStore.getState().openRecentWorkspace(workspacePath)
    }, rootDir)
    assert(projectOpened, 'smoke project could not be opened')

    await clickByTitle(page, '网站与账号')
    await page.waitForTimeout(200)
    assert(
      (await page.locator('.sidebar-header-title').innerText()) === '网站与账号',
      'web resources panel missing',
    )

    const accountLabel = 'UI Smoke Account'
    const primaryRow = () => page.locator('.web-resource-row', { hasText: accountLabel })
    const existing = primaryRow()
    if ((await existing.count()) === 0) {
      await page.getByRole('button', { name: '添加网站与账号' }).click()
      await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
      assert(
        (await page.locator('.web-resources-form:not(.web-resources-import-form)').count()) === 0,
        'adding a website account opened a sidebar form',
      )
      await page.locator('.url-input').fill('https://example.com/cclink-web-affairs-smoke')
      await page.locator('.url-input').press('Enter')
      await page.waitForFunction(
        async () => {
          const { useTabStore } = await import('/src/stores/tab-store.ts')
          const tabId = useTabStore.getState().activeTabId
          if (!tabId) return false
          const diagnostic = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
          return diagnostic.visibleUrl?.includes('example.com/cclink-web-affairs-smoke') ?? false
        },
        undefined,
        { timeout: 10_000 },
      )
      await page.getByRole('button', { name: '登录完成，保存到当前项目' }).click()
      const accountNameInput = page.getByLabel('账号名称')
      const inferredName = await accountNameInput.inputValue()
      assert(inferredName.trim().length > 0, 'account name was not prefilled from the current page')
      await accountNameInput.fill('')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await page
        .getByText('请输入账号名称', { exact: true })
        .waitFor({ state: 'visible', timeout: 5_000 })
      assert(
        (await primaryRow().count()) === 0,
        'empty account name unexpectedly created a project resource',
      )
      await accountNameInput.fill(accountLabel)
      await page.getByRole('button', { name: '保存', exact: true }).click()
    }

    await primaryRow().waitFor({ state: 'visible', timeout: 10_000 })
    const rowText = await primaryRow().innerText()
    assert(rowText.includes(accountLabel), 'saved account label is not visible')
    await primaryRow().click()
    await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
    const zoomInput = page.getByLabel('浏览器缩放百分比')
    await zoomInput.waitFor({ state: 'visible', timeout: 10_000 })
    await zoomInput.fill('125')
    await zoomInput.press('Enter')
    await page.waitForFunction(
      async () => {
        const viewState = await window.cclinkStudio.browser.getViewState()
        return viewState?.zoomMode === 'manual' && Math.abs(viewState.zoomFactor - 1.25) < 0.001
      },
      undefined,
      { timeout: 10_000 },
    )
    await page.getByRole('button', { name: '适应宽度' }).click()
    await page.waitForFunction(
      async () => (await window.cclinkStudio.browser.getViewState())?.zoomMode === 'fit',
      undefined,
      { timeout: 10_000 },
    )
    await page
      .locator('.browser-zoom-value .zoom-mode-label', { hasText: '自动' })
      .waitFor({ state: 'visible', timeout: 10_000 })
    const tabCountBeforeDraft = await page.locator('.tab').count()
    await createTabFromMenu(page, 'Markdown 草稿')
    await page.locator('.markdown-editor-wrapper').waitFor({ state: 'visible', timeout: 10_000 })
    const tabCountWithDraft = await page.locator('.tab').count()
    assert(tabCountWithDraft === tabCountBeforeDraft + 1, 'draft tab did not open')
    await primaryRow().click()
    await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await page.locator('.tab').count()) === tabCountWithDraft,
      'reopening one website account created a duplicate Browser Tab',
    )

    await browser.close()
    const resourceRestartLog = await readLog()
    runRestart('restart')
    const restartedCdpPort = await waitForCdpPort(45_000, resourceRestartLog)
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
    return 'project-scoped resource, direct Browser Tab launch/focus, and restart persistence verified'
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
      assert(
        (await page.locator('.web-affairs-form').count()) === 0,
        'transaction creation form leaked into the sidebar',
      )
      await page.locator('.web-affair-draft-tab').waitFor({ state: 'visible', timeout: 10_000 })
      const form = page.locator('.web-affair-draft-form')
      await form.waitFor({ state: 'visible', timeout: 10_000 })
      await form.getByLabel('事务名称').fill(affairTitle)
      await form.getByLabel('最终目标').fill('验证事务列表、流程、节点详情和重启恢复')
      await form.getByLabel('代表的业务主体').selectOption({ label: 'UI Smoke Account' })
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
    const restartedCdpPort = await waitForCdpPort(45_000, affairRestartLog)
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
      const affairTitle = 'UI Smoke Agent Affair Project v2'
      const affairRow = () => page.locator('.web-affair-row', { hasText: affairTitle })
      if ((await affairRow().count()) === 0) {
        await page.getByRole('button', { name: '新建事务' }).evaluate((element) => element.click())
        assert(
          (await page.locator('.web-affairs-form').count()) === 0,
          'transaction creation form leaked into the sidebar',
        )
        await page.locator('.web-affair-draft-tab').waitFor({ state: 'visible', timeout: 10_000 })
        const form = page.locator('.web-affair-draft-form')
        await form.getByLabel('事务名称').fill(affairTitle)
        await form.getByLabel('最终目标').fill('验证 AI 交接、外部等待、模板和动态流程入口')
        await form.getByLabel('代表的业务主体').selectOption({ label: 'UI Smoke Account' })
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
        const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
        const snapshot = await window.cclinkStudio.webAffairs.getSnapshot({
          workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
        })
        if (!snapshot.success) throw new Error(snapshot.error.message)
        let affair = snapshot.data.affairs.find((item) => item.title === title)
        if (!affair) throw new Error('smoke affair missing')
        for (const node of affair.flow.nodes.slice(0, 2)) {
          if (node.status === 'completed') continue
          const updated = await window.cclinkStudio.webAffairs.updateNode({
            workspaceRef: affair.workspaceRef,
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
        (await preflight.innerText()).includes('UI Smoke Account'),
        'preflight account identity missing',
      )
      await preflight.getByRole('button', { name: '取消' }).click()

      const tabCountBeforeResourceLaunch = await page.locator('.tab').count()
      await page
        .locator('.web-affair-resource-card', { hasText: '账号与登录环境' })
        .getByRole('button', { name: /UI Smoke Account/ })
        .click()
      await page.locator('.browser-toolbar').waitFor({ state: 'visible', timeout: 10_000 })
      assert(
        (await page.locator('.web-resource-detail').count()) === 0,
        'affair resource opened a detail tab instead of the Browser Tab',
      )
      assert(
        (await page.locator('.tab').count()) === tabCountBeforeResourceLaunch,
        'affair resource did not reuse the existing website account Browser Tab',
      )
      await page.locator('.tab', { hasText: affairTitle }).last().click()
      await page.locator('.web-affair-tab', { hasText: affairTitle }).waitFor({ timeout: 10_000 })

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
        const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
        const snapshot = await window.cclinkStudio.webAffairs.getSnapshot({
          workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
        })
        if (!snapshot.success) throw new Error(snapshot.error.message)
        const affair = snapshot.data.affairs.find((item) => item.title === title)
        if (!affair) throw new Error('smoke affair missing')
        const result = await window.cclinkStudio.webAffairs.proposeFlowDiff({
          workspaceRef: affair.workspaceRef,
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

    await page.getByRole('button', { name: '更新', exact: true }).click()
    await page.getByRole('heading', { name: '更新', exact: true }).waitFor({ timeout: 10_000 })
    const updateTrack = page.locator('.settings-section select')
    assert((await updateTrack.count()) === 1, 'update track selector missing')
    await updateTrack.selectOption('beta')
    await page.getByText('测试风险', { exact: true }).waitFor({ timeout: 10_000 })

    await page.locator('[title="检查和下载 CCLink Studio 更新"]').click()
    const updatePanel = page.locator('.update-panel')
    await updatePanel.waitFor({ state: 'visible', timeout: 10_000 })
    assert(
      (await updatePanel.innerText()).includes('测试通道'),
      'update panel track did not refresh',
    )
    await updatePanel.locator('.update-panel-header button[title="关闭"]').click()
    await updateTrack.selectOption('stable')
    return 'settings search and stable/beta update track projection'
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

    const activeBrowserTabId = await page.evaluate(async () => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      const state = useTabStore.getState()
      const active = state.tabs.find((tab) => tab.id === state.activeTabId)
      return active?.type === 'browser' ? active.id : null
    })
    assert(activeBrowserTabId, 'new browser tab did not become active')
    await page.waitForFunction(
      async (tabId) => (await window.cclinkStudio.browser.getActiveViewId()) === tabId,
      activeBrowserTabId,
      { timeout: 10_000 },
    )

    await page.locator('[title="检查和下载 CCLink Studio 更新"]').click()
    const browserUpdatePanel = page.locator('.update-panel')
    await browserUpdatePanel.waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForFunction(
      async () => (await window.cclinkStudio.browser.getActiveViewId()) === null,
      undefined,
      { timeout: 10_000 },
    )
    await browserUpdatePanel.locator('.update-panel-header button[title="关闭"]').click()
    await page.waitForFunction(
      async (tabId) => (await window.cclinkStudio.browser.getActiveViewId()) === tabId,
      activeBrowserTabId,
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
    return 'editor/browser/terminal and update modal native-view occlusion'
  })

  await runCheck('no paid UI appears during smoke', async () => {
    const text = await page.locator('body').innerText()
    const blockedCopy = ['订阅', '配额', `Remote ${'Workspace'}`]
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
