import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

const headerFile = (page, pattern) =>
  page.waitForFunction(
    (source) =>
      new RegExp(source).test(
        document.querySelector('.diary-plan-header')?.getAttribute('data-file') ?? '',
      ),
    pattern.source,
  )
import { makeRoot, makeHome, writeDiary, firstUse } from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-plans-')
const session = await makeHome(root, 'plans')
const history = join(session.home, '计划验收')
await writeDiary(history, '个人计划', '2026/11/1120_周五.md', '# 周五\n')
await writeDiary(history, '个人计划', '2026/周计划/旧计划.md', '# 原文\n')
let project, legacy
try {
  const page = await session.launch()
  project = await firstUse(session, { importFrom: history })
  legacy = join(project, '个人计划', '2026/周计划/旧计划.md')
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '计划', exact: true })
    .first()
    .click()
  const plans = page.locator('.diary-plan-layout')
  await plans.getByRole('button', { name: '空白计划' }).click()
  const editor = plans.locator('.tiptap[contenteditable=true]')
  await editor.click()
  await editor.press('End')
  await editor.press('Enter')
  await page.keyboard.insertText('本周验收记录')
  await editor.press('Meta+s')
  const header = plans.locator('.diary-plan-header[data-file*="W"]')
  await header.waitFor({ state: 'attached' })
  const name = await header.getAttribute('data-file')
  await page.waitForFunction(
    async ({ path }) =>
      (await window.cclinkStudio.fs.readTextDocument(path)).content.includes('本周验收记录'),
    { path: join(project, '计划', '周', name.slice(0, 4), name) },
  )
  if (process.env.PLAN_AI_ACCEPTANCE === '1') {
    // Adjusting a plan goes through the single conversation panel on the right.
    await plans.getByRole('button', { name: '让 AI 调整' }).click()
    const composer = page.getByPlaceholder(/继续提问|输入消息/).first()
    await composer.click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('在备注中加入这一行文字：周四验收流转。请实际修改文件。')
    await page.keyboard.press('Enter')
    await editor
      .getByText(/周四验收流转/)
      .first()
      .waitFor({ timeout: 180000 })
    assert.match(
      await readFile(join(project, '计划', '周', name.slice(0, 4), name), 'utf8'),
      /周四验收流转/,
    )
    await page.screenshot({ path: join(session.home, '周计划-AI修改.png') })
  }
  await plans.getByRole('button', { name: '月度', exact: true }).click()
  await plans.getByRole('button', { name: '空白计划' }).click()
  await headerFile(page, /^\d{4}-\d{2}\.md$/)
  await plans.getByRole('button', { name: '年度', exact: true }).click()
  await plans.getByRole('button', { name: '空白计划' }).waitFor()
  await plans.locator('.diary-plan-periods button').first().click()
  await plans.getByRole('button', { name: '补写计划' }).waitFor()
  assert.equal(await plans.getByRole('button', { name: 'AI 生成计划' }).count(), 0)
  await plans.locator('.diary-plan-periods button').last().click()
  if (process.env.PLAN_YEAR_ACCEPTANCE === '1') {
    await plans.getByRole('button', { name: 'AI 生成计划' }).click()
    await editor
      .getByText(/起草来源：AI 生成/)
      .first()
      .waitFor({ timeout: 180000 })
  } else {
    await plans.getByRole('button', { name: '空白计划' }).click()
    await headerFile(page, /^\d{4}\.md$/)
  }
  await plans.getByRole('button', { name: '长期', exact: true }).click()
  await plans.getByRole('button', { name: '＋ 新建计划' }).click()
  await plans.getByLabel('计划名称').fill('阅读')
  await plans.getByRole('button', { name: '确认', exact: true }).click()
  await plans.locator('.diary-plan-header[data-file="阅读.md"]').waitFor({ state: 'attached' })
  await plans.getByRole('button', { name: '重命名', exact: true }).click()
  await plans.getByLabel('计划名称').fill('晨读')
  await plans.getByRole('button', { name: '确认', exact: true }).click()
  await plans.locator('.diary-plan-header[data-file="晨读.md"]').waitFor({ state: 'attached' })
  await plans.getByRole('button', { name: '删除', exact: true }).click()
  await plans.getByRole('button', { name: '确认删除' }).click()
  await plans.getByText('选择或新建一份长期计划').waitFor()
  await assert.rejects(access(join(project, '计划', '长期', '晨读.md')))
  assert.equal(await readFile(legacy, 'utf8'), '# 原文\n')
  if (process.env.PLAN_TASK_ACCEPTANCE === '1') {
    const tasks = (await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), project))
      .tasks
    const monthly = tasks.find((t) => t.definition.schedule.kind === 'monthly')
    assert.equal(monthly.activation.enabled, false)
    await plans.getByRole('button', { name: '月度', exact: true }).click()
    await plans.getByRole('button', { name: '启用', exact: true }).click()
    await plans.getByText('· 已启用').waitFor()
    const run = async () => {
      const result = await page.evaluate(
        (input) => window.cclinkStudio.scheduledTasks.runNow(input),
        { workspacePath: project, taskId: monthly.definition.id },
      )
      assert.equal(result.success, true, result.error?.message)
      for (let i = 0; i < 180; i++) {
        const rows = await page.evaluate(
          ([p, id]) => window.cclinkStudio.scheduledTasks.listRuns(p, id),
          [project, monthly.definition.id],
        )
        const row = rows.runs.find((r) => r.id === result.run.id)
        if (row && !['queued', 'running'].includes(row.status)) return row
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      throw Error('月度计划生成超时')
    }
    const generated = await run()
    assert.equal(generated.status, 'completed', generated.error?.message)
    const saved = await readFile(join(project, generated.artifact.relativePath), 'utf8')
    assert.match(saved, /起草来源：AI 生成/)
    const skipped = await run()
    assert.equal(skipped.status, 'skipped', skipped.error?.message)
    assert.equal(await readFile(join(project, generated.artifact.relativePath), 'utf8'), saved)
    console.log('PASS monthly output and collision', generated.artifact.relativePath)
  }
  console.log('PASS plans')
} catch (e) {
  await session.fail(e)
} finally {
  await session.close()
}
