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
await git(project, ['init', '--initial-branch=main'])
await git(project, ['add', '.'])
await git(project, ['commit', '-m', 'init'])
await git(project, ['remote', 'add', 'origin', remote])
await git(project, ['push', '-u', 'origin', 'main'])
const result = {}
try {
  const page = await s.launch()
  page.on('dialog', (d) => void d.accept())
  await firstUse(s, { directory: project, shot: join(shots, 'v2-first-existing.png') })
  const home = page.locator('.personal-diary-home')
  const nav = (name) =>
    page
      .locator('.workspace-sidebar-shell')
      .getByRole('button', { name, exact: true })
      .first()
      .click()

  // Today: waiting for the automatic draft at the configured time.
  await home.getByText(/23:59.*自动生成今天的草稿/).waitFor()
  // First use wrote settings and task definitions: shown as local changes to upload.
  await home.getByText('本地有未上传的改动').waitFor({ timeout: 30000 })
  await page.screenshot({ path: join(shots, 'v2-today-waiting.png') })

  // Tasks: listed directly, both enabled on this device, no linking checkboxes.
  await nav('定时整理')
  await home.getByText('每日起草').first().waitFor()
  assert.equal(await home.getByRole('checkbox').count(), 0)
  await page.screenshot({ path: join(shots, 'v2-tasks.png') })

  // History via the bottom-left calendar: same-day pair as tabs, merged month folder placed by
  // the date in the file name, project records not counted.
  const calendar = page.getByLabel('日记日历')
  await calendar.getByRole('gridcell', { name: '2026-11-18 有日记' }).click()
  await home.getByRole('tab', { name: '1118_周三.md' }).waitFor()
  await home.getByRole('tab', { name: '1118-周三.md' }).waitFor()
  assert.equal(await calendar.getByRole('gridcell', { name: '2026-11-01 有日记' }).count(), 0)
  await page.screenshot({ path: join(shots, 'v2-history.png') })
  for (let i = 0; i < 12 && !(await calendar.getByText('2026 年 7 月').isVisible()); i++)
    await calendar.getByRole('button', { name: '上个月' }).click()
  await calendar.getByRole('gridcell', { name: '2026-07-15 有日记' }).click()
  await home.getByRole('heading', { name: '2026 年 7 月 15 日 周三' }).waitFor()

  // A file with raw HTML opens in source mode instead of being refused.
  for (let i = 0; i < 12 && !(await calendar.getByText('2026 年 11 月').isVisible()); i++)
    await calendar.getByRole('button', { name: '下个月' }).click()
  await calendar.getByRole('gridcell', { name: '2026-11-17 有日记' }).click()
  await home.getByRole('button', { name: '继续写' }).click()
  await page.getByRole('button', { name: '切到正文' }).waitFor()
  assert.equal(await page.getByText('文档未被改写').count(), 0)
  await page.screenshot({ path: join(shots, 'v2-html-source.png') })

  // Plans grouped.
  await nav('计划')
  await home.getByText('第47周.md').waitFor()
  await home.getByText('一日生活计划.md').waitFor()
  await page.screenshot({ path: join(shots, 'v2-plans.png') })

  // Sync before drafting: another device already pushed today's diary.
  await git(project, ['add', '-A'])
  await git(project, ['commit', '-m', '我的空间设置与内置任务'])
  await git(project, ['push'])
  await git(s.home, ['clone', remote, seed])
  await writeDiary(seed, D, todayRel, '# 另一台设备写的今天\n## 今日待做\n- [ ] 复查电源方案\n')
  await git(seed, ['add', '.'])
  await git(seed, ['commit', '-m', 'today'])
  await git(seed, ['push'])
  await nav('项目首页')
  await home.getByRole('button', { name: '现在起草' }).click()
  await page.waitForFunction(async (root) => {
    const service = window.cclinkStudio.scheduledTasks
    const daily = (await service.list(root)).tasks.find((t) => t.definition.title === '每日起草')
    return (await service.listRuns(root, daily.definition.id)).runs[0]?.status === 'skipped'
  }, project)
  await page.locator('.status-bar .diary-sync').click()
  await page
    .getByRole('region', { name: '我的空间同步' })
    .getByRole('button', { name: '同步', exact: true })
    .click()
  await page.locator('.status-bar .diary-sync').filter({ hasText: '已同步' }).waitFor()
  await nav('项目首页')
  await home.getByRole('article', { name: '今天的日记' }).waitFor({ timeout: 60000 })
  assert.equal(
    await readFile(join(project, D, todayRel), 'utf8'),
    '# 另一台设备写的今天\n## 今日待做\n- [ ] 复查电源方案\n',
  )
  const runs = await page.evaluate(async (path) => {
    const list = await window.cclinkStudio.scheduledTasks.list(path)
    const daily = list.tasks.find((t) => t.definition.title === '每日起草')
    return (await window.cclinkStudio.scheduledTasks.listRuns(path, daily.definition.id)).runs
  }, project)
  result.presync = { status: runs[0].status, step: runs[0].currentStep }
  assert.equal(runs[0].status, 'skipped')
  await page.screenshot({ path: join(shots, 'v2-today-synced.png') })

  // AI edit on request, change report, undo.
  const before = await readFile(join(project, D, todayRel), 'utf8')
  await home.getByRole('button', { name: '让 AI 修改…' }).click()
  const composer = page.getByPlaceholder(/继续提问|输入消息/).first()
  await composer.waitFor()
  await composer.click()
  await page.keyboard.press('Meta+ArrowDown')
  await page.keyboard.type(
    '在「今日待做」下新增一条任务：- [ ] 联系散热片供应商。只改这一处，不要改其他内容。',
  )
  await page.keyboard.press('Enter')
  await home.getByRole('article', { name: 'AI 改动报告' }).waitFor({ timeout: 5 * 60_000 })
  const edited = await readFile(join(project, D, todayRel), 'utf8')
  result.aiEdit = { changed: edited !== before, mentions: edited.includes('散热片') }
  assert(edited.includes('散热片'))
  await page.screenshot({ path: join(shots, 'v2-ai-change-report.png') })
  await home.getByRole('button', { name: '撤销本次修改' }).click()
  await home.getByText(/已撤销 1 个文件/).waitFor()
  assert.equal(await readFile(join(project, D, todayRel), 'utf8'), before)
  await page.screenshot({ path: join(shots, 'v2-ai-change-undone.png') })

  // In-place pull after review.
  await writeDiary(seed, D, '2026/11/1119_周四.md', '# 周四\n来自另一台设备\n')
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
    await readFile(join(project, D, '2026/11/1119_周四.md'), 'utf8'),
    '# 周四\n来自另一台设备\n',
  )
  assert.equal(await s.fixedRoot(), project)
  await page.screenshot({ path: join(shots, 'v2-git-pulled.png') })
  console.log('PASS v2 daily', JSON.stringify(result))
} catch (e) {
  console.log('PARTIAL', JSON.stringify(result))
  await s.fail(e)
} finally {
  await s.close()
}
