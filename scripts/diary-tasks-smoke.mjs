// Real Electron + real local Codex login: user-authored section requirements for the daily
// briefing and weekly review, saved/reopened verbatim, then manual and scheduled runs whose
// Markdown is inspected. Simulated diary text only; isolated profile; tasks are test-only.
import assert from 'node:assert/strict'
import { readFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, confirmExisting, shots } from './diary-acceptance-lib.mjs'

const TZ = 'Asia/Shanghai'
const root = await makeRoot('.cclink-tasks-')
const s = await makeHome(root, 'tasks')
const project = join(s.home, '模拟日记项目')
const D = '000-个人计划'
for (const [rel, body] of [
  [
    '2026/11/1116_周一.md',
    '# 2026-11-16 周一\n## 今日打卡\n- 完成电源板模拟测试\n- 遗留：散热片供货未确认\n',
  ],
  [
    '2026/11/1118_周三.md',
    '# 2026-11-18 周三\n## 今日打卡\n- 模拟客户评审通过\n- 遗留：固件签名流程待定\n',
  ],
  ['2026/11/1120_周五.md', '# 2026-11-20 周五\n## 今日打卡\n- 整理本周笔记\n'],
  ['2026/周计划/第46周.md', '# 第46周计划\n- 电源板测试\n- 客户评审\n'],
  ['一日生活计划.md', '# 一日生活计划\n07:00 起床\n'],
])
  await writeDiary(project, D, rel, body)

const fmt = (date, opts) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, ...opts }).format(date)
const hhmm = (date) => fmt(date, { hour: '2-digit', minute: '2-digit', hour12: false })
const weekdayIndex = () =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(fmt(new Date(), { weekday: 'short' }))
const nowPlus = (minutes) => {
  const t = new Date(Date.now() + minutes * 60_000)
  if (t.getSeconds() > 40) t.setMinutes(t.getMinutes() + 1)
  return t
}
const monday = (() => {
  const d = new Date(
    fmt(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit' }) + 'T00:00:00Z',
  )
  const offset = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  return d.toISOString().slice(0, 10)
})()

const WEEKLY_REQ = `读取上周的日记与上一份周计划，写本周复盘。依次写三个二级章节：「上周进展」「遗留问题」「本周计划（${'本周一日期，格式 YYYY-MM-DD'}）」。遗留问题用表格，列为 问题 | 原因 | 下一步；原因未知写“待核实”。不要写其他二级章节，篇幅 300 字以内。`
const DAILY_REQ =
  '读取昨日日记和一日生活计划，准备今天的日记。顶部一级标题为“YYYY-MM-DD 周X”。然后依次写四个二级章节：「昨日总结」「今日待做」「强调事项」「今日打卡」。今日待做使用 - [ ] 任务清单；今日打卡用表格，列为 时间 | 事项 | 详细记录，暂无内容时只保留表头。未知事实写“待核实”，不要编造。'

function inspect(markdown, expected) {
  const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim())
  const section = (name) => {
    const i = markdown.search(new RegExp('^## ' + name, 'm'))
    if (i < 0) return ''
    const rest = markdown.slice(i + 3)
    const next = rest.search(/^## /m)
    return next < 0 ? rest : rest.slice(0, next)
  }
  return {
    headings,
    order:
      expected.every((h, i) => (headings[i] ?? '').startsWith(h)) &&
      headings.length === expected.length,
    section,
  }
}

async function waitRun(taskId, predicate, timeout = 12 * 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const history = await s.page.evaluate(
      ({ project, taskId }) => window.cclinkStudio.scheduledTasks.listRuns(project, taskId),
      { project, taskId },
    )
    assert(history.success, JSON.stringify(history.error))
    const run = history.runs.find(predicate)
    if (run && !['queued', 'running'].includes(run.status)) return run
    await s.page.waitForTimeout(2000)
  }
  throw Error('run did not finish: ' + taskId)
}

async function editRequirement(title, requirement, { enable = false, time } = {}) {
  const page = s.page
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '定时整理', exact: true })
    .first()
    .click()
  await page
    .locator('.workspace-home-record')
    .filter({ hasText: title })
    .getByRole('button', { name: '打开原任务与历史' })
    .click()
  const box = page.getByLabel('任务内容')
  await box.waitFor()
  await box.fill(requirement)
  if (time) await page.getByLabel('执行时刻').fill(time)
  await page
    .getByRole('button', { name: enable ? '保存并在此设备启用' : '保存', exact: true })
    .first()
    .click()
  await page
    .getByRole('button', { name: /保存中/ })
    .waitFor({ state: 'detached' })
    .catch(() => {})
  await page.waitForTimeout(800)
}

