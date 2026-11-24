// Real Electron: closing a project that still has scheduled tasks shows the in-app dialog
// (docs/design/project-close-2026-11-24), lists task names once, and 「关闭并停用定时任务」
// disables every task before the project closes. Simulated data only.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeRoot, makeHome, firstUse } from './diary-acceptance-lib.mjs'

const shots = resolve('docs/design/project-close-2026-11-24/acceptance')
const root = await makeRoot('.cclink-project-close-')
const s = await makeHome(root, 'close')
const project = join(s.home, 'demo-project')
await mkdir(project, { recursive: true })
try {
  const page = await s.launch()
  await firstUse(s, {})
  await s.pickDirectory(project)
  await page.getByRole('button', { name: '新建或打开项目', exact: true }).click()
  await page.getByRole('button', { name: /打开已有项目/ }).click()
  const item = page.locator(`.project-strip-item[data-project-path="${project}"]`).first()
  await item.waitFor()
  for (const title of ['每日简报', '每日简报', '周度计划']) {
    const saved = await page.evaluate(
      ({ workspace, title }) =>
        window.cclinkStudio.scheduledTasks.save({
          workspacePath: workspace,
          title,
          instruction: '验收用任务，不会运行。',
          schedule: { kind: 'daily', time: '23:58', timezone: 'Asia/Shanghai' },
          resources: [{ kind: 'workspace' }],
          outputPolicy: { directory: 'reports', fileNameTemplate: 'r.md', mode: 'create-only' },
          enable: true,
        }),
      { workspace: project, title },
    )
    assert(saved.success, JSON.stringify(saved.error))
  }
  let nativeDialog = false
  page.on('dialog', async (d) => {
    nativeDialog = true
    await d.dismiss()
  })
  const close = async () => {
    await item.click({ button: 'right' })
    await page.locator('[data-context-action="project.close"]', { hasText: '关闭项目' }).click()
    return page.getByRole('dialog', { name: '关闭项目' })
  }
  // Cancel keeps the project open.
  let dialog = await close()
  await dialog.waitFor()
  assert.deepEqual(await dialog.locator('li').allInnerTexts(), ['每日简报', '周度计划'])
  await dialog.getByText('定时任务 3 个').waitFor()
  await page.screenshot({ path: join(shots, 'close-dialog.png') })
  await dialog.getByRole('button', { name: '取消' }).click()
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await item.count(), 1)
  // Close and disable.
  dialog = await close()
  await dialog.getByRole('button', { name: '关闭并停用定时任务' }).click()
  await item.waitFor({ state: 'detached' })
  const listed = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), project)
  assert(listed.success)
  assert.equal(listed.tasks.length, 3)
  assert(
    listed.tasks.every((t) => !t.activation.enabled),
    'every task disabled',
  )
  assert.equal(nativeDialog, false, 'no native confirm')
  await page.screenshot({ path: join(shots, 'closed-and-disabled.png') })
  console.log('PASS project close dialog: cancel, dedup, disable tasks and close')
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
