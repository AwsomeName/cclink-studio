import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electron from 'electron'

const root = await mkdtemp(join(tmpdir(), 'studio-agent-pages-'))
const evidence =
  process.env.CCLINK_AGENT_PAGE_EVIDENCE || (await mkdtemp(join(tmpdir(), 'agent-page-evidence-')))
let app
try {
  for (const folder of ['home', 'profile', 'documents', 'workspace'])
    await mkdir(join(root, folder))
  await writeFile(
    join(root, 'profile/settings.json'),
    JSON.stringify({
      componentSetupPageSeenVersion: 99,
      lastWorkspacePath: join(root, 'workspace'),
    }),
  )
  await mkdir(evidence, { recursive: true })
  const entry = join(root, 'launch.cjs')
  await writeFile(
    entry,
    `const {app}=require('electron');app.setPath('home',${JSON.stringify(join(root, 'home'))});app.setPath('documents',${JSON.stringify(join(root, 'documents'))});app.setAppPath(${JSON.stringify(resolve('.'))});require(${JSON.stringify(resolve(process.env.CCLINK_AGENT_PAGE_BUILD || 'out', 'main/index.js'))});`,
  )
  app = await _electron.launch({
    executablePath: electron,
    args: [entry],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: join(root, 'profile'),
    },
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  const panel = page.locator('.agent-workspace')
  const top = page.locator('.app-topbar-agent-actions')
  const button = (name) =>
    (['新建会话', '会话列表', '返回会话'].includes(name) ? top : panel).getByRole('button', {
      name,
      exact: true,
    })
  await panel.waitFor()
  const width = (await panel.boundingBox()).width
  async function create(title, note) {
    await button('新建会话').click()
    await page.waitForFunction(() => document.activeElement?.matches('.agent-workspace textarea'))
    await panel.locator('.conversation-edit-title').click()
    await panel.getByLabel('会话标题').fill(title)
    await panel.getByLabel('个人标注').fill(note)
    await button('保存').click()
  }
  assert.equal(await panel.locator('.agent-workspace-header').count(), 0)
  const quietSwitch = await button('会话列表').boundingBox()
  const hide = top.getByTitle('收起 Agent 面板')
  const expand = top.getByTitle('展开 Agent 面板')
  await hide.click()
  await button('会话列表').click()
  await panel.locator('.agent-navigation-list:visible').waitFor()
  await hide.click()
  await expand.click()
  await panel.locator('.agent-navigation-list:visible').waitFor()
  await button('返回会话').click()
  await hide.click()
  assert.equal(await panel.locator('.agent-other-updates').count(), 0)
  await create('生成摘要', '正在处理')
  await create('核验附件', '等待处理')
  await create('校对更新日志', '草稿核对')
  await create('发布前检查', '等公证回执')
  await panel.locator('textarea:visible').fill('下次继续核对公证结果。')
  await button('会话列表').click()
  assert.equal((await panel.boundingBox()).width, width)
  const lookup = (title) =>
    panel
      .locator('.conversation-managed-row')
      .filter({ has: page.locator('[data-conversation-id][title="' + title + '"]') })
  const idOf = (title) =>
    lookup(title).locator('[data-conversation-id]').getAttribute('data-conversation-id')
  const completed = await idOf('校对更新日志')
  const running = await idOf('生成摘要')
  const waiting = await idOf('核验附件')
  const active = await idOf('发布前检查')
  const scope = await page.locator('.status-bar-workspace').getAttribute('title')
  const workspaceKey = scope === '未归档' ? null : scope
  // Open an enabled command first, then deliver the permission request before clicking it.
  await lookup('核验附件').locator('[data-conversation-id]').click({ button: 'right' })
  const staleArchive = page.getByRole('menuitem', { name: '关闭会话' })
  assert.equal(await staleArchive.getAttribute('aria-disabled'), 'false')
  await app.evaluate(
    ({ BrowserWindow }, { completed, running, waiting, workspaceKey }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      const now = Date.now()
      for (const conversationId of [completed, running]) {
        const record = {
          conversationId,
          workspaceKey,
          runId: conversationId + '-run',
          startedAt: now,
          updatedAt: now,
          completedAt: null,
          status: 'running',
        }
        contents.send('agent:runStatus', record)
        if (conversationId === completed) {
          contents.send('agent:runStatus', {
            ...record,
            status: 'succeeded',
            updatedAt: now + 1,
            completedAt: now + 1,
          })
          contents.send('agent:runStatus', record) // Delayed running event after success.
        }
      }
      contents.send('agent:requestConfirmation', {
        id: 'test-request',
        conversationId: waiting,
        toolName: 'edit',
        riskLevel: 'write',
        summary: [{ label: '操作', value: '验收用确认' }],
      })
    },
    { completed, running, waiting, workspaceKey },
  )

  await lookup('核验附件')
    .locator('.session-sidebar-row-preview')
    .filter({ hasText: '待确认' })
    .waitFor()
  if (await staleArchive.isEnabled()) {
    await staleArchive.click()
    await page.getByRole('alert').filter({ hasText: '请先结束本轮任务' }).waitFor()
  } else {
    await page.keyboard.press('Escape')
  }
  assert.equal(await lookup('核验附件').isVisible(), true)
  // Both alternate archive entry points must reflect the live operation policy.
  for (const title of ['生成摘要', '核验附件']) {
    const row = lookup(title)
    await row
      .locator('.session-sidebar-row-preview')
      .filter({ hasText: title === '生成摘要' ? '运行中' : '待确认' })
      .waitFor()
    assert.equal(await row.getByRole('button', { name: '归档会话' }).isDisabled(), true)
    await row.locator('[data-conversation-id]').click({ button: 'right' })
    const archive = page.getByRole('menuitem', { name: '关闭会话' })
    await archive.waitFor()
    assert.equal(await archive.getAttribute('aria-disabled'), 'true')
    await page.keyboard.press('Escape')
    assert.equal(await row.isVisible(), true)
  }
  console.log(
    'PASS: running and pending-confirmation sessions protected in both list and context menu',
  )

  const search = panel.getByPlaceholder('搜索会话')
  await page.screenshot({ path: join(evidence, 'topbar-list.png') })
  await search.fill('发布前检查')
  assert.equal(await panel.locator('[data-conversation-id]:visible').count(), 1)
  await button('返回会话').click()
  const draft = '下次继续核对公证结果。'
  const assertCurrentDraft = async () => {
    assert.match(await panel.locator('.conversation-edit-title:visible').innerText(), /发布前检查/)
    assert.equal(await panel.locator('textarea:visible').inputValue(), draft)
  }
  await assertCurrentDraft()
  const updates = panel.locator('.agent-other-updates')
  const statusButton = (label) => updates.getByRole('button', { name: label + ' 1', exact: true })
  // In the approved chat layout usage sits above the field, and a draft has no welcome card.
  const bounds = async (selector) => {
    const box = await panel.locator(selector).boundingBox()
    assert.ok(box, selector + ' must be visible')
    return box
  }
  const field = await bounds('.agent-input-card:visible')
  const usage = await bounds('.agent-chat-usage-button:visible')
  assert.deepEqual(await button('会话列表').boundingBox(), quietSwitch)
  await page.screenshot({ path: join(evidence, 'topbar-chat.png') })
  assert.equal(await panel.locator('.agent-update-count:visible').count(), 3)
  const identity = await bounds('.agent-panel-header:visible')
  assert.ok(Math.abs(identity.height - 93) <= 1, 'annotated title matches the approved height')
  const attach = await bounds('[data-agent-action="addContext"]:visible')
  const runtime = await bounds('[data-agent-action="runtime"]:visible')
  const permissions = await bounds('[data-agent-action="permissionMode"]:visible')
  assert.ok(attach.x + attach.width <= runtime.x && runtime.x + runtime.width <= permissions.x)
  assert.ok(runtime.x - attach.x < 40, 'runtime stays next to attachments')
  assert.ok(usage.y + usage.height <= field.y + 1, 'context usage is above the input card')
  assert.ok(field.height <= 85, 'a one-line draft keeps the compact card height')
  assert.equal(
    await panel.locator('.agent-panel-empty:visible, .agent-resource-empty:visible').count(),
    0,
  )
  await panel.getByRole('button', { name: '会话信息' }).click()
  await panel.getByRole('button', { name: '复制完整诊断日志' }).waitFor()
  await panel.getByRole('button', { name: '会话信息' }).click()
  await panel.screenshot({ path: join(evidence, 'studio-chat.png') })
  const visibleRows = panel.locator('[data-conversation-id]:visible')
  for (const [id, label] of [
    [waiting, '待确认'],
    [running, '运行中'],
    [completed, '新完成'],
  ]) {
    await statusButton(label).click()
    assert.equal(await visibleRows.count(), 1)
    assert.equal(await visibleRows.getAttribute('data-conversation-id'), id)
    assert.match(
      await panel.locator('.agent-navigation-list-heading').innerText(),
      new RegExp(label),
    )
    await button('返回会话').click()
  }
  await statusButton('运行中').click()
  await panel.screenshot({ path: join(evidence, 'studio-updates.png') })
  await button('查看全部').click()
  assert.equal(await search.inputValue(), '')
  assert.equal(await visibleRows.count(), 5)
  await button('已归档 0').click()
  await panel.getByText('暂无已归档会话', { exact: true }).waitFor()
  assert.equal(await visibleRows.count(), 0)
  await button('返回会话').click()
  await button('会话列表').click()
  assert.equal(await button('全部会话').getAttribute('aria-pressed'), 'true')
  assert.equal(await visibleRows.count(), 5)
  await button('返回会话').click()
  await statusButton('新完成').click()
  await lookup('校对更新日志').locator('[data-conversation-id]').click()
  assert.equal(await statusButton('新完成').count(), 0)
  for (const label of ['待确认', '运行中']) assert.ok(await statusButton(label).isVisible())
  await button('会话列表').click()
  const target = lookup('发布前检查')
  await target.locator('[data-conversation-id]').click()
  await assertCurrentDraft()
  await button('会话列表').click()
  console.log(
    'PASS: independent status buttons show matching IDs, full list clears filters, empty archive is accessible',
  )
  // Only the isolated main-process write targeted by each test returns a failure.
  async function failWrite(action) {
    await app.evaluate(
      ({ ipcMain }, { id, action }) => {
        const channel = 'workspaceState:setSection'
        const original = ipcMain._invokeHandlers.get(channel)
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (event, ...args) => {
          const record = args[2]?.conversations?.[id]
          const matches =
            args[1] === 'agentConversations' &&
            (action === 'delete'
              ? args[4]?.conversationHistoryMutation?.conversationId === id
              : action === 'archive'
                ? Boolean(record?.archivedAt)
                : record?.archivedAt === null)
          if (!matches) return original(event, ...args)
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, original)
          return {
            success: false,
            error: '验收写盘失败-' + action,
            errorCode: 'workspace_flush_failed',
          }
        })
      },
      { id: active, action },
    )
  }
  async function persistedTarget() {
    return page.evaluate(
      async ({ workspaceKey, id }) => {
        const identity = await window.cclinkStudio.identity.getLocalIdentity()
        const snapshot = await window.cclinkStudio.workspaceState.get(
          workspaceKey,
          'local:' + identity.localId,
        )
        return snapshot.sections.agentConversations.conversations[id] ?? null
      },
      { workspaceKey, id: active },
    )
  }
  const errorToast = (action) =>
    page.getByRole('alert').filter({ hasText: '验收写盘失败-' + action })
  await failWrite('delete')
  await target.getByRole('button', { name: '删除会话' }).click()
  await button('确认删除').click()
  await errorToast('delete').waitFor()
  assert.equal((await persistedTarget()).title, '发布前检查')
  await button('返回会话').click()
  await assertCurrentDraft()
  await panel.screenshot({ path: join(evidence, 'studio-delete-failed-draft.png') })
  await button('会话列表').click()
  console.log('PASS: failed delete retained selected title and the exact composer draft')

  // Delay the real disk write while a user returns to the chat and pastes a new image.
  await app.evaluate(({ ipcMain }, id) => {
    const channel = 'workspaceState:setSection'
    const original = ipcMain._invokeHandlers.get(channel)
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      const mutation = args[4]?.conversationHistoryMutation
      if (mutation?.type === 'delete-conversation' && mutation.conversationId === id) {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, original)
        await new Promise((resolve) => {
          globalThis.finishTestDelete = resolve
        })
      }
      return original(event, ...args)
    })
  }, active)
  await target.getByRole('button', { name: '删除会话' }).click()
  await button('确认删除').click()
  await button('返回会话').click()
  await panel.locator('textarea:visible').evaluate((field) => {
    const canvas = document.createElement('canvas')
    return new Promise((resolve) =>
      canvas.toBlob((blob) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob], 'during-delete.png', { type: 'image/png' }))
        field.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }))
        resolve()
      }),
    )
  })
  const image = panel.getByRole('button', { name: '移除 during-delete.png' })
  await image.waitFor()
  await app.evaluate(() => globalThis.finishTestDelete())
  await page.getByRole('alert').filter({ hasText: '会话内容已更新' }).waitFor()
  assert.equal((await persistedTarget()).title, '发布前检查')
  await assertCurrentDraft()
  assert.ok(await image.isVisible())
  await image.click()
  await button('会话列表').click()
  console.log(
    'PASS: image pasted during pending deletion retained in the selected chat; disk history restored',
  )

  await failWrite('archive')
  await target.getByRole('button', { name: '归档会话' }).click()
  await errorToast('archive').waitFor()
  assert.equal((await persistedTarget()).archivedAt, null)
  assert.equal(await target.getByRole('button', { name: '归档会话' }).isEnabled(), true)
  await button('返回会话').click()
  await assertCurrentDraft()
  await button('会话列表').click()
  await target.getByRole('button', { name: '编辑标题与标注' }).click()
  await panel.getByLabel('个人标注').fill('待回执复核')
  await button('保存').click()
  await panel.screenshot({ path: join(evidence, 'studio-list.png') })
  await target.getByRole('button', { name: '归档会话' }).click()
  await button('已归档 1').click()
  await target.getByRole('button', { name: '恢复会话' }).waitFor()
  await failWrite('restore')
  await target.locator('[data-conversation-id]').click()
  await errorToast('restore').waitFor()
  assert.ok((await persistedTarget()).archivedAt)
  assert.equal(await panel.getAttribute('data-agent-navigation'), 'list')
  assert.equal(await target.getByRole('button', { name: '恢复会话' }).isEnabled(), true)
  await panel.screenshot({ path: join(evidence, 'studio-restore-failed.png') })
  await button('返回会话').click()
  assert.doesNotMatch(
    await panel.locator('.conversation-edit-title:visible').innerText(),
    /发布前检查/,
  )
  await button('会话列表').click()
  await button('已归档 1').click()
  await target.locator('[data-conversation-id]').click()
  await assertCurrentDraft()
  await button('会话列表').click()
  console.log(
    'PASS: failed archive retained chat; failed restoration stayed in archive; retry restored the draft',
  )
  await target.getByRole('button', { name: '删除会话' }).click()
  await button('取消').click()
  await target.getByRole('button', { name: '删除会话' }).click()
  await panel.screenshot({ path: join(evidence, 'studio-delete.png') })
  await button('确认删除').click()
  await target.waitFor({ state: 'detached' })
  await page.getByText('会话已删除', { exact: true }).waitFor()
  assert.equal(await persistedTarget(), null)
  console.log(
    'PASS: chat/list width',
    width,
    'draft, background event, edit, archive, restore, cancel and delete.',
    evidence,
  )

  // Reopen a persisted manual compaction with no matching runtime after restart.
  await lookup('校对更新日志').locator('[data-conversation-id]').click()
  await page.evaluate(
    async ({ workspaceKey, id }) => {
      const api = window.cclinkStudio
      const owner = 'local:' + (await api.identity.getLocalIdentity()).localId
      const state = (await api.workspaceState.get(workspaceKey, owner)).sections.agentConversations
      state.activeConversationId = id
      Object.assign(state.conversations[id], {
        runStatus: 'running',
        activeRunId: 'compact-lost-fixture',
        contextCompaction: {
          status: 'compacting',
          trigger: 'manual',
          preTokens: 80,
          postTokens: null,
          error: null,
          updatedAt: Date.now(),
        },
      })
      const result = await api.workspaceState.setSection(
        workspaceKey,
        'agentConversations',
        state,
        owner,
      )
      if (!result.success) throw new Error(result.error)
    },
    { workspaceKey, id: completed },
  )
  await page.reload()
  await panel.getByText('上下文压缩失败', { exact: true }).first().waitFor()
  const composer = panel.locator('textarea:visible')
  await composer.fill('继续聊天')
  assert.ok(await button('发送').isEnabled())
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('agent:sendMessage')
    ipcMain.handle('agent:sendMessage', (_event, id, payload) => {
      globalThis.recoverySend = { id, message: payload.message }
      return { success: false, error: '验收已收到发送请求' }
    })
  })
  await button('发送').click()
  const ack = panel.getByText('发送失败: 验收已收到发送请求', { exact: true })
  await ack.first().waitFor()
  assert.deepEqual(await app.evaluate(() => globalThis.recoverySend), {
    id: completed,
    message: '继续聊天',
  })
  // Recent commands and category grouping can put the row at a different index than the raw registry.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+p' : 'Control+Shift+p')
  await page.locator('.command-palette-item').filter({ hasText: '重置 Agent 会话' }).click()
  await ack.first().waitFor({ state: 'detached' })
  assert.match(await panel.locator('.conversation-edit-title:visible').innerText(), /校对更新日志/)
  assert.equal(await composer.inputValue(), '继续聊天')
  console.log('PASS: lost compaction displayed a failure after reload and re-enabled sending')
} finally {
  await app?.close()
  await rm(root, { recursive: true, force: true })
}
