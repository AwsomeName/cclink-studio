// Real Electron, second-version design: first use in four steps, nothing created before
// confirmation, built-in tasks enabled on confirm, and today's draft generated automatically.
import assert from 'node:assert/strict'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, shots } from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-v2-first-')
const s = await makeHome(root, 'first')
const defaultDir = join(s.home, 'CCLink Studio', '我的空间')
const result = {}
try {
  const page = await s.launch()
  page.on('dialog', (d) => void d.accept())
  // A new user lands on first use directly; nothing exists on disk yet.
  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  await wizard.getByRole('button', { name: '开始使用' }).waitFor()
  await wizard.getByText(defaultDir).waitFor()
  // One page: no step bar, no AI step.
  assert.equal(await wizard.getByRole('button', { name: '下一步' }).count(), 0)
  assert.equal(await wizard.getByText(/测试：生成一句话/).count(), 0)
  assert.equal(await lstat(defaultDir).catch(() => null), null, 'default folder must not exist yet')
  // Set the daily time to 00:00 so starting generates today's draft right away.
  await wizard.getByLabel('每日起草时间').fill('00:00')
  await page.screenshot({ path: join(shots, 'v3-first-use-one-page.png') })
  await wizard.getByRole('button', { name: '开始使用' }).click()
  await wizard.waitFor({ state: 'detached', timeout: 30000 })
  assert.equal(await s.fixedRoot(), defaultDir)
  const tasks = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), defaultDir)
  result.tasks = tasks.tasks.map((t) => ({
    title: t.definition.title,
    enabled: t.activation.enabled,
  }))
  assert.deepEqual(Object.fromEntries(result.tasks.map((t) => [t.title, t.enabled])), {
    每日起草: true,
    周度计划: true,
    月度计划: false,
    年度计划: false,
  })
  const home = page.locator('.personal-diary-home')
  await home
    .getByText(/AI 正在起草|自动生成今天的草稿|今天的日记/)
    .first()
    .waitFor()
  await page.screenshot({ path: join(shots, 'v2-today-drafting.png') })
  await home.getByRole('article', { name: '今天的日记' }).waitFor({ timeout: 5 * 60_000 })
  await page.screenshot({ path: join(shots, 'v2-today-generated.png') })
  // Today's file is open right on the home page and can be typed into and saved directly.
  const todayEditor = home
    .getByRole('article', { name: '今天的日记' })
    .locator('.tiptap[contenteditable=true]')
  await todayEditor.waitFor()
  await todayEditor.click()
  await page.keyboard.press('Meta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.insertText('首页直接写的一行')
  // Markdown shortcuts work in the embedded editor exactly as in a Markdown tab (⌘B, ⌘S).
  const saveState = page.locator('.diary-today-editor .toolbar-save-control')
  await page.keyboard.press('Meta+b')
  await page.keyboard.insertText('粗体')
  await page.keyboard.press('Meta+b')
  await saveState.filter({ hasText: '保存' }).waitFor()
  await page.keyboard.press('Meta+s')
  await saveState.filter({ hasText: '已保存' }).waitFor()
  const written = await page.evaluate(
    async (dir) => {
      const walk = async (d) => {
        for (const e of await window.cclinkStudio.fs.readDir(d)) {
          if (e.type === 'directory') {
            const found = await walk(e.path)
            if (found) return found
          } else if (/^\d{4}_.+\.md$/.test(e.name))
            return (await window.cclinkStudio.fs.readTextDocument(e.path)).content
        }
        return ''
      }
      return walk(dir)
    },
    join(defaultDir, '个人计划'),
  )
  assert(written.includes('首页直接写的一行'), 'typing on the home page did not save to the file')
  assert(written.includes('**粗体**'), '⌘B did not bold in the embedded editor: ' + written)
  await page.screenshot({ path: join(shots, 'v3-today-editable.png') })
  // The status bar stays one line even in a narrow window.
  await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700))
  await page.waitForTimeout(500)
  const wrapped = await page.evaluate(() => {
    const bar = document.querySelector('.status-bar')
    const limit = bar.getBoundingClientRect().height
    return [...bar.querySelectorAll('.status-bar-left > *, .status-bar-right > *')]
      .filter((el) => el.getBoundingClientRect().height > limit + 1)
      .map((el) => el.textContent)
  })
  assert.deepEqual(wrapped, [], 'status bar items wrapped: ' + wrapped.join(' | '))
  // My Space has no header row; the editor toolbar shows the Markdown save state and stays one
  // line. AI edits go through the conversation panel, so there is no 让 AI 修改 button.
  assert.equal(await page.locator('.project-home-header').count(), 0, 'no header row')
  const toolbar = page.locator('.diary-today-editor .editor-toolbar')
  await toolbar.locator('.toolbar-save-control').filter({ hasText: '已保存' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '让 AI 修改…' }).count(), 0)
  await page.getByRole('button', { name: '项目设置', exact: true }).waitFor()
  const actionsTop = await page.evaluate(() => {
    const a = document.querySelector('.diary-today-actions').getBoundingClientRect()
    const t = document.querySelector('.diary-today-editor .editor-toolbar').getBoundingClientRect()
    return { a: a.height, t: t.height }
  })
  assert(actionsTop.a < 32, 'toolbar actions wrapped: ' + JSON.stringify(actionsTop))
  await page.screenshot({ path: join(shots, 'v3-status-bar-narrow.png') })
  const month = join(defaultDir, '个人计划')
  const years = await readdir(month)
  result.files = years
  console.log('PASS v2 first use', JSON.stringify(result))
} catch (e) {
  console.log('PARTIAL', JSON.stringify(result))
  await s.fail(e)
} finally {
  await s.close()
}
