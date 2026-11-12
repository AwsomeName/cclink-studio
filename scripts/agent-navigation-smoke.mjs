import { join } from 'node:path'

// Real Electron layout + controlled main→renderer events. Does not claim a real model run.
export async function runAgentNavigationSmoke({ page, electronApp, resizeWindow, evidenceDir }) {
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  const wait = async (predicate, arg) => page.waitForFunction(predicate, arg)
  const original = await page.evaluate(async () => {
    const { captureWorkspaceLayout } = await import('/src/stores/ui-store.ts')
    return captureWorkspaceLayout().snapshot
  })
  const ids = await page.evaluate(async () => {
    const { useAgentStore } = await import('/src/stores/agent-store.ts')
    const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
    const { createConversationRuntimeForWorkspace } =
      await import('/src/features/agent-conversations/view-model.ts')
    const store = useAgentStore.getState()
    const oldActive = store.activeConversationId
    const runtime = createConversationRuntimeForWorkspace(
      useWorkspaceStore.getState().activeWorkspaceRef,
    )
    const first = store.createConversation({ runtime, activate: true })
    store.renameConversation(first, '导航测试 A')
    for (let index = 0; index < 45; index++)
      store.addUserMessage(`导航阅读记录 ${index}\n\n验证切换与收放时的阅读位置。`, first)
    const second = store.createConversation({ runtime, activate: false })
    store.renameConversation(second, '导航测试 B')
    const runId = store.beginRun(first)
    store.startStreamingMessage('navigation-smoke-message', first, runId)
    return { first, second, runId, oldActive }
  })
  const ui = async (mode, width) =>
    page.evaluate(
      async ({ mode, width }) => {
        const { useUIStore } = await import('/src/stores/ui-store.ts')
        const state = useUIStore.getState()
        state.hideSidebar()
        state.setAgentPanelMode('right', 'user')
        state.setAgentPanelWidth(width)
        state.setAgentListWidth(200)
        state.setAgentContentMode(mode)
      },
      { mode, width },
    )
  const width = async () =>
    page.locator('.agent-side-shell').evaluate((el) => el.getBoundingClientRect().width)
  const waitWidth = async (expected) =>
    wait(
      (expected) =>
        Math.abs(
          document.querySelector('.agent-side-shell').getBoundingClientRect().width - expected,
        ) < 1,
      expected,
    )
  const presentation = async (expected) =>
    page.locator(`[data-agent-navigation="${expected}"]`).waitFor()
  const selected = async (id) =>
    wait(
      async (id) =>
        (await import('/src/stores/agent-store.ts')).useAgentStore.getState()
          .activeConversationId === id,
      id,
    )
  try {
    await resizeWindow(1440)
    // Old fixed-height preferences must not restore an oversized empty composer.
    await page.evaluate(() =>
      localStorage.setItem('cclink-studio-agent-composer-height-side', '420'),
    )
    // Start with the real default width. Opening a rail adds only its width and divider.
    await ui('chat', 350)
    await page.evaluate(async () => {
      const ui = (await import('/src/stores/ui-store.ts')).useUIStore.getState()
      ui.setSidebarWidth(250)
      ui.showPanel('files')
    })
    await presentation('chat')
    await waitWidth(350)
    await page.getByRole('button', { name: '展开会话列表', exact: true }).click()
    await presentation('split')
    await waitWidth(554)
    const openedColumns = await page.evaluate(() => {
      const rect = (selector) => {
        const bounds = document.querySelector(selector).getBoundingClientRect()
        return { x: bounds.x, right: bounds.right, width: bounds.width }
      }
      return {
        list: rect('.agent-navigation-list'),
        chat: rect('.agent-workspace-chat'),
        sidebar: rect('.workspace-sidebar-shell'),
        chatVisible: getComputedStyle(document.querySelector('.agent-workspace-chat')).visibility,
      }
    })
    assert(
      openedColumns.list.width === 200 &&
        openedColumns.chat.width === 349 &&
        openedColumns.chat.right <= openedColumns.list.x &&
        openedColumns.sidebar.width === 250 &&
        openedColumns.chatVisible === 'visible',
      `Default entry did not show two separate columns: ${JSON.stringify(openedColumns)}`,
    )
    await page.screenshot({ path: join(evidenceDir, 'agent-navigation-default-open-split.png') })
    await page.locator('.agent-workspace').screenshot({
      path: join(evidenceDir, 'agent-navigation-two-columns.png'),
    })

    // An existing narrow split preference must also be repairable from the drawer's chat button.
    await ui('split', 350)
    await waitWidth(350)
    await page.evaluate(async () =>
      (await import('/src/stores/ui-store.ts')).useUIStore.getState().setAgentDrawerOpen(true),
    )
    await presentation('drawer')
    await page.getByRole('button', { name: '展开聊天', exact: true }).click()
    await presentation('split')
    await waitWidth(700)
    const input = page.locator('.agent-workspace .agent-input')
    await input.fill('')
    const inputHeight = () => input.evaluate((el) => el.getBoundingClientRect().height)
    const compactHeight = await inputHeight()
    assert(compactHeight >= 60 && compactHeight <= 70, `Empty input is too tall: ${compactHeight}`)
    await input.fill(Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 行输入`).join('\n'))
    const grownHeight = await inputHeight()
    assert(grownHeight > compactHeight + 60, `Input did not grow: ${grownHeight}`)
    await input.fill(Array.from({ length: 50 }, (_, i) => `长草稿 ${i + 1}`).join('\n'))
    const cappedHeight = await inputHeight()
    assert(cappedHeight <= 241, `Long input covers messages: ${cappedHeight}`)
    assert(
      await input.evaluate((el) => el.scrollHeight > el.clientHeight),
      'Long input cannot scroll',
    )
    await input.fill('')
    assert(Math.abs((await inputHeight()) - compactHeight) < 1, 'Clearing input did not shrink it')
    await input.fill('导航草稿：切换和收放后保留')
    const messages = page.locator('.agent-workspace .agent-messages')
    await messages.hover()
    await page.mouse.wheel(0, -20000)
    await wait(() => document.querySelector('.agent-workspace .agent-messages').scrollTop < 30)
    await page.screenshot({ path: join(evidenceDir, 'agent-navigation-split.png') })

    const geometry = () =>
      page.evaluate(() => {
        const rect = (selector) => {
          const box = document.querySelector(selector).getBoundingClientRect()
          return { x: box.x, right: box.right, width: box.width }
        }
        return {
          chat: rect('.agent-workspace-chat'),
          workbench: rect('.workbench'),
          list: rect('.agent-navigation-list'),
        }
      })
    const splitGeometry = await geometry()
    let collapsedGeometry
    for (let repeat = 0; repeat < 3; repeat++) {
      await page.getByRole('button', { name: '收起会话列表', exact: true }).click()
      await presentation('chat')
      await waitWidth(496)
      collapsedGeometry = await geometry()
      assert(
        Math.abs(collapsedGeometry.chat.width - splitGeometry.chat.width) < 1,
        'Collapsing expanded chat width',
      )
      assert(
        Math.abs(collapsedGeometry.chat.x - splitGeometry.chat.x - 204) < 1,
        'Chat did not shift right by the released rail width',
      )
      assert(
        Math.abs(collapsedGeometry.workbench.width - splitGeometry.workbench.width - 204) < 1,
        'Released rail width did not return to workbench',
      )
      if (repeat === 0)
        await page.screenshot({
          path: join(evidenceDir, 'agent-navigation-chat-shifted-right.png'),
        })
      await page.getByRole('button', { name: '展开会话列表', exact: true }).click()
      await presentation('split')
      await waitWidth(700)
      assert(
        Math.abs((await geometry()).chat.width - splitGeometry.chat.width) < 1,
        'Expanding changed chat width',
      )
    }
    await page.getByRole('button', { name: '收起聊天，仅保留会话列表', exact: true }).click()
    await presentation('list')
    await waitWidth(200)
    await page.screenshot({ path: join(evidenceDir, 'agent-navigation-list-only.png') })
    assert(
      (await page.evaluate(
        async () => (await import('/src/stores/ui-store.ts')).useUIStore.getState().agentPanelWidth,
      )) === 700,
      'List-only overwrote expanded width',
    )
    await page.locator('.agent-navigation-list .session-sidebar-row[title="导航测试 A"]').click()
    await presentation('split')
    await waitWidth(700)
    assert(
      (await input.inputValue()) === '导航草稿：切换和收放后保留',
      'Draft lost after list-only',
    )
    assert(
      (await messages.evaluate((el) => el.scrollTop)) < 30,
      'Reading position lost after list-only',
    )

    await page.locator('.agent-navigation-list .session-sidebar-row[title="导航测试 B"]').click()
    await selected(ids.second)
    await input.fill('B 的独立草稿')
    // A keeps receiving production IPC events while another conversation is selected.
    await electronApp.evaluate(
      ({ BrowserWindow }, ids) =>
        BrowserWindow.getAllWindows()[0].webContents.send('agent:stream', {
          type: 'stream_event',
          conversationId: ids.first,
          runId: ids.runId,
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          },
        }),
      ids,
    )
    await electronApp.evaluate(
      ({ BrowserWindow }, ids) =>
        BrowserWindow.getAllWindows()[0].webContents.send('agent:stream', {
          type: 'stream_event',
          conversationId: ids.first,
          runId: ids.runId,
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '后台继续输出' },
          },
        }),
      ids,
    )
    await wait(
      async (id) =>
        (await import('/src/stores/agent-store.ts')).useAgentStore
          .getState()
          .conversations[id].messages.at(-1)
          .rawText.includes('后台继续输出'),
      ids.first,
    )
    await page.locator('.agent-navigation-list .session-sidebar-row[title="导航测试 A"]').click()
    await selected(ids.first)
    assert(
      (await input.inputValue()) === '导航草稿：切换和收放后保留',
      'Cross-conversation draft corruption',
    )
    assert(
      (await messages.evaluate((el) => el.scrollTop)) < 30,
      'Reading position lost after switching',
    )
    const run = await page.evaluate(async (id) => {
      const item = (await import('/src/stores/agent-store.ts')).useAgentStore.getState()
        .conversations[id]
      return { status: item.runStatus, text: item.messages.at(-1)?.rawText }
    }, ids.first)
    assert(
      run.status === 'running' && run.text.includes('后台继续输出'),
      `Hidden conversation stopped receiving events: ${JSON.stringify(run)}`,
    )

    await page.locator('[data-layout-area="agent-sessions"]').focus()
    await page.keyboard.press('ArrowRight')
    assert(
      (await page.evaluate(
        async () => (await import('/src/stores/ui-store.ts')).useUIStore.getState().agentListWidth,
      )) === 190,
      'Keyboard list resize failed',
    )
    await page.locator('[data-layout-area="agent-sessions"]').press('ArrowLeft')
    await resizeWindow(860)
    await presentation('chat')
    await page.getByRole('button', { name: '展开会话列表', exact: true }).click()
    await presentation('drawer')
    assert(
      await page.locator('.agent-workspace-chat').evaluate((el) => el.inert),
      'Covered chat must be inert',
    )
    await page.screenshot({ path: join(evidenceDir, 'agent-navigation-drawer.png') })
    await page.getByRole('button', { name: '展开聊天', exact: true }).click()
    await presentation('chat')
    await page.getByRole('button', { name: '展开会话列表', exact: true }).click()
    await presentation('drawer')
    await page.keyboard.press('Escape')
    await presentation('chat')
    await resizeWindow(1440)
    await presentation('split')
    await waitWidth(700)
    await page.getByRole('button', { name: '收起会话列表', exact: true }).click()
    await resizeWindow(900)
    await resizeWindow(1440)
    await presentation('chat')

    await page.locator('.app-topbar-right button').click()
    await page.locator('.agent-workspace').waitFor({ state: 'detached' })
    await electronApp.evaluate(
      ({ BrowserWindow }, ids) =>
        BrowserWindow.getAllWindows()[0].webContents.send('agent:stream', {
          type: 'stream_event',
          conversationId: ids.first,
          runId: ids.runId,
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: '；整体隐藏后仍继续' },
          },
        }),
      ids,
    )
    await page.locator('.app-topbar-right button').click()
    await presentation('chat')
    await waitWidth(496)
    assert(
      (await input.inputValue()) === '导航草稿：切换和收放后保留',
      'Draft lost after whole panel hide',
    )
    await wait(
      async (id) =>
        (await import('/src/stores/agent-store.ts')).useAgentStore
          .getState()
          .conversations[id].messages.at(-1)
          .rawText.includes('整体隐藏后仍继续'),
      ids.first,
    )
    const auditIssues = []
    const settleLayout = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
    await ui('chat', 656)
    await presentation('chat')
    await waitWidth(656)
    const beforeChatToggle = (await geometry()).chat.width
    await page.getByRole('button', { name: '收起聊天，仅保留会话列表', exact: true }).click()
    await presentation('list')
    await page.getByRole('button', { name: '展开聊天', exact: true }).click()
    await presentation('split')
    await settleLayout()
    const afterChatToggle = (await geometry()).chat.width
    if (Math.abs(beforeChatToggle - afterChatToggle) >= 1)
      auditIssues.push(
        `Chat-only → list → split changed chat width: ${beforeChatToggle} → ${afterChatToggle}`,
      )

    await ui('split', 524.75)
    await presentation('split')
    await settleLayout()
    const beforeFractionalToggle = (await geometry()).chat.width
    await page.getByRole('button', { name: '收起会话列表', exact: true }).click()
    await presentation('chat')
    await settleLayout()
    const afterFractionalToggle = (await geometry()).chat.width
    if (Math.abs(beforeFractionalToggle - afterFractionalToggle) >= 1)
      auditIssues.push(
        `Fractional split collapse changed chat width: ${beforeFractionalToggle} → ${afterFractionalToggle}`,
      )
    await page.getByRole('button', { name: '展开会话列表', exact: true }).click()
    await presentation('split')
    await settleLayout()
    const reopenedFractionalChat = (await geometry()).chat.width
    if (Math.abs(beforeFractionalToggle - reopenedFractionalChat) >= 1)
      auditIssues.push(
        `Fractional split reopening changed chat width: ${beforeFractionalToggle} → ${reopenedFractionalChat}`,
      )

    await ui('chat', 656)
    await input.fill('')
    await messages.hover()
    await page.mouse.wheel(0, 20000)
    await wait(() => {
      const el = document.querySelector('.agent-workspace .agent-messages')
      return el.scrollHeight - el.clientHeight - el.scrollTop < 2
    })
    await input.fill(Array.from({ length: 8 }, (_, i) => `自动增高时保留最新消息 ${i}`).join('\n'))
    await settleLayout()
    const bottomGapAfterTyping = await messages.evaluate(
      (el) => el.scrollHeight - el.clientHeight - el.scrollTop,
    )
    if (bottomGapAfterTyping >= 2)
      auditIssues.push(`Growing composer hid the latest message by ${bottomGapAfterTyping}px`)
    await input.fill('')
    await messages.hover()
    await page.mouse.wheel(0, -1000)
    await wait(() => {
      const el = document.querySelector('.agent-workspace .agent-messages')
      return el.scrollHeight - el.clientHeight - el.scrollTop > 500
    })
    const readingPosition = await messages.evaluate((el) => el.scrollTop)
    await input.fill(Array.from({ length: 8 }, (_, i) => `阅读历史时输入 ${i}`).join('\n'))
    await settleLayout()
    const readingPositionAfterTyping = await messages.evaluate((el) => el.scrollTop)
    if (Math.abs(readingPosition - readingPositionAfterTyping) >= 1)
      auditIssues.push(
        `Composer growth jumped away from reading position: ${readingPosition} → ${readingPositionAfterTyping}`,
      )
    assert(auditIssues.length === 0, `Navigation audit: ${JSON.stringify(auditIssues)}`)
    return {
      defaultEntryColumns: openedColumns,
      expandedWidth: 700,
      listOnlyWidth: 200,
      splitGeometry,
      collapsedGeometry,
      composer: { compactHeight, grownHeight, cappedHeight },
      audit: {
        beforeChatToggle,
        afterChatToggle,
        beforeFractionalToggle,
        afterFractionalToggle,
        reopenedFractionalChat,
        bottomGapAfterTyping,
        readingPosition,
        readingPositionAfterTyping,
      },
      narrowDrawer: true,
      draftsPreserved: true,
      readPositionPreserved: true,
      controlledIpcWhileHidden: true,
    }
  } finally {
    await page.evaluate(
      async ({ original, ids }) => {
        const { useAgentStore } = await import('/src/stores/agent-store.ts')
        const { useUIStore } = await import('/src/stores/ui-store.ts')
        const store = useAgentStore.getState()
        store.cancelStreaming(ids.first, 'cancelled', ids.runId)
        store.closeConversation(ids.first)
        store.closeConversation(ids.second)
        store.switchConversation(ids.oldActive)
        useUIStore.getState().hydrateFromWorkspaceState(original)
      },
      { original, ids },
    )
    await resizeWindow(1440)
  }
}
