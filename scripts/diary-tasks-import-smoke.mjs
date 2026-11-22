// Real Electron: one-click import of an earlier project's diary tasks and duplicate cleanup.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse, shots } from './diary-acceptance-lib.mjs'

const TZ = 'Asia/Shanghai'
const root = await makeRoot('.cclink-import-')
const s = await makeHome(root, 'import')
const oldProject = join(s.home, '旧日记项目')
const space = join(s.home, '我的日记')
await writeDiary(oldProject, '个人计划', '2026/11/1120_周五.md', '# 旧\n')
await writeDiary(space, '个人计划', '2026/11/1121_周六.md', '# 新\n')
const save = (page, input) =>
  page.evaluate(async (i) => {
    const r = await window.cclinkStudio.scheduledTasks.save(i)
    if (!r.success) throw Error(JSON.stringify(r.error))
  }, input)
const task = (workspacePath, title, schedule, enable) => ({
  workspacePath,
  title,
  instruction: `${title}：整理日记。`,
  schedule,
  resources: [{ kind: 'workspace' }, { kind: 'directory', path: '个人计划' }],
  outputPolicy: {
    directory: '个人计划/资料',
    fileNameTemplate: '{date}-{runId}.md',
    mode: 'create-only',
  },
  definitionSource: 'local',
  enable,
})
try {
  const page = await s.launch()
  page.on('dialog', (d) => void d.accept())
  await firstUse(s, { directory: space })
  // The earlier project, opened once so Studio knows it, with two diary tasks and one unrelated.
  await s.pickDirectory(oldProject)
  await page.locator('.app-topbar-open-project').first().click()
  await page.getByRole('button', { name: /打开已有项目/ }).click()
  await page.locator(`.project-strip-item[data-project-path="${oldProject}"].active`).waitFor()
  await save(
    page,
    task(oldProject, '每日简报', { kind: 'daily', time: '00:40', timezone: TZ }, true),
  )
  await save(
    page,
    task(
      oldProject,
      '每周计划和总结',
      { kind: 'weekly', time: '09:00', weekdays: [1], timezone: TZ },
      true,
    ),
  )
  await save(
    page,
    task(oldProject, '备份照片', { kind: 'daily', time: '03:00', timezone: TZ }, false),
  )
  await page.locator(`.project-strip-item[data-project-path="${space}"]`).click()
  const nav = (name) =>
    page
      .locator('.workspace-sidebar-shell')
      .getByRole('button', { name, exact: true })
      .first()
      .click()
  await nav('定时整理')
  const home = page.locator('.personal-diary-home')
  assert.equal(await home.getByText('打开原任务与历史').count(), 0)
  assert.equal(await home.getByRole('checkbox').count(), 0)
  await home.getByRole('button', { name: '导入原项目的定时任务' }).click()
  await home.getByText(/已导入 2 个：/).waitFor({ timeout: 30000 })
  await home.locator('.diary-task-row').filter({ hasText: '每日简报' }).waitFor()
  assert.equal(await home.locator('.diary-task-row').filter({ hasText: '备份照片' }).count(), 0)
  await page.screenshot({ path: join(shots, 'v2-tasks-imported.png') })
  // Importing again finds nothing new.
  await home.getByRole('button', { name: '导入原项目的定时任务' }).click()
  await home.getByText('原项目的定时任务已经都在这里了。').waitFor()
  // A second same-named task appears (e.g. one brought by Git): clean up keeps one.
  await save(page, task(space, '每日简报', { kind: 'daily', time: '00:40', timezone: TZ }, true))
  await nav('项目首页')
  await nav('定时整理')
  await home.getByText(/有重复任务：每日简报/).waitFor()
  await page.screenshot({ path: join(shots, 'v2-tasks-duplicates.png') })
  await home.getByRole('button', { name: '清理重复' }).click()
  await home.getByText('已删除 1 个重复任务。').waitFor()
  const left = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), space)
  const daily = left.tasks.filter((t) => t.definition.title === '每日简报')
  assert.equal(daily.length, 1)
  assert.equal(daily[0].activation.enabled, true, 'the enabled copy is kept')
  await page.screenshot({ path: join(shots, 'v2-tasks-clean.png') })
  console.log(
    'PASS import',
    JSON.stringify(left.tasks.map((t) => [t.definition.title, t.activation.enabled])),
  )
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
