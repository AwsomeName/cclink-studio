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
        state.setAgentListWidth(220)
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
    // Start with the real default width. Pre-setting 700px hid the broken entry action.
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
    await waitWidth(700)
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
      openedColumns.list.width === 220 &&
        openedColumns.chat.width >= 360 &&
        openedColumns.list.right <= openedColumns.chat.x &&
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
    await input.fill('导航草稿：切换和收放后保留')
    const messages = page.locator('.agent-workspace .agent-messages')
    await messages.hover()
    await page.mouse.wheel(0, -20000)
    await wait(() => document.querySelector('.agent-workspace .agent-messages').scrollTop < 30)
    await page.screenshot({ path: join(evidenceDir, 'agent-navigation-split.png') })

    await page.getByRole('button', { name: '收起会话列表', exact: true }).click()
    await presentation('chat')
    await waitWidth(700)
    await page.getByRole('button', { name: '展开会话列表', exact: true }).click()
    await presentation('split')
    await page.getByRole('button', { name: '收起聊天，仅保留会话列表', exact: true }).click()
    await presentation('list')
    await waitWidth(220)
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
      )) === 230,
      'Keyboard list resize failed',
    )
    await page.locator('[data-layout-area="agent-sessions"]').press('ArrowLeft')
    await resizeWindow(900)
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
    await waitWidth(700)
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
    return {
      defaultEntryColumns: openedColumns,
      expandedWidth: 700,
      listOnlyWidth: 220,
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
