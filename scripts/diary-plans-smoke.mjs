import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse } from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-plans-')
const session = await makeHome(root, 'plans')
const project = join(session.home, '计划验收')
const legacy = await writeDiary(project, '个人计划', '2026/周计划/旧计划.md', '# 原文\n')
try {
  const page = await session.launch()
  await firstUse(session, { directory: project })
  await page.getByRole('button', { name: '打开本周计划 ›' }).click()
  const plans = page.locator('.diary-plan-layout')
  await plans.getByRole('button', { name: '空白计划' }).click()
  const editor = plans.locator('.tiptap[contenteditable=true]')
  await editor.click()
  await editor.press('End')
  await editor.press('Enter')
  await page.keyboard.insertText('本周验收记录')
  await editor.press('Meta+s')
  await plans.getByText(/当前文稿 · .*W/).waitFor()
  const name = await plans.locator('.diary-plan-center header strong').innerText()
  await page.waitForFunction(
    async ({ path }) =>
      (await window.cclinkStudio.fs.readTextDocument(path)).content.includes('本周验收记录'),
    { path: join(project, '计划', '周', name.slice(0, 4), name) },
  )
  if (process.env.PLAN_AI_ACCEPTANCE === '1') {
    await plans
      .getByLabel('调整当前计划')
      .fill('请在备注中加入这一行文字：周四验收流转。请实际修改文件。')
    await plans.getByRole('button', { name: '发送', exact: true }).click()
    await editor
      .getByText(/周四验收流转/)
      .first()
      .waitFor({ timeout: 120000 })
    assert.match(
      await readFile(join(project, '计划', '周', name.slice(0, 4), name), 'utf8'),
      /周四验收流转/,
    )
    await page.screenshot({ path: join(session.home, '周计划-AI修改.png') })
    await plans.getByRole('button', { name: '撤销本次修改' }).click({ timeout: 90000 })
    await editor.getByText(/周四验收流转/).waitFor({ state: 'detached' })
    assert.doesNotMatch(
      await readFile(join(project, '计划', '周', name.slice(0, 4), name), 'utf8'),
      /周四验收流转/,
    )
    const sidebar = page.locator('.workspace-sidebar-shell')
    await sidebar.getByRole('button', { name: '日记', exact: true }).first().click()
    await plans.waitFor({ state: 'detached' })
    await sidebar.getByRole('button', { name: '计划', exact: true }).first().click()
    await plans.getByRole('button', { name: /完整对话|查看待确认操作/ }).waitFor()
    await plans
      .locator('.diary-plan-chat')
      .getByText(/你.*周四验收流转/s)
      .waitFor()

  }
  await plans.getByRole('button', { name: '月度', exact: true }).click()
  await plans.getByRole('button', { name: '空白计划' }).click()
  await plans.getByText(/当前文稿 · \d{4}-\d{2}\.md/).waitFor()
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
    await plans.getByText(/当前文稿 · \d{4}\.md/).waitFor()
  }
  await plans.getByRole('button', { name: '长期', exact: true }).click()
  await plans.getByRole('button', { name: '＋ 新建计划' }).click()
  await plans.getByLabel('计划名称').fill('阅读')
  await plans.getByRole('button', { name: '确认', exact: true }).click()
  await plans.getByText('当前文稿 · 阅读.md').waitFor()
  await plans.getByLabel('调整当前计划').fill('保留这条待发指令')
  await plans.getByRole('button', { name: '重命名', exact: true }).click()
  await plans.getByLabel('计划名称').fill('晨读')
  await plans.getByRole('button', { name: '确认', exact: true }).click()
  await plans.getByText('当前文稿 · 晨读.md').waitFor()
  assert.equal(await plans.getByLabel('调整当前计划').inputValue(), '保留这条待发指令')
  await plans.getByRole('button', { name: '删除', exact: true }).click()
  await plans.getByRole('button', { name: '确认删除' }).click()
  await plans.getByText('从右侧新建长期计划。').waitFor()
  await assert.rejects(access(join(project, '计划', '长期', '晨读.md')))
  assert.equal(await readFile(legacy, 'utf8'), '# 原文\n')
  if (process.env.PLAN_TASK_ACCEPTANCE === '1') {
    const tasks = (await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), project))
      .tasks
    const monthly = tasks.find((t) => t.definition.schedule.kind === 'monthly')
    assert.equal(monthly.activation.enabled, false)
    await plans.getByRole('button', { name: '月度', exact: true }).click()
    await plans.getByRole('button', { name: '本机未启用 · 启用' }).click()
    await plans.getByRole('button', { name: '本机已启用 · 停用' }).waitFor()
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
