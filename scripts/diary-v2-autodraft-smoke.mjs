// Real Electron + real local Codex: today's draft run does not complete (interrupted by quitting,
// handled like a failure); the first visit to Today afterwards starts generation automatically.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { makeRoot, makeHome, firstUse, shots } from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-v2-auto-')
const s = await makeHome(root, 'auto')
const runs = (p) =>
  s.page.evaluate(async (path) => {
    const list = await window.cclinkStudio.scheduledTasks.list(path)
    const daily = list.tasks.find((t) => t.definition.title === '每日起草')
    return (await window.cclinkStudio.scheduledTasks.listRuns(path, daily.definition.id)).runs
  }, p)
try {
  const page = await s.launch()
  page.on('dialog', (d) => void d.accept())
  // Draft time already passed: confirming queues today's catch-up draft; cancel it at once.
  await firstUse(s, { dailyTime: '00:00' })
  const project = await s.fixedRoot()
  let first
  for (let i = 0; i < 50 && !first; i++) {
    first = (await runs(project))[0]
    if (!first) await page.waitForTimeout(200)
  }
  for (let i = 0; i < 150 && (await runs(project))[0].status === 'queued'; i++)
    await page.waitForTimeout(200)
  assert.equal((await runs(project))[0].status, 'running')
  // Quitting mid-run leaves today's draft interrupted, like a failure.
  await s.close()
  // Next day-visit: opening Today starts the draft by itself and the diary appears.
  await s.launch()
  const home = s.page.locator('.personal-diary-home')
  await home.getByText('今天还没有日记，已开始起草，写好后直接打开。').waitFor({ timeout: 30000 })
  await s.page.screenshot({ path: join(shots, 'v2-auto-redraft.png') })
  await home.getByRole('article', { name: '今天的日记' }).waitFor({ timeout: 5 * 60_000 })
  await s.page.screenshot({ path: join(shots, 'v2-auto-redraft-done.png') })
  const all = await runs(project)
  const latest = all[0]
  assert.equal(latest.status, 'completed')
  assert.equal(all[1].status, 'interrupted')
  // Visiting again the same day does not start another run.
  await s.close()
  await s.launch()
  await s.page
    .locator('.personal-diary-home')
    .getByRole('article', { name: '今天的日记' })
    .waitFor()
  assert.equal((await runs(project)).length, 2)
  console.log('PASS autodraft', { first: all[1].status, retry: latest.status })
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
