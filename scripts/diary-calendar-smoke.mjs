// Real Electron: bottom-left diary calendar, day view, and the Agent panel kept open for questions.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse, shots } from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-calendar-')
const s = await makeHome(root, 'calendar')
const project = join(s.home, '模拟日记项目')
const D = '000-个人计划'
for (const [rel, body] of [
  ['2026/11/1118_周三.md', '# 周三\n## 今日打卡\n| 时间 | 事项 | 花销 |\n| --- | --- | --- |\n| 12:00 | 午饭 | 35 元 |\n'],
  ['2026/11/1118-周三.md', '# 周三补记\n同日第二份\n'],
  ['2026/11/1120_周五.md', '# 周五\n买散热片 120 元\n'],
  ['2026/10/1031_周五.md', '# 十月最后一天\n'],
])
  await writeDiary(project, D, rel, body)
try {
  const page = await s.launch()
  await firstUse(s, { directory: project })
  const calendar = page.getByLabel('日记日历')
  await calendar.waitFor()
  await calendar.getByText('本月 2 篇').waitFor()
  await calendar.getByRole('gridcell', { name: '2026-11-18 有日记' }).click()
  const home = page.locator('.personal-diary-home')
  await home.getByRole('heading', { name: '2026 年 11 月 18 日 周三' }).waitFor()
  await home.getByRole('tab', { name: '1118-周三.md' }).waitFor()
  await home.getByRole('article', { name: '当天日记' }).getByText('35 元').waitFor()
  // The Agent conversation stays open on the right.
  assert(await page.getByPlaceholder(/继续提问|输入消息/).first().isVisible())
  await page.screenshot({ path: join(shots, 'v2-calendar-day.png') })
  await home.getByRole('tab', { name: '1118-周三.md' }).click()
  await home.getByRole('article', { name: '当天日记' }).getByText('同日第二份').waitFor()
  await home.getByRole('button', { name: '下一篇 ›' }).click()
  await home.getByRole('heading', { name: '2026 年 11 月 20 日 周五' }).waitFor()
  await home.getByRole('button', { name: '最近一周花了多少钱' }).click()
  const composer = page.getByPlaceholder(/继续提问|输入消息/).first()
  await page.waitForTimeout(300)
  assert.match(await composer.inputValue(), /最近 7 天的日记，汇总我花了多少钱/)
  await page.screenshot({ path: join(shots, 'v2-calendar-ask.png') })
  // Earlier month and an empty day.
  await calendar.getByRole('button', { name: '上个月' }).click()
  await calendar.getByRole('gridcell', { name: '2026-10-31 有日记' }).click()
  await home.getByRole('heading', { name: '2026 年 10 月 31 日 周六' }).waitFor()
  await calendar.getByRole('gridcell', { name: '2026-10-30' }).click()
  await home.getByText('这天没有日记').waitFor()
  console.log('PASS calendar')
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
