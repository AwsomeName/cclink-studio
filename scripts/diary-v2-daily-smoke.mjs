// Real Electron + real git + real local Codex: second-version daily use. Simulated data only;
// the only remote is a bare repository inside the test folder.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse, shots } from './diary-acceptance-lib.mjs'

const exec = promisify(execFile)
const git = async (cwd, args) =>
  (
    await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    })
  ).stdout.trim()
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
const todayRel = `${p.year}/${p.month}/${p.month}${p.day}_${wd}.md`
const D = '000-个人计划'

const root = await makeRoot('.cclink-v2-daily-')
const s = await makeHome(root, 'daily')
const project = join(s.home, '模拟日记项目')
for (const [rel, body] of [
  ['2026/11/1118_周三.md', '# 下划线版\n## 昨日总结\n同日第一份\n'],
  ['2026/11/1118-周三.md', '# 短横线版\n同日第二份\n'],
  ['2026/11/11月杂记.md', '# 没有日期的文稿\n'],
  ['2026/11/1117_周二.md', '# 周二\n<div align="center">原始 HTML</div>\n'],
  ['2026/07-08/0715_周三.md', '# 合并月份\n七月记录\n'],
  ['2026/周计划/第47周.md', '# 第47周计划\n'],
  ['一日生活计划.md', '# 一日生活计划\n'],
  ['项目记录/2026-11-01.md', '# 项目记录不是日记\n'],
])
  await writeDiary(project, D, rel, body)
