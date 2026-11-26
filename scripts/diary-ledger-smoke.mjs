// Real Electron: My Space 财务 / 健康 pages (docs/design/my-space-finance-health-2026-11-25/mockup-v3.html,
// mockup-v5.html for the sleep / exercise / bowel charts and the folded details).
// Isolated home/profile and simulated diaries; nothing touches the real My Space.
//   pnpm exec electron-vite build --outDir .cache/diary-build && node scripts/diary-ledger-smoke.mjs
import assert from 'node:assert/strict'
import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse } from './diary-acceptance-lib.mjs'

const shots = resolve('docs/design/my-space-finance-health-2026-11-25/acceptance')
await mkdir(shots, { recursive: true })
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
// Days in the diary timezone (Asia/Shanghai), counted back from today.
const day = (back) => {
  const now = new Date(Date.now() + 8 * 3600000 - back * 86400000)
  const iso = now.toISOString().slice(0, 10)
  return { iso, md: iso.slice(5).replace('-', ''), wd: weekdays[now.getUTCDay()] }
}
const [d0, d1, d2] = [day(0), day(1), day(2)]
const rel = (d) => `${d.iso.slice(0, 4)}/${d.iso.slice(5, 7)}/${d.md}_${d.wd}.md`
const header = (lines) =>
  `# ${lines.title}\n\n${lines.body}\n\n## 昨日总结\n\n昨日花销：正文里的不算 999 元\n`

const root = await makeRoot('.cclink-ledger-')
const s = await makeHome(root, 'ledger')
const project = join(s.home, '模拟日记项目')
const D = '000-个人计划'
await writeDiary(
  project,
  D,
  rel(d0),
  header({
    title: d0.iso,
    body: '今日体重：没称\n昨日睡眠：12点睡的，7点醒的，又迷糊到8:10左右才起。\n昨日花销：记有喇叭 25 元，与 23 日晚记录是否为同一笔待确认。\nAI 剩余额度：codex还有13%\n今日大便：早上一次，下午一次',
  }),
)
await writeDiary(
  project,
  D,
  rel(d1),
  header({
    title: d1.iso,
    body: '今日体重：70.6kg\n昨日花销：午饭 32，打车 46，晚上喇叭 25\n昨日运动：快走 30 分钟',
  }),
)
await writeDiary(
  project,
  D,
  rel(d2),
  header({ title: d2.iso, body: '今日体重：141 斤\n昨日收入：' }),
)

