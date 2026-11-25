// Real Electron + real local AI: today's diary is still the untouched blank template (as 今天
// creates when AI cannot draft right away); the daily draft then fills it instead of skipping
// the day. Simulated data only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse, SPACE_DIARY } from './diary-acceptance-lib.mjs'

const TZ = 'Asia/Shanghai'
const p = Object.fromEntries(
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .map((x) => [x.type, x.value]),
)
const weekday =
  '周' + '日一二三四五六'[new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay()]
const blank = `# ${p.year}-${p.month}-${p.day} ${weekday}\n\n今日体重：\n昨日睡眠：\n昨日花销：\nAI 剩余额度：\n昨日办公地点：\n昨日运动：\n昨日收入：\n昨日身体情况：\n\n## 昨日总结\n\n\n## 今日待做\n\n\n## 强调事项\n\n\n## 今日打卡\n\n按时间、事项、详细记录填写；尚未填写的事实保持空白。\n`
const rel = `${p.year}/${p.month}/${p.month}${p.day}_${weekday}.md`

const root = await makeRoot('.cclink-blank-fill-')
const s = await makeHome(root, 'blank')
const history = join(s.home, '旧日记')
await writeDiary(history, '个人计划', '2026/08/0820_周四.md', '# 旧\n')
await writeDiary(history, '个人计划', rel, blank)
try {
  const page = await s.launch()
  const space = await firstUse(s, { importFrom: history, dailyTime: '23:59' })
  const file = join(space, SPACE_DIARY, rel)
  assert.equal(await readFile(file, 'utf8'), blank, 'today starts as the blank template')
  const started = await page.evaluate(async (workspace) => {
    const list = await window.cclinkStudio.scheduledTasks.list(workspace)
    const daily = list.tasks.find((t) => t.definition.title === '每日起草')
    return window.cclinkStudio.scheduledTasks.runNow({
      workspacePath: workspace,
      taskId: daily.definition.id,
    })
  }, space)
  assert(started.success, JSON.stringify(started))
  let content = blank
  for (let i = 0; i < 300 && content === blank; i += 1) {
    await page.waitForTimeout(1000)
    content = await readFile(file, 'utf8')
  }
  assert.notEqual(content, blank, 'the daily draft filled the blank template')
  assert.match(content, /昨日总结|今日待做/)
  console.log('PASS blank template filled by the daily draft:', content.split('\n')[0])
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