const remote = join(s.home, 'remote.git')
const seed = join(s.home, '另一台设备')
await git(s.home, ['init', '--bare', '--initial-branch=main', remote])
const S = '个人计划'
// Another device already set up the same address and wrote today's diary.
await git(s.home, ['clone', remote, seed])
await writeDiary(seed, S, todayRel, '# 另一台设备写的今天\n## 今日待做\n- [ ] 复查电源方案\n')
await git(seed, ['add', '.'])
await git(seed, ['commit', '-m', 'today'])
await git(seed, ['push', 'origin', 'HEAD:main'])
const result = {}
let space
try {
  const page = await s.launch()
  page.on('dialog', (d) => void d.accept())
  // History is copied in from the old project; My Space syncs to its own address.
  space = await firstUse(s, {
    importFrom: project,
    url: remote,
    shot: join(shots, 'v3-first-import-daily.png'),
  })
  const home = page.locator('.personal-diary-home')
  const nav = (name) =>
    page
      .locator('.workspace-sidebar-shell')
      .getByRole('button', { name, exact: true })
      .first()
      .click()

  // Today: first use took back the other device's diary first, so it opens as is (no new draft).
  const todayArticle = home.getByRole('article', { name: '今天的日记' })
  await todayArticle.getByText('复查电源方案').waitFor({ timeout: 60000 })
  assert.equal(
    await readFile(join(space, S, todayRel), 'utf8'),
    '# 另一台设备写的今天\n## 今日待做\n- [ ] 复查电源方案\n',
  )
  await page.screenshot({ path: join(shots, 'v2-today-synced.png') })

  // Tasks: listed directly, both enabled on this device, no linking checkboxes.
  await nav('定时整理')
  await home.getByText('每日起草').first().waitFor()
  assert.equal(await home.getByRole('checkbox').count(), 0)
  await page.screenshot({ path: join(shots, 'v2-tasks.png') })

  // History via the bottom-left calendar: same-day pair as tabs, merged month folder placed by
  // the date in the file name, project records not counted.
  const calendar = page.getByLabel('日记日历')
  await calendar.getByRole('gridcell', { name: '2026-11-18 有日记' }).click()
  // Same-day pair: one dropdown beside the file name, no separate switch row.
  const sameDay = home.getByLabel('当天的日记')
  await sameDay.waitFor()
  assert.deepEqual(await sameDay.locator('option').allInnerTexts(), [
    '1118_周三.md',
    '1118-周三.md',
  ])
  assert.equal(await calendar.getByRole('gridcell', { name: '2026-11-01 有日记' }).count(), 0)
  await page.screenshot({ path: join(shots, 'v2-history.png') })
  for (let i = 0; i < 12 && !(await calendar.getByText('2026 年 7 月').isVisible()); i++)
    await calendar.getByRole('button', { name: '上个月' }).click()
  await calendar.getByRole('gridcell', { name: '2026-07-15 有日记' }).click()
  await home.getByLabel('切换日期').getByText(/^0715/).waitFor()

  // An HTML fragment stays inside the editable diary.
  for (let i = 0; i < 12 && !(await calendar.getByText('2026 年 11 月').isVisible()); i++)
    await calendar.getByRole('button', { name: '下个月' }).click()
  await calendar.getByRole('gridcell', { name: '2026-11-17 有日记' }).click()
  const dayEditor = home
    .getByRole('article', { name: '当天日记' })
    .locator('.tiptap[contenteditable=true]')
  const literal = dayEditor.locator('.markdown-literal-block')
  await literal.waitFor()
  assert.equal(await literal.textContent(), '<div align="center">原始 HTML</div>')
  assert.equal(await dayEditor.locator('h1').textContent(), '周二')
  assert.equal(await page.getByText('文档未被改写').count(), 0)
  await page.screenshot({ path: join(shots, 'v2-html-source.png') })

  // Plans grouped.
  await nav('计划')
  await home.getByText('周度').first().waitFor()
  await page.screenshot({ path: join(shots, 'v2-plans.png') })

  await nav('今天')
  await todayArticle.waitFor({ timeout: 60000 })

  // AI edit on request: the change lands in today's file and shows in the open editor;
  // the today page shows no change report.
  const before = await readFile(join(space, S, todayRel), 'utf8')
  // AI edits go through the conversation panel on the right (no 让 AI 修改 button).
  const composer = page.getByPlaceholder(/继续提问|输入消息/).first()
  await composer.waitFor()
  await composer.click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type(
    `请修改今天的日记 ${join(space, S, todayRel)}：在「今日待做」下新增一条任务：- [ ] 联系散热片供应商。只改这一处，不要改其他内容。`,
  )
  await page.keyboard.press('Enter')
  // A Codex file change may ask once in the default 自动 permission mode; approve it if it does.
  const allow = page.getByRole('button', { name: /^允许/ }).first()
  let edited = before
  for (let i = 0; i < 300 && !edited.includes('散热片'); i += 1) {
    if (await allow.isVisible().catch(() => false)) await allow.click()
    await page.waitForTimeout(1000)
    edited = await readFile(join(space, S, todayRel), 'utf8')
  }
  result.aiEdit = { changed: edited !== before, mentions: edited.includes('散热片') }
  assert(edited.includes('散热片'))
  await todayArticle.getByText('联系散热片供应商').waitFor({ timeout: 30000 })
  assert.equal(await page.getByRole('article', { name: 'AI 改动报告' }).count(), 0)
  await page.screenshot({ path: join(shots, 'v2-ai-edit-applied.png') })

  // In-place pull after review.
  await git(seed, ['pull', '--no-rebase', 'origin', 'main'])
  await writeDiary(seed, S, '2026/11/1119_周四.md', '# 周四\n来自另一台设备\n')
  await git(seed, ['add', '.'])
  await git(seed, ['commit', '-m', 'thursday'])
  await git(seed, ['push'])
  await page.locator('.status-bar .diary-sync').click()
  await page
    .getByRole('region', { name: '我的空间同步' })
    .getByRole('button', { name: '同步', exact: true })
    .click()
  await page.locator('.status-bar .diary-sync').filter({ hasText: '已同步' }).waitFor()
  assert.equal(
    await readFile(join(space, S, '2026/11/1119_周四.md'), 'utf8'),
    '# 周四\n来自另一台设备\n',
  )
  assert.equal(await s.fixedRoot(), space)
  // The old project stays as it was: no repository, no My Space settings.
  assert.equal(
    await readFile(join(project, '.cclink-studio/workspace-settings.json')).catch(() => null),
    null,
  )
  await page.screenshot({ path: join(shots, 'v2-git-pulled.png') })
  console.log('PASS v2 daily', JSON.stringify(result))
} catch (e) {
  console.log('PARTIAL', JSON.stringify(result))
  await s.fail(e)
} finally {
  await s.close()
}
