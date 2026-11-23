// Real Electron, second-version design: first use in four steps, nothing created before
// confirmation, built-in tasks enabled on confirm, and today's draft generated automatically.
import assert from 'node:assert/strict'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, shots } from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-v2-first-')
const s = await makeHome(root, 'first')
const defaultDir = join(s.home, 'CCLink Studio', '我的空间')
const result = {}
try {
  const page = await s.launch()
  page.on('dialog', (d) => void d.accept())
  // A new user lands on first use directly; nothing exists on disk yet.
  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  await wizard.getByText('1 导入历史').waitFor()
  await wizard.getByText(defaultDir).waitFor()
  await page.screenshot({ path: join(shots, 'v2-first-01-directory.png') })
  assert.equal(await lstat(defaultDir).catch(() => null), null, 'default folder must not exist yet')
  await wizard.getByRole('button', { name: '下一步' }).click()
  await wizard.getByLabel('Git 项目地址').waitFor()
  await page.screenshot({ path: join(shots, 'v2-first-02-sync.png') })
  await wizard.getByRole('button', { name: '下一步' }).click()
  await wizard.getByText(/测试：生成一句话 · (通过|未通过)/).waitFor({ timeout: 120000 })
  await page.screenshot({ path: join(shots, 'v2-first-03-ai.png') })
  await wizard.getByRole('button', { name: '下一步' }).click()
  await wizard.getByText('自动整理（本设备）').waitFor()
  await page.screenshot({ path: join(shots, 'v2-first-04-confirm.png') })
  assert.equal(await lstat(defaultDir).catch(() => null), null, 'still nothing on disk')
  // Set the daily time to 00:00 so the confirm step generates today's draft right away.
  await wizard.getByLabel('每日起草时间').fill('00:00')
  await wizard.getByRole('button', { name: '确认并开始' }).click()
  await wizard.waitFor({ state: 'detached', timeout: 30000 })
  assert.equal(await s.fixedRoot(), defaultDir)
  const tasks = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), defaultDir)
  result.tasks = tasks.tasks.map((t) => ({
    title: t.definition.title,
    enabled: t.activation.enabled,
  }))
  assert.deepEqual(Object.fromEntries(result.tasks.map((t) => [t.title, t.enabled])), {
    每日起草: true,
    周度计划: true,
    月度计划: false,
    年度计划: false,
  })
  const home = page.locator('.personal-diary-home')
  await home
    .getByText(/AI 正在起草|自动生成今天的草稿|今天的日记/)
    .first()
    .waitFor()
  await page.screenshot({ path: join(shots, 'v2-today-drafting.png') })
  await home.getByRole('article', { name: '今天的日记' }).waitFor({ timeout: 5 * 60_000 })
  await page.screenshot({ path: join(shots, 'v2-today-generated.png') })
  const month = join(defaultDir, '个人计划')
  const years = await readdir(month)
  result.files = years
  console.log('PASS v2 first use', JSON.stringify(result))
} catch (e) {
  console.log('PARTIAL', JSON.stringify(result))
  await s.fail(e)
} finally {
  await s.close()
}
