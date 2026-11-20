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
    await ui('chat', 350)
    const swap = async (to) => {
      await page
        .locator('.app-topbar-agent-actions')
        .getByRole('button', { name: to === 'list' ? '会话列表' : '返回会话', exact: true })
        .click()
      await presentation(to)
    }
    await swap('list')
    await waitWidth(350)
    await swap('chat')
    await waitWidth(350)
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
    await swap('list')
    assert(
      await page.locator('.agent-workspace-chat').evaluate((el) => el.inert),
      'Hidden chat is not inert',
    )
    await page.screenshot({ path: join(evidenceDir, 'agent-list.png') })
    await page.locator('.agent-navigation-list .session-sidebar-row[title="导航测试 A"]').click()
    await presentation('chat')
    await waitWidth(350)
    assert(
      (await input.inputValue()) === '导航草稿：切换和收放后保留',
      'Draft lost after list-only',
    )
    assert(
      (await messages.evaluate((el) => el.scrollTop)) < 30,
      'Reading position lost after list-only',
    )

    await swap('list')
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
    await swap('list')
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

    await resizeWindow(900)
    await swap('list')
    await swap('chat')
    await resizeWindow(1440)
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
    await waitWidth(350)
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
    await ui('chat', 524.75)
    const previousWidth = await width()
    await swap('list')
    await swap('chat')
    assert(Math.abs(previousWidth - (await width())) < 1, 'Page switch changed fractional width')
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
      composer: { compactHeight, grownHeight, cappedHeight },
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
