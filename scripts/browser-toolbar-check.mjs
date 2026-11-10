import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

// Runs only against the smoke runtime's isolated profile and local HTTP fixture.
export async function checkBrowserToolbar({
  page,
  rootDir,
  runDir,
  webFixtureOrigin,
  waitForAsyncFunction,
}) {
  const evidenceDir = join(runDir, 'browser-toolbar-evidence')
  await mkdir(evidenceDir, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 920 })
  const browserTabId = await page.evaluate(
    async ({ rootDir, webFixtureOrigin }) => {
      const [{ useFsStore }, { useUIStore }, { openDefaultBrowserTab }, { useWorkspaceStore }] =
        await Promise.all([
          import('/src/stores/fs-store.ts'),
          import('/src/stores/ui-store.ts'),
          import('/src/features/web-resources/open-default-browser-tab.ts'),
          import('/src/stores/workspace-store.ts'),
        ])
      await useFsStore.getState().openRecentWorkspace(rootDir)
      useUIStore.getState().showPanel('files')
      useUIStore.getState().setSidebarWidth(240)
      useUIStore.getState().setAgentPanelMode('hidden', 'user')
      return (
        await openDefaultBrowserTab(useWorkspaceStore.getState().activeWorkspaceRef, {
          title: '工具栏验收',
          initialUrl: `${webFixtureOrigin}/toolbar-responsive`,
        })
      ).tabId
    },
    { rootDir, webFixtureOrigin },
  )
  await waitForAsyncFunction(
    page,
    async (tabId) =>
      (await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)).visibleUrl?.endsWith(
        '/toolbar-responsive',
      ),
    browserTabId,
  )
  const actions = page.getByRole('group', { name: '新建', exact: true })
  assert(
    (await actions.getByRole('button').count()) === 3,
    'creation strip must contain only Browser, MD and Terminal',
  )

  async function checkBounds() {
    const handle = await waitForAsyncFunction(
      page,
      async (tabId) => {
        const shell = document.querySelector('.browser-toolbar-shell').getBoundingClientRect()
        const runtime = await window.cclinkStudio.browser.getRuntimeDiagnostics(tabId)
        const layout = runtime.layout
        return (
          layout &&
          !layout.overlapsProtectedTop &&
          layout.rendererBounds.y >= shell.bottom - 1 &&
          layout.nativeBounds.y >= layout.nativeProtectedTop &&
          (await window.cclinkStudio.browser.getActiveViewId()) === tabId &&
          layout
        )
      },
      browserTabId,
      { timeout: 10_000 },
    )
    const layout = await handle.jsonValue()
    await handle.dispose()
    return layout
  }
  // Merely inspecting the current percentage must not turn off automatic fit.
  await page.evaluate((id) => window.cclinkStudio.browser.fitWidth(id), browserTabId)
  const summary = page.getByRole('button', { name: '网页缩放与显示选项', exact: true })
  const zoomInput = page.getByLabel('浏览器缩放百分比')
  await summary.click()
  await page.waitForFunction(() => document.activeElement?.classList.contains('zoom-percent-input'))
  await page.getByRole('button', { name: '关闭浏览器选项', exact: true }).click()
  const unchangedZoomModes = []
  for (let sample = 0; sample < 5; sample++) {
    unchangedZoomModes.push(
      await page.evaluate(
        async (id) =>
          (await window.cclinkStudio.browser.getRuntimeDiagnostics(id)).viewState.zoomMode,
        browserTabId,
      ),
    )
    await page.waitForTimeout(50)
  }
  await summary.click()
  await zoomInput.waitFor({ state: 'visible' })
  await page.setViewportSize({ width: 760, height: 920 })
  await summary.waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  await page.locator('.browser-options-panel').waitFor({ state: 'hidden' })
  const restoredVisibleFocus = await page
    .getByRole('button', { name: '更多浏览器操作', exact: true })
    .evaluate((el) => el === document.activeElement)
  const expansionReview = { unchangedZoomModes, restoredVisibleFocus }
  await writeFile(
    join(evidenceDir, 'expansion-review.json'),
    JSON.stringify(expansionReview, null, 2),
  )
  assert(
    unchangedZoomModes.every((mode) => mode === 'fit') && restoredVisibleFocus,
    `opening/closing or resizing an expansion changed user state: ${JSON.stringify(expansionReview)}`,
  )
  const evidence = []
  for (const viewportWidth of [1440, 1000, 760]) {
    await page.setViewportSize({ width: viewportWidth, height: 920 })
    const geometry = await page.locator('.workbench').evaluate((workbench) => {
      const box = (selector) => {
        const r = workbench.querySelector(selector).getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, right: r.right }
      }
      return {
        width: workbench.clientWidth,
        actions: box('.tab-create-actions'),
        bar: box('.tab-bar'),
        address: box('.url-input'),
        toolbar: box('.browser-toolbar'),
        more: box('.browser-more-button'),
      }
    })
    assert(geometry.address.width >= 90, `address field squeezed: ${JSON.stringify(geometry)}`)
    assert(geometry.more.right <= geometry.toolbar.right + 1, 'toolbar controls overflow')
    assert(geometry.actions.right <= geometry.bar.right + 1, 'new actions overflow tab bar')
    for (const button of await actions.getByRole('button').all())
      assert(await button.isVisible(), 'creation entry hidden')
    const collapsedLayout = await checkBounds()
    await page
      .locator('.tab-bar')
      .screenshot({ path: join(evidenceDir, `tabs-${viewportWidth}.png`) })
    await page
      .locator('.browser-toolbar-shell')
      .screenshot({ path: join(evidenceDir, `toolbar-${viewportWidth}.png`) })
    await page.getByRole('button', { name: '保存账号和登录状态', exact: true }).click()
    await page.getByLabel('账号手机号或平台用户名').waitFor({ state: 'visible' })
    const expandedLayout = await checkBounds()
    assert(
      expandedLayout.nativeBounds.y > collapsedLayout.nativeBounds.y + 40,
      'save form did not push native page down',
    )
    await page
      .locator('.browser-toolbar-shell')
      .screenshot({ path: join(evidenceDir, `save-${viewportWidth}.png`) })
    await page.keyboard.press('Escape')
    await page.locator('.browser-resource-save').waitFor({ state: 'hidden' })
    assert(
      await page
        .getByRole('button', { name: '保存账号和登录状态', exact: true })
        .evaluate((el) => el === document.activeElement),
      'Escape did not restore account trigger focus',
    )
    await page.getByRole('button', { name: '更多浏览器操作', exact: true }).click()
    await page.getByLabel('浏览器缩放百分比').waitFor({ state: 'visible' })
    await checkBounds()
    await page
      .locator('.browser-toolbar-shell')
      .screenshot({ path: join(evidenceDir, `options-${viewportWidth}.png`) })
    const beforeZoom = await page.evaluate(
      (id) => window.cclinkStudio.browser.getRuntimeDiagnostics(id),
      browserTabId,
    )
    await page.getByLabel('浏览器缩放百分比').fill('177')
    await page.keyboard.press('Escape')
    await page.locator('.browser-options-panel').waitFor({ state: 'hidden' })
    const afterZoom = await page.evaluate(
      (id) => window.cclinkStudio.browser.getRuntimeDiagnostics(id),
      browserTabId,
    )
    assert(
      beforeZoom.viewState.zoomFactor === afterZoom.viewState.zoomFactor,
      'Escape committed an unsubmitted zoom percentage',
    )
    await page.getByRole('button', { name: '更多浏览器操作', exact: true }).click()
    await page.getByRole('button', { name: '浏览历史', exact: true }).click()
    await page.locator('.browser-history-popover').waitFor({ state: 'visible' })
    await waitForAsyncFunction(
      page,
      async () => (await window.cclinkStudio.browser.getActiveViewId()) === null,
    )
    await page.keyboard.press('Escape')
    await page.locator('.browser-history-popover').waitFor({ state: 'hidden' })
    assert(
      await page.locator('.browser-options-panel').isVisible(),
      'history Escape also closed parent options',
    )
    await page.keyboard.press('Escape')
    await page.locator('.browser-options-panel').waitFor({ state: 'hidden' })
    await checkBounds()
    evidence.push({ viewportWidth, ...geometry, collapsedLayout, expandedLayout })
  }

  // Real creation actions populate the strip; no synthetic DOM tabs.
  for (let index = 0; index < 10; index++) {
    await actions.getByRole('button', { name: '新建 Markdown 草稿', exact: true }).click()
  }
  const tabCount = await page.locator('.tab-strip [role="tab"]').count()
  assert(tabCount >= 11, 'multiple tabs were not created')
  for (const viewportWidth of [1440, 760]) {
    await page.setViewportSize({ width: viewportWidth, height: 920 })
    await page.waitForFunction(() => {
      const strip = document.querySelector('.tab-strip').getBoundingClientRect()
      const active = document
        .querySelector('.tab-strip [aria-selected="true"]')
        .getBoundingClientRect()
      return active.left >= strip.left - 1 && active.right <= strip.right + 1
    })
    const strip = page.locator('.tab-strip')
    assert(
      await strip.evaluate((el) => el.scrollWidth > el.clientWidth),
      'multitab strip did not overflow',
    )
    const fixed = await actions.boundingBox()
    const beforeScroll = await strip.evaluate((el) => el.scrollLeft)
    await page.getByRole('button', { name: '向前滚动标签', exact: true }).click()
    await page.waitForFunction(
      (before) => document.querySelector('.tab-strip').scrollLeft < before - 10,
      beforeScroll,
    )
    assert(
      Math.abs((await actions.boundingBox()).x - fixed.x) < 1,
      'creation buttons moved with tabs',
    )
    const active = page.locator('.tab-strip [aria-selected="true"]')
    await active.focus()
    await active.press('Home')
    await page.waitForFunction(() => {
      const tabs = document.querySelectorAll('.tab-strip [role="tab"]')
      return (
        tabs[0].getAttribute('aria-selected') === 'true' &&
        document.querySelector('.tab-strip').scrollLeft < 2
      )
    })
    await page.locator('.tab-strip [aria-selected="true"]').press('End')
    await page.waitForFunction(() => {
      const tabs = document.querySelectorAll('.tab-strip [role="tab"]')
      const strip = document.querySelector('.tab-strip').getBoundingClientRect()
      const last = tabs[tabs.length - 1]
      return (
        last.getAttribute('aria-selected') === 'true' &&
        last.getBoundingClientRect().right <= strip.right + 1
      )
    })
    await page
      .locator('.tab-bar')
      .screenshot({ path: join(evidenceDir, `many-tabs-${viewportWidth}.png`) })
  }
  await page.evaluate(async (id) => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    useTabStore.getState().activateTab(id)
  }, browserTabId)
  await checkBounds()
  // Browser status updates must not pull a manually scrolled tab strip back.
  await page.locator('.tab-strip').evaluate((strip) => {
    strip.scrollLeft = 0
  })
  await page.evaluate((id) => window.cclinkStudio.browser.setZoom(id, 1.25), browserTabId)
  await waitForAsyncFunction(
    page,
    async (id) => {
      const { useBrowserStore } = await import('/src/stores/browser-store.ts')
      return useBrowserStore.getState().tabs[id]?.zoomFactor === 1.25
    },
    browserTabId,
  )
  assert(
    (await page.locator('.tab-strip').evaluate((el) => el.scrollLeft)) < 2,
    'browser status update reset the user tab scroll position',
  )
  await page.evaluate((id) => window.cclinkStudio.browser.fitWidth(id), browserTabId)
  await writeFile(
    join(evidenceDir, 'verification.json'),
    JSON.stringify({ tabCount, evidence }, null, 2),
  )
  await page.setViewportSize({ width: 1440, height: 920 })
  return `${tabCount} real tabs; viewport 1440/1000/760; fixed creation actions, address space, keyboard navigation, Escape, nested history, native page bounds verified; ${evidenceDir}`
}
