// Real Electron: My Space sidebar → 科技日报 → calendar → a day with a report opens its Markdown
// in the diary editor; today → 生成今天的日报 → the 10 steps change from real service events.
// Search goes to a local SearXNG stand-in. Whatever the local AI does in this isolated profile
// is reported as is: success writes today's report, failure must show on the failed step.
//
//   pnpm exec electron-vite build --outDir .cache/techdaily-build
//   DIARY_BUILD=.cache/techdaily-build node scripts/techdaily-report-smoke.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeRoot, makeHome, firstUse } from './diary-acceptance-lib.mjs'

const shots = resolve('docs/design/techdaily-2026-11-25/acceptance')
await mkdir(shots, { recursive: true })
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const [y, m, d] = today.split('-')
const past = (() => {
  const t = new Date(today + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() - (Number(d) > 2 ? 2 : -2))
  return t.toISOString().slice(0, 10)
})()

let counter = 0
const server = createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams.get('q') ?? ''
  const n = ++counter
  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      results: [1, 2].map((k) => ({
        title: `${q} 最新进展 ${n}-${k}`,
        url: `https://news.example.cn/${y}/${m}-${d}/${n}-${k}.html`,
        content: `${q} 相关报道`,
        engines: ['bing'],
      })),
    }),
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const root = await makeRoot('.cclink-techdaily-report-')
const s = await makeHome(root, 'report')
const step = (name) => console.log('PASS ' + name)
try {
  let page = await s.launch()
  const space = await firstUse(s)
  // Configure through the real settings IPC (the settings page itself is covered by
  // techdaily-settings-smoke): SearXNG stand-in, 6 searches.
  await page.evaluate(
    async ({ base, space }) => {
      const td = window.cclinkStudio.techDaily
      const saved = await td.saveSearxng({
        baseUrl: base,
        engines: ['bing'],
        auth: { mode: 'none' },
      })
      if (!saved.success) throw new Error(saved.error)
      const current = await td.getSettings({ workspacePath: space })
      const result = await td.saveSettings({
        workspacePath: space,
        revision: current.data.revision,
        options: {
          enabled: true,
          search_provider: 'searxng',
          freshness_days: 3,
          keep_undated: true,
          results_per_query: 15,
          daily_call_limit: 6,
        },
      })
      if (!result.success) throw new Error(result.error)
    },
    { base, space },
  )
  // A past day already has a report (as if synced from another computer).
  const [py, pm, pd] = past.split('-')
  await mkdir(join(space, '科技日报', py, pm), { recursive: true })
  await writeFile(
    join(space, '科技日报', py, pm, `${pm}${pd}.md`),
    `# 科技日报 | ${Number(pm)}月${Number(pd)}日\n\n## 示例头条\n\n示例解读。\n\n[原文](https://example.com/a)\n`,
  )

  await page.getByRole('button', { name: '科技日报', exact: true }).first().click()
  const calendar = page.getByLabel('科技日报日历')
  await calendar.waitFor()
  const view = page.getByLabel('当天科技日报')
  await view.getByText('今天的科技日报还没生成').waitFor()
  if (past.slice(0, 7) === today.slice(0, 7)) {
    await calendar.getByText('本月 1 份日报').waitFor()
    await calendar.locator(`[aria-label="${past} 有日报"]`).waitFor()
  }
  await page.screenshot({ path: join(shots, 'R1-sidebar-today-empty.png') })
  step('sidebar 科技日报 → calendar switches to reports; today shows 生成今天的日报')

  // Open the past day: its Markdown opens in the diary editor.
  if (past.slice(0, 7) !== today.slice(0, 7))
    await calendar.getByRole('button', { name: past < today ? '上个月' : '下个月' }).click()
  await page.locator(`[aria-label="${past} 有日报"]`).click()
  await view.locator('.ProseMirror').getByText('示例头条').waitFor()
  await page.screenshot({ path: join(shots, 'R2-past-report.png') })
  step('a day with a report opens its Markdown in the editor')

  // Back to today and generate.
  if (past.slice(0, 7) !== today.slice(0, 7))
    await page
      .getByLabel('科技日报日历')
      .getByRole('button', { name: past < today ? '下个月' : '上个月' })
      .click()
  await page.locator(`[aria-label="${today}"], [aria-label="${today} 有日报"]`).first().click()
  await view.getByRole('button', { name: '生成今天的日报' }).click()
  const steps = view.getByLabel('执行详情')
  await steps.waitFor()
  await steps.getByText('正在生成').waitFor()
  await steps
    .getByLabel('第 3 步 按领域搜索并过滤')
    .getByText(/第 \d+\/6 次/)
    .waitFor({ timeout: 30000 })
  await page.screenshot({ path: join(shots, 'R3-generating.png') })
  step('generation shows real step progress (search counts from the service)')

  // Wait for the outcome; with or without a working local AI the page must say what happened.
  const outcome = await Promise.race([
    view
      .locator('.ProseMirror')
      .getByText('今日趋势')
      .waitFor({ timeout: 360000 })
      .then(() => 'report'),
    view
      .getByText('生成失败')
      .first()
      .waitFor({ timeout: 360000 })
      .then(() => 'failed'),
  ])
  await page.screenshot({ path: join(shots, 'R4-outcome.png') })
  if (outcome === 'report') {
    await page.getByLabel('科技日报日历').locator(`[aria-label="${today} 有日报"]`).waitFor()
    step('local AI wrote today’s report; it opens in the editor and the calendar marks today')
  } else {
    const failed = await view.locator('.techdaily-step.failed').first().innerText()
    assert(/AI|JSON|Agent|超时|未就绪|登录/.test(failed), failed)
    const searchDone = await view.getByLabel('第 3 步 按领域搜索并过滤').getAttribute('class')
    assert(searchDone.includes('done'), searchDone)
    console.log('AI step failed in the isolated profile: ' + failed.replace(/\s+/g, ' '))
    step('no usable local AI here: the failure is shown on its step, earlier steps stay done')
  }
  await s.close()
  console.log('RESULT PASS (' + outcome + ')')
} catch (error) {
  await s.fail(error)
} finally {
  server.close()
}
