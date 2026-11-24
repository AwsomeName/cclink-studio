// Real Electron: bottom-left diary calendar, day view, and the Agent panel kept open for questions.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  makeRoot,
  makeHome,
  writeDiary,
  firstUse,
  shots,
  SPACE_DIARY,
} from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-calendar-')
const s = await makeHome(root, 'calendar')
const project = join(s.home, '模拟日记项目')
const D = '000-个人计划'
for (const [rel, body] of [
  [
    '2026/11/1118_周三.md',
    '# 周三\n## 今日打卡\n| 时间 | 事项 | 花销 |\n| --- | --- | --- |\n| 12:00 | 午饭 | 35 元 |\n',
  ],
  ['2026/11/1118-周三.md', '# 周三补记\n同日第二份\n'],
  ['2026/11/1120_周五.md', '# 周五\n买散热片 120 元\n'],
  ['2026/10/1031_周五.md', '# 十月最后一天\n'],
])
  await writeDiary(project, D, rel, body)
try {
  const page = await s.launch()
  const space = await firstUse(s, { importFrom: project })
  const calendar = page.getByLabel('日记日历')
  await calendar.waitFor()
  await calendar.getByText('本月 2 篇').waitFor()
  await calendar.getByRole('gridcell', { name: '2026-11-18 有日记' }).click()
  const home = page.locator('.personal-diary-home')
  const day = home.getByRole('article', { name: '当天日记' })
  const switcher = home.getByLabel('切换日期')
  // Same layout as 今天: no big 日记 title, no 问 AI buttons; the day's file is open to edit.
  assert.equal(await home.getByRole('heading', { name: '日记', exact: true }).count(), 0)
  assert.equal(await home.getByText('问 AI：').count(), 0)
  const sameDay = home.getByLabel('当天的日记')
  await sameDay.waitFor()
  assert.equal(await sameDay.locator('option:checked').innerText(), '1118_周三.md')
  await day.getByText('35 元').waitFor()
  // Directly editable: typing in the day view saves to the file.
  const editor = day.locator('.tiptap[contenteditable=true]')
  await editor.getByText('周三', { exact: true }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('（补记）')
  const file = join(space, SPACE_DIARY, '2026/11/1118_周三.md')
  let saved = ''
  for (let i = 0; i < 30 && !saved.includes('（补记）'); i += 1) {
    await page.waitForTimeout(500)
    saved = await readFile(file, 'utf8')
  }
  assert(saved.includes('# 周三（补记）'), saved)
  // The Agent conversation stays open on the right.
  assert(
    await page
      .getByPlaceholder(/继续提问|输入消息/)
      .first()
      .isVisible(),
  )
  await page.screenshot({ path: join(shots, 'v2-calendar-day.png') })
  await sameDay.selectOption({ label: '1118-周三.md' })
  await day.getByText('同日第二份').waitFor()
  await home.getByRole('button', { name: '下一篇' }).click()
  await switcher.getByText('1120_周五.md').waitFor()
  await day.getByText('买散热片 120 元').waitFor()
  // Earlier month and an empty day.
  await calendar.getByRole('button', { name: '上个月' }).click()
  await calendar.getByRole('gridcell', { name: '2026-10-31 有日记' }).click()
  await switcher.getByText('1031_周五.md').waitFor()
  await calendar.getByRole('gridcell', { name: '2026-10-30' }).click()
  await home.getByText('这天没有日记').waitFor()
  console.log('PASS calendar')
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
