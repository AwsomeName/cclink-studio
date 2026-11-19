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
  const button = (name) => panel.getByRole('button', { name, exact: true })
  await panel.waitFor()
  const width = (await panel.boundingBox()).width
  async function create(title, note) {
    await button('新建对话').click()
    await panel.locator('.conversation-edit-title').click()
    await panel.getByLabel('会话标题').fill(title)
    await panel.getByLabel('个人标注').fill(note)
    await button('保存').click()
  }
  const quietHeader = await panel.locator('.agent-workspace-header').boundingBox()
  const quietSwitch = await button('会话列表').boundingBox()
  assert.equal(quietHeader.x + quietHeader.width - quietSwitch.x - quietSwitch.width, 8)
  assert.equal(quietHeader.height, 39)
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
        if (conversationId === completed)
          contents.send('agent:runStatus', {
            ...record,
            status: 'succeeded',
            updatedAt: now + 1,
            completedAt: now + 1,
          })
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
  const summary = '1 待确认 · 1 运行中 · 1 新完成'
  // In the approved chat layout usage sits above the field, and a draft has no welcome card.
  const bounds = async (selector) => {
    const box = await panel.locator(selector).boundingBox()
    assert.ok(box, selector + ' must be visible')
    return box
  }
  const header = await bounds('.agent-workspace-header')
  const field = await bounds('.agent-input-card:visible')
  const usage = await bounds('.agent-chat-usage-button:visible')
  assert.equal(header.height, quietHeader.height)
  const newChat = await bounds('.agent-workspace-new-conversation')
  const listButton = await bounds('.agent-workspace-switch')
  assert.equal(listButton.y, newChat.y, 'both navigation buttons share one row')
  assert.equal(listButton.height, newChat.height)
  const activity = await bounds('.agent-other-updates')
  assert.equal(activity.y, newChat.y, 'activity shares the primary navigation row')
  assert.ok(newChat.x + newChat.width <= activity.x)
  assert.ok(activity.x + activity.width <= listButton.x)
  assert.deepEqual(listButton, quietSwitch, 'activity must not move or resize the list button')
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
  assert.equal(await updates.getAttribute('aria-label'), '其他会话动态：' + summary)
  await panel.screenshot({ path: join(evidence, 'studio-chat.png') })
  await updates.click()
  const visibleRows = panel.locator('[data-conversation-id]:visible')
  assert.equal(await visibleRows.count(), 3)
  const expected = [
    [completed, '新完成'],
    [waiting, '待确认'],
    [running, '运行中'],
  ]
  for (const [id, label] of expected) {
    const preview = panel.locator(
      '[data-conversation-id="' + id + '"] .session-sidebar-row-preview:visible',
    )
    assert.ok((await preview.innerText()).startsWith(label))
  }
  await panel.screenshot({ path: join(evidence, 'studio-updates.png') })
  await button('查看全部').click()
  assert.equal(await search.inputValue(), '发布前检查')
  assert.equal(await visibleRows.count(), 1)
  await search.fill('')
  await button('返回会话').click()
  await updates.click()
  await lookup('校对更新日志').locator('[data-conversation-id]').click()
  // The viewed completion disappears without affecting the other two counts.
  assert.equal(await updates.getAttribute('aria-label'), '其他会话动态：1 待确认 · 1 运行中')
  await button('会话列表').click()
  const target = lookup('发布前检查')
  await target.locator('[data-conversation-id]').click()
  await assertCurrentDraft()
  await button('会话列表').click()
  console.log(
    'PASS: retained search, exact three status counts and conversation IDs, read completion cleared',
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
  await panel.getByTitle('展开已归档').click()
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
} finally {
  await app?.close()
  await rm(root, { recursive: true, force: true })
}
