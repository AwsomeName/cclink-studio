// Real Electron + real local AI: entering 今天 before the scheduled draft time still ends in
// today's file open for editing (drafted right away), with the toolbar as the only row above it.
// Simulated data only.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse, shots } from './diary-acceptance-lib.mjs'

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
const today = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)))
const monday = new Date(today)
monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7))
const mondayText = monday.toISOString().slice(0, 10)

const root = await makeRoot('.cclink-today-open-')
const s = await makeHome(root, 'today')
const history = join(s.home, '旧日记')
await writeDiary(history, '个人计划', '2026/08/0820_周四.md', '# 旧\n')
await writeDiary(history, '个人计划', `2026/周计划/周一-2026-08-24.md`, '# 八月的计划\n')
await writeDiary(history, '个人计划', `${p.year}/周计划/周一-${mondayText}.md`, '# 本周计划\n')
try {
  const page = await s.launch()
  // The scheduled time is far ahead: the page must not just wait for it.
  await firstUse(s, { importFrom: history, dailyTime: '23:59' })
  const home = page.locator('.personal-diary-home')
  assert.equal(await home.getByText(/23:59.*自动生成今天的草稿/).count(), 0)
  const article = home.getByRole('article', { name: '今天的日记' })
  await article.locator('.tiptap[contenteditable=true]').waitFor({ timeout: 5 * 60_000 })
  // Redesign v3: with only the home tab open the tab strip folds away (its create buttons sit in
  // the editor toolbar) and there is no bottom link row.
  assert.equal(await page.locator('.tab-bar').isVisible(), false)
  await article.getByRole('button', { name: '新建浏览器页' }).waitFor()
  assert.equal(await home.locator('.diary-today-foot').count(), 0)
  await page.screenshot({ path: join(shots, 'v3-today-opened-before-time.png') })
  // The status-bar sync item reads exactly like its neighbours (same size and colour).
  const look = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const st = getComputedStyle(el)
      return { size: st.fontSize, color: st.color, family: st.fontFamily }
    }
    return { sync: pick('.status-bar .diary-sync'), workspace: pick('.status-bar-workspace') }
  })
  assert.deepEqual(look.sync, look.workspace, JSON.stringify(look))
  console.log('PASS today opens before the scheduled time')
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
