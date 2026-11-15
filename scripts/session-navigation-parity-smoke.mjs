import assert from 'node:assert/strict'
import { join } from 'node:path'

// Both controllers use the real Electron UI; remote sessions remain transport fixtures.
export async function runSessionNavigationParitySmoke({ page, app, ref, localPath, dir }) {
  const resize = (width) =>
    app.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setSize(width, 1000)
    }, width)
  const presentation = (mode) => page.locator(`[data-agent-navigation="${mode}"]`).waitFor()
  const measure = () =>
    page.evaluate(() => {
      const rect = (selector) => {
        const { x, width, right } = document.querySelector(selector).getBoundingClientRect()
        return { x, width, right }
      }
      return {
        chat: rect('.agent-workspace-chat'),
        list: rect('.agent-navigation-list'),
        workbench: rect('.workbench'),
      }
    })
  const results = {}
  for (const kind of ['local', 'remote']) {
    await resize(1440)
    const sessionId = await page.evaluate(
      async ({ kind, ref, localPath }) => {
        const { useWorkspaceStore, useUIStore } = window.controlsSmoke
        const workspaceRef = kind === 'local' ? { kind: 'local', path: localPath } : ref
        useWorkspaceStore.getState().commitActiveWorkspace(workspaceRef)
        let id = 'idle'
        if (kind === 'local') {
          const { useAgentStore } = await import('/src/stores/agent-store.ts')
          const { createConversationRuntimeForWorkspace } =
            await import('/src/features/agent-conversations/view-model.ts')
          id = useAgentStore.getState().createConversation({
            runtime: createConversationRuntimeForWorkspace(workspaceRef),
            activate: true,
          })
          useAgentStore.getState().renameConversation(id, '本地布局对照')
        }
        const ui = useUIStore.getState()
        ui.hideSidebar()
        ui.setAgentPanelMode('right', 'user')
        ui.setAgentPanelWidth(700)
        ui.setAgentListWidth(200)
        ui.setAgentContentMode('split')
        return id
      },
      { kind, ref, localPath },
    )
    await presentation('split')
    const row = page.locator(`.agent-navigation-list [data-conversation-id="${sessionId}"]`)
    await row.click()
    await page.waitForFunction(
      () => document.querySelector('.workspace-sidebar-shell').getBoundingClientRect().width === 0,
    )
    const before = await measure()
    assert.equal(before.list.width, 200, kind)
    assert.equal(before.chat.width, 495, kind)
    assert(before.chat.right < before.list.x, kind)
    await page.getByRole('button', { name: '收起会话列表', exact: true }).click()
    await presentation('chat')
    const collapsed = await measure()
    assert.equal(collapsed.chat.width, before.chat.width, kind)
    assert.equal(collapsed.chat.x - before.chat.x, 204, kind)
    assert.equal(collapsed.workbench.width - before.workbench.width, 204, kind)
    await page.getByRole('button', { name: '展开会话列表', exact: true }).click()
    await presentation('split')
    assert.deepEqual(await measure(), before, kind)
    await page.getByRole('button', { name: '收起聊天，仅保留会话列表', exact: true }).click()
    await presentation('list')
    await row.click()
    await presentation('split')
    assert.deepEqual(await measure(), before, kind)

    const input = page.locator('.agent-workspace-chat .agent-input')
    const height = () => input.evaluate((el) => el.getBoundingClientRect().height)
    await input.fill('')
    const emptyHeight = await height()
    assert.equal(emptyHeight, 64, kind)
    await input.fill(Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 行`).join('\n'))
    const growingHeight = await height()
    assert(growingHeight > emptyHeight && growingHeight < 240, kind)
    await input.fill('多行输入\n'.repeat(50))
    assert.equal(await height(), 240, kind)
    assert(await input.evaluate((el) => el.scrollHeight > el.clientHeight), kind)
    await input.fill('布局对照草稿')

    await resize(860)
    await presentation('chat')
    await page.getByRole('button', { name: '展开会话列表', exact: true }).click()
    await presentation('drawer')
    assert(await page.locator('.agent-workspace-chat').evaluate((el) => el.inert), kind)
    await row.click()
    await presentation('chat')
    assert.equal(await input.inputValue(), '布局对照草稿', kind)
    await resize(1440)
    await presentation('split')
    assert.deepEqual(await measure(), before, kind)
    await input.fill('')
    assert.equal(await height(), emptyHeight, kind)
    await page.screenshot({ path: join(dir, `${kind}-navigation-parity.png`) })
    results[kind] = { before, collapsed, emptyHeight, growingHeight, maxHeight: 240 }
  }
  assert.deepEqual(results.remote, results.local)
  return results
}