const result = {}
try {
  const page = await s.launch()
  // Enabling a shared definition asks for confirmation; the test accepts it for its own tasks.
  page.on('dialog', (dialog) => {
    console.log('dialog:', dialog.message().slice(0, 120))
    void dialog.accept()
  })
  await confirmExisting(s, project)
  const seed = (input) =>
    page.evaluate(async (i) => {
      const r = await window.cclinkStudio.scheduledTasks.save(i)
      if (!r.success) throw Error(JSON.stringify(r.error))
      return r.task.definition.id
    }, input)
  const weeklyId = await seed({
    workspacePath: project,
    title: '每周复盘',
    instruction: '总结上周，写本周计划。',
    schedule: { kind: 'weekly', time: '21:00', weekdays: [weekdayIndex()], timezone: TZ },
    resources: [{ kind: 'workspace' }, { kind: 'directory', path: D }],
    outputPolicy: {
      directory: `${D}/{year}/周计划`,
      fileNameTemplate: '{date}-周复盘-{runId}.md',
      mode: 'create-only',
    },
    definitionSource: 'shared',
    enable: false,
  })
  const dailyId = await seed({
    workspacePath: project,
    title: '每日简报',
    instruction: '准备今天的日记。',
    schedule: { kind: 'daily', time: '07:30', timezone: TZ },
    resources: [{ kind: 'workspace' }, { kind: 'directory', path: D }],
    outputPolicy: {
      directory: `${D}/{year}/{month}`,
      fileNameTemplate: '{monthDay}_{weekday}.md',
      mode: 'create-only',
    },
    definitionSource: 'shared',
    enable: false,
  })
  // Link both on the diary page; linking never enables or runs them.
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '定时整理', exact: true })
    .first()
    .click()
  for (const t of ['每周复盘', '每日简报'])
    await page
      .locator('.workspace-home-record')
      .filter({ hasText: t })
      .getByRole('checkbox')
      .check()
  await page.getByRole('button', { name: '保存任务关联', exact: true }).click()
  await page.waitForTimeout(500)
  const linked = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), project)
  assert(linked.tasks.every((t) => !t.activation.enabled))

  // Weekly: user-written section requirements, saved and reopened verbatim.
  await editRequirement('每周复盘', WEEKLY_REQ)
  await page.screenshot({ path: join(shots, 'tasks-weekly-requirement.png') })
  const reopened = await page.evaluate(
    ({ p, id }) => window.cclinkStudio.scheduledTasks.get(p, id),
    { p: project, id: weeklyId },
  )
  assert.equal(reopened.task.definition.instruction, WEEKLY_REQ)
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '定时整理', exact: true })
    .first()
    .click()
  await page
    .locator('.workspace-home-record')
    .filter({ hasText: '每周复盘' })
    .getByRole('button', { name: '打开原任务与历史' })
    .click()
  assert.equal(await page.getByLabel('任务内容').inputValue(), WEEKLY_REQ)

  // Weekly manual run (enabling is required for shared definitions on this device).
  await page.getByRole('button', { name: '在此设备启用', exact: true }).click()
  await page
    .getByRole('button', { name: '立即运行', exact: true })
    .and(page.locator(':enabled'))
    .waitFor()
  await page.getByRole('button', { name: '立即运行', exact: true }).click()
  const weeklyManual = await waitRun(weeklyId, (r) => r.trigger === 'manual')
  assert.equal(weeklyManual.status, 'completed', JSON.stringify(weeklyManual.error))
  const wm = await readFile(join(project, weeklyManual.artifact.relativePath), 'utf8')
  await copyFile(
    join(project, weeklyManual.artifact.relativePath),
    join(shots, 'sample-weekly-manual.md'),
  )
  const wmi = inspect(wm, ['上周进展', '遗留问题', '本周计划'])
  result.weeklyManual = {
    path: weeklyManual.artifact.relativePath,
    headings: wmi.headings,
    order: wmi.order,
    mondayInThird: (wmi.headings[2] ?? '').includes(monday),
    tableInIssues: /\|.*\|/.test(wmi.section('遗留问题')),
  }
  await page.screenshot({ path: join(shots, 'tasks-weekly-manual-run.png') })

  // Daily: requirements + scheduled time in ~2 minutes, enabled on this test device only.
  const dailyAt = nowPlus(2)
  await editRequirement('每日简报', DAILY_REQ, { enable: true, time: hhmm(dailyAt) })
  const dailyDef = await page.evaluate(
    ({ p, id }) => window.cclinkStudio.scheduledTasks.get(p, id),
    { p: project, id: dailyId },
  )
  assert.equal(dailyDef.task.definition.instruction, DAILY_REQ)
  assert.equal(dailyDef.task.activation.enabled, true, JSON.stringify(dailyDef.task.activation))
  // Weekly scheduled occurrence ~4 minutes out.
  const weeklyAt = nowPlus(4)
  await editRequirement('每周复盘', WEEKLY_REQ, { enable: true, time: hhmm(weeklyAt) })
  const dailyScheduled = await waitRun(dailyId, (r) => r.trigger === 'scheduled')
  assert.equal(dailyScheduled.status, 'completed', JSON.stringify(dailyScheduled.error))
  const ds = await readFile(join(project, dailyScheduled.artifact.relativePath), 'utf8')
  await copyFile(
    join(project, dailyScheduled.artifact.relativePath),
    join(shots, 'sample-daily-scheduled.md'),
  )
  const dsi = inspect(ds, ['昨日总结', '今日待做', '强调事项', '今日打卡'])
  result.dailyScheduled = {
    path: dailyScheduled.artifact.relativePath,
    headings: dsi.headings,
    order: dsi.order,
    title: (ds.match(/^# (.+)$/m) ?? [])[1],
    checklist: /- \[ \]/.test(dsi.section('今日待做')),
    tableInCheckin: /\|\s*时间\s*\|\s*事项\s*\|\s*详细记录\s*\|/.test(dsi.section('今日打卡')),
  }
  // Manual daily run afterwards must not overwrite today's diary.
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '定时整理', exact: true })
    .first()
    .click()
  await page
    .locator('.workspace-home-record')
    .filter({ hasText: '每日简报' })
    .getByRole('button', { name: '打开原任务与历史' })
    .click()
  await page.getByRole('button', { name: '立即运行', exact: true }).click()
  const dailyManual = await waitRun(dailyId, (r) => r.trigger === 'manual', 3 * 60_000)
  result.dailyManual = { status: dailyManual.status, error: dailyManual.error?.message }
  assert.notEqual(dailyManual.status, 'completed')
  assert.equal(await readFile(join(project, dailyScheduled.artifact.relativePath), 'utf8'), ds)
  await page.screenshot({ path: join(shots, 'tasks-daily-history.png') })

  const weeklyScheduled = await waitRun(weeklyId, (r) => r.trigger === 'scheduled')
  assert.equal(weeklyScheduled.status, 'completed', JSON.stringify(weeklyScheduled.error))
  const ws = await readFile(join(project, weeklyScheduled.artifact.relativePath), 'utf8')
  await copyFile(
    join(project, weeklyScheduled.artifact.relativePath),
    join(shots, 'sample-weekly-scheduled.md'),
  )
  const wsi = inspect(ws, ['上周进展', '遗留问题', '本周计划'])
  result.weeklyScheduled = {
    path: weeklyScheduled.artifact.relativePath,
    headings: wsi.headings,
    order: wsi.order,
    mondayInThird: (wsi.headings[2] ?? '').includes(monday),
    tableInIssues: /\|.*\|/.test(wsi.section('遗留问题')),
  }
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '定时整理', exact: true })
    .first()
    .click()
  await page
    .locator('.workspace-home-record')
    .filter({ hasText: '每周复盘' })
    .getByRole('button', { name: '打开原任务与历史' })
    .click()
  await page.screenshot({ path: join(shots, 'tasks-weekly-history.png') })
  // Leave the isolated test tasks disabled.
  for (const id of [dailyId, weeklyId])
    await page
      .evaluate(
        ({ p, id }) =>
          window.cclinkStudio.scheduledTasks.setEnabled({
            workspacePath: p,
            taskId: id,
            enabled: false,
          }),
        { p: project, id },
      )
      .catch((e) => console.log('disable failed', String(e)))
  console.log('PASS tasks', JSON.stringify({ monday, ...result }, null, 2))
} catch (e) {
  console.log('PARTIAL', JSON.stringify({ monday, ...result }, null, 2))
  await s.fail(e)
} finally {
  await s.close()
}
