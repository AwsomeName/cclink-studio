// Real Electron: My Space 文件 opens below the navigation, positions on today's diary, offers
// quick entries, marks uncommitted files and asks before a rename that unrecognizes a diary.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse, shots } from './diary-acceptance-lib.mjs'

const exec = promisify(execFile)
const git = (cwd, args) =>
  exec('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  })
const TZ = 'Asia/Shanghai'
const p = Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
    .formatToParts(new Date())
    .map((x) => [x.type, x.value]),
)
const wd = {
  Mon: '周一',
  Tue: '周二',
  Wed: '周三',
  Thu: '周四',
  Fri: '周五',
  Sat: '周六',
  Sun: '周日',
}[p.weekday]
const todayName = `${p.month}${p.day}_${wd}.md`
const D = '个人计划'
const root = await makeRoot('.cclink-files-')
const s = await makeHome(root, 'files')
const project = join(s.home, '我的日记')
await writeDiary(project, D, `${p.year}/${p.month}/${todayName}`, '# 今天\n')
await writeDiary(project, D, `${p.year}/${p.month}/0101_周四.md`, '# 旧的一篇\n')
await writeDiary(project, D, `${p.year}/周计划/第47周.md`, '# 第47周\n')
await writeDiary(project, D, '资料/说明.md', '# 资料\n')
let space
try {
  const page = await s.launch()
  page.on('dialog', (d) => void d.dismiss())
  space = await firstUse(s, { importFrom: project })
  // My Space is its own repository: simulate one earlier upload, then a local edit.
  await git(space, ['init', '--initial-branch=main'])
  await git(space, ['add', '.'])
  await git(space, ['commit', '-m', 'init'])
  await writeFile(join(space, D, `${p.year}/${p.month}/0101_周四.md`), '# 旧的一篇\n本地改动\n')
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '文件' })
    .first()
    .click()
  // Navigation stays; the tree opens below it.
  await page.locator('.diary-inline-files').waitFor()
  await page
    .locator('.diary-inline-files')
    .getByRole('button', { name: '今天', exact: true })
    .first()
    .waitFor()
  assert.equal(await page.getByText('项目导航').count(), 0)
  await page.locator('.file-tree-item.selected').filter({ hasText: todayName }).waitFor()
  await page
    .locator('.file-tree-item')
    .filter({ hasText: '0101_周四.md' })
    .locator('.diary-file-badge')
    .filter({ hasText: '未上传' })
    .waitFor({ timeout: 30000 })
  await page.screenshot({ path: join(shots, 'v2-files-inline.png') })
  // Quick entries.
  const quick = page.getByLabel('日记快捷入口')
  await quick.getByRole('button', { name: '本周计划' }).click()
  await page.locator('.ProseMirror').getByText('第47周').waitFor()
  await quick.getByRole('button', { name: '资料', exact: true }).click()
  await page.locator('.file-tree-item.selected').filter({ hasText: '资料' }).waitFor()
  // Rename that would unrecognize a diary asks first; dismissing keeps the file.
  const old = page.locator('.file-tree-item').filter({ hasText: '0101_周四.md' }).first()
  await old.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重命名' }).click()
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('杂记.md')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  const names = await readdir(join(space, D, `${p.year}/${p.month}`))
  assert(names.includes('0101_周四.md') && !names.includes('杂记.md'), names.join(','))
  // My Space root does not contain an Owner affairs folder.
  assert(!(await readdir(space)).includes('Owner 事务'))
  console.log('PASS files')
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