try {
  const page = await s.launch()
  const space = await firstUse(s, { importFrom: project })
  const bar = page.getByRole('group', { name: '项目功能' })

  // 健康: details folded until asked, diary rows, weight line, and a record of my own.
  await bar.getByRole('button', { name: '健康', exact: true }).click()
  const health = page.getByLabel('健康', { exact: true }).and(page.locator('.diary-ledger'))
  await health.getByRole('figure', { name: /体重/ }).waitFor()
  assert.equal(await health.getByRole('table', { name: '明细' }).count(), 0)
  await health.getByRole('button', { name: /展开最近一周/ }).click()
  await health.getByText('12点睡的，7点醒的', { exact: false }).waitFor()
  assert.equal(await health.getByText('正文里的不算').count(), 0)
  await health.getByRole('figure', { name: /体重/ }).locator('circle').nth(1).waitFor()
  assert.equal(await health.getByRole('figure', { name: /体重/ }).locator('circle').count(), 2)
  await health.getByRole('textbox', { name: '运动' }).fill('晚上跑步 5 公里')
  await health.getByRole('button', { name: '记一条' }).click()
  await health.getByRole('button', { name: '手记' }).waitFor()
  const healthFile = await readFile(join(space, '健康.md'), 'utf8')
  assert(healthFile.includes(`| ${d0.iso} |  |  | 晚上跑步 5 公里 |  |  |`), healthFile)
  const plot = health.getByRole('figure', { name: /体重/ }).locator('svg')
  const box = await plot.boundingBox()
  await page.mouse.move(box.x + box.width - 20, box.y + 60)
  await health.getByRole('status').filter({ hasText: '70.6 kg' }).waitFor()
  await page.screenshot({ path: join(shots, 'health.png') })

  // 睡眠: last night's bar from the diary's 昨日睡眠, with the lie-in after waking.
  const sleep = health.getByRole('figure', { name: /睡眠/ })
  await sleep.locator('rect.series-1:not(.estimate)').first().waitFor()
  assert.equal(await sleep.locator('rect.series-1.estimate').count(), 1)
  const night = await sleep.locator('rect.series-1:not(.estimate)').first().boundingBox()
  await page.mouse.move(night.x + night.width / 2, night.y + night.height / 2)
  await health
    .getByRole('status')
    .filter({ hasText: '0:00 睡 → 7:00 醒，睡了 7 小时，8:10 起' })
    .waitFor()
  // 运动: today's own record is placed at 晚上 as an estimate; 快走 30 分钟 has no time, a dot.
  const exercise = health.getByRole('figure', { name: /运动/ })
  await exercise.locator('rect.series-1.estimate').first().waitFor()
  assert.equal(await exercise.locator('circle.dot').count(), 1)
  const run = await exercise.locator('rect.series-1.estimate').first().boundingBox()
  await page.mouse.move(run.x + run.width / 2, run.y + 1)
  await health.getByRole('status').filter({ hasText: '约 20:00，时长没写' }).waitFor()
  // 大便: today's cell reads 2 次 from 早上一次，下午一次.
  const bowel = health.getByRole('figure', { name: /大便/ })
  await bowel.getByRole('img', { name: `${d0.iso} 2 次` }).hover()
  await health.getByRole('status').filter({ hasText: '2 次' }).waitFor()
  await page.screenshot({ path: join(shots, 'health-bowel.png') })
  assert.match(await bowel.locator('figcaption').innerText(), /记了 1 天/)
  await sleep.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'health-charts.png') })
  // Folding back hides the details again.
  await health.getByRole('button', { name: '收起' }).click()
  assert.equal(await health.getByRole('table', { name: '明细' }).count(), 0)

  // 财务: bars from diary amounts, hover shows the day's text, a record of my own.
  await bar.getByRole('button', { name: '财务', exact: true }).click()
  const finance = page.locator('.diary-ledger[aria-label="财务"]')
  await finance.getByRole('button', { name: /展开最近一周/ }).click()
  await finance.getByText('午饭 32，打车 46，晚上喇叭 25').waitFor()
  const chart = finance.getByRole('figure', { name: /花销/ })
  await chart.locator('path.series-1').nth(1).waitFor()
  assert.equal(await chart.locator('path.series-1').count(), 2)
  await finance.getByRole('textbox', { name: '收入' }).fill('闲鱼卖旧键盘 120')
  await finance.getByRole('button', { name: '记一条' }).click()
  await finance.getByRole('button', { name: '手记' }).waitFor()
  await chart.locator('path.series-2').first().waitFor()
  assert.equal(await chart.locator('path.series-2').count(), 1)
  const bars = await chart.locator('path.series-1').all()
  const first = await bars[0].boundingBox()
  await page.mouse.move(first.x + first.width / 2, first.y + first.height - 2)
  await finance.getByRole('status').filter({ hasText: '花销 103 元' }).waitFor()
  await page.screenshot({ path: join(shots, 'finance.png') })
  const financeFile = await readFile(join(space, '财务.md'), 'utf8')
  assert(financeFile.startsWith('# 财务\n\n| 日期 | 花销 | 收入 |'), financeFile)

  // A row the page cannot read is reported, not shown and not rewritten.
  await appendFile(join(space, '财务.md'), '| 昨天 | 8 |  |\n')
  await bar.getByRole('button', { name: '健康', exact: true }).click()
  await bar.getByRole('button', { name: '财务', exact: true }).click()
  await finance.getByText('财务.md 有 1 行没读出来').waitFor()
  await finance.getByRole('button', { name: /展开最近一周/ }).click()

  // A diary tag opens that diary on the 日记 page.
  await finance
    .getByRole('button', { name: `日记 ${d1.md}` })
    .first()
    .click()
  await page.getByLabel('切换日期').getByText(`${d1.md}_${d1.wd}.md`).waitFor()
  await page.getByRole('article', { name: '当天日记' }).getByText('午饭 32，打车 46').waitFor()
  await page.screenshot({ path: join(shots, 'open-diary.png') })
  console.log('PASS ledger')
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
