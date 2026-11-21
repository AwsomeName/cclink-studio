// Real Electron: today/continue writing, history, plans, editing, and returning to the file.
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, confirmExisting, shots } from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-daily-')
const s = await makeHome(root, 'daily')
const project = join(s.home, '模拟日记项目')
const D = '000-个人计划'
const now = new Date()
const parts = Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
    .formatToParts(now)
    .map((p) => [p.type, p.value]),
)
const weekday = {
  Mon: '周一',
  Tue: '周二',
  Wed: '周三',
  Thu: '周四',
  Fri: '周五',
  Sat: '周六',
  Sun: '周日',
}[parts.weekday]
const todayRel = `${parts.year}/${parts.month}/${parts.month}${parts.day}_${weekday}.md`
const originals = new Map()
for (const [rel, body] of [
  ['2026/11/1118_周三.md', '# 下划线版\n同日第一份\n'],
  ['2026/11/1118-周三.md', '# 短横线版\n同日第二份\n'],
  ['2026/07-08/0715_周三.md', '# 合并月份\n七月记录\n'],
  ['2026/11/1117_周二.md', '# 周二\n![图](1117_周二.assets/a.png)\n'],
  ['2026/周计划/第47周.md', '# 第47周计划\n'],
  ['一日生活计划.md', '# 一日生活计划\n'],
  ['项目记录/2026-11-01.md', '# 项目记录不是日记\n'],
])
  originals.set(rel, await writeDiary(project, D, rel, body))
await mkdir(join(project, D, '2026/11/1117_周二.assets'), { recursive: true })
await writeFile(join(project, D, '2026/11/1117_周二.assets/a.png'), 'png')
const other = join(s.home, '普通项目')
await mkdir(other)
await writeFile(join(other, 'README.md'), '# 普通项目\n')

const bodies = async () =>
  Object.fromEntries(
    await Promise.all([...originals].map(async ([k, f]) => [k, await readFile(f, 'utf8')])),
  )
try {
  const page = await s.launch()
  const before = await bodies()
  await confirmExisting(s, project)
  const home = page.locator('.personal-diary-home')
  // Today: no diary yet -> one click creates exactly one file; a second attempt reuses it.
  await home.getByRole('button', { name: '创建今日空白模板', exact: true }).click()
  await home.getByText('已新建今日空白模板', { exact: false }).waitFor()
  assert.equal(await home.getByRole('button', { name: '创建今日空白模板', exact: true }).count(), 0)
  const again = await page.evaluate(
    async (owner) =>
      window.cclinkStudio.workspaceState.diaryDocument({ action: 'prepare', workspacePath: owner }),
    project,
  )
  assert.equal(again.created, false)
  assert.equal(again.path, join(project, D, todayRel))
  const monthFiles = (await readdir(join(project, D, parts.year, parts.month))).filter((n) =>
    n.startsWith(parts.month + parts.day),
  )
  assert.deepEqual(monthFiles, [todayRel.split('/').pop()])
  await page.screenshot({ path: join(shots, 'daily-today.png') })
  // History: merged month, both same-day names listed; project records excluded.
  await page
    .locator('.personal-diary-sidebar, .workspace-sidebar-shell')
    .getByRole('button', { name: '日记', exact: true })
    .first()
    .click()
  for (const name of ['1118_周三.md', '1118-周三.md', '0715_周三.md', '1117_周二.md'])
    await home.locator('.workspace-home-record').filter({ hasText: name }).first().waitFor()
  assert.equal(
    await home.locator('.workspace-home-record').filter({ hasText: '2026-11-01.md' }).count(),
    0,
  )
  await home.locator('.workspace-home-record').filter({ hasText: '1118-周三.md' }).click()
  await home.getByRole('article', { name: '日记正文预览' }).getByText('同日第二份').waitFor()
  await page.screenshot({ path: join(shots, 'daily-history.png') })
  // Plans: weekly and long-term plans, not diaries or project records.
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '计划', exact: true })
    .first()
    .click()
  await home.locator('.workspace-home-record').filter({ hasText: '第47周.md' }).waitFor()
  await home.locator('.workspace-home-record').filter({ hasText: '一日生活计划.md' }).waitFor()
  assert.equal(
    await home.locator('.workspace-home-record').filter({ hasText: '1118_周三.md' }).count(),
    0,
  )
  await page.screenshot({ path: join(shots, 'daily-plans.png') })
  // Edit today's file in the editor tab and save back to the same Markdown.
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '项目首页', exact: true })
    .first()
    .click()
  await home.getByRole('button', { name: '继续写原文', exact: true }).click()
  const editor = page.locator('.ProseMirror').first()
  await editor.waitFor()
  await editor.click()
  await page.keyboard.press('Meta+End')
  await page.keyboard.type('模拟续写一行')
  await page.keyboard.press('Meta+s')
  for (let i = 0; i < 50; i++) {
    if ((await readFile(again.path, 'utf8')).includes('模拟续写一行')) break
    await page.waitForTimeout(100)
  }
  assert((await readFile(again.path, 'utf8')).includes('模拟续写一行'))
  await page.keyboard.type('未保存内容')
  await page.screenshot({ path: join(shots, 'daily-editing.png') })
  // Switch the single-column sidebar to files: the open diary is located and highlighted.
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '文件', exact: true })
    .first()
    .click()
  await page
    .locator('.file-tree-item.selected')
    .filter({ hasText: todayRel.split('/').pop() })
    .waitFor()
  await page.screenshot({ path: join(shots, 'daily-file-tree.png') })
  // Switch to another project and back: the tab, unsaved text and tree location survive.
  await s.pickDirectory(other)
  await page.locator('.app-topbar-open-project').first().click()
  await page.getByRole('button', { name: /打开已有项目/ }).click()
  await page.locator(`.project-strip-item[data-project-path="${other}"].active`).waitFor()
  await page.locator(`.project-strip-item[data-project-path="${project}"]`).click()
  await page.locator(`.project-strip-item[data-project-path="${project}"].active`).waitFor()
  // Returning shows the project home; the editor tab is still there with the edited text.
  await page
    .locator('.tab-item, [role="tab"]')
    .filter({ hasText: todayRel.split('/').pop() })
    .first()
    .click()
  await page
    .locator('.ProseMirror')
    .getByText(/模拟续写一行.*未保存内容/)
    .waitFor()
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '文件', exact: true })
    .first()
    .click()
  await page
    .locator('.file-tree-item.selected')
    .filter({ hasText: todayRel.split('/').pop() })
    .waitFor()
  await page.screenshot({ path: join(shots, 'daily-return-after-switch.png') })
  const after = await bodies()
  assert.deepEqual(after, before)
  console.log('PASS daily', { today: again.path })
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
