// Real Electron: My Space 事务 page (docs/design/my-space-affairs-2026-11-27/mockup-v2.html).
// Isolated home/profile and simulated diaries; nothing touches the real My Space.
//   pnpm exec electron-vite build --outDir .cache/diary-build && node scripts/diary-affairs-smoke.mjs
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse, SPACE_DIARY } from './diary-acceptance-lib.mjs'

const shots = resolve('docs/design/my-space-affairs-2026-11-27/acceptance')
await mkdir(shots, { recursive: true })
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
// Days in the diary timezone (Asia/Shanghai), counted back from today.
const day = (back) => {
  const now = new Date(Date.now() + 8 * 3600000 - back * 86400000)
  const iso = now.toISOString().slice(0, 10)
  return { iso, md: iso.slice(5).replace('-', ''), wd: weekdays[now.getUTCDay()] }
}
const [d0, d1, d2, d9] = [day(0), day(1), day(2), day(9)]
const rel = (d) => `${d.iso.slice(0, 4)}/${d.iso.slice(5, 7)}/${d.md}_${d.wd}.md`
const diary = (title, rows, punch = '') => `# ${title}

今日体重：

## 昨日总结

- **眼镜硬件**：喇叭到了一批，另一批预计明天到。

## 今日待做

### 眼镜项目

- [ ] 看第二批喇叭是否到货。
- [x] 核对生产文件。

## 今日打卡

${punch || '【09:00】开始干活。'}

## 项目进度与计划

### 眼镜项目

| 事项 | 进展记录 | 计划 |
| --- | --- | --- |
${rows}

### 其他项目

| 事项 | 进展记录 | 计划 |
| --- | --- | --- |
| 机器人 | — | 确认舵机替换。 |
`
const pcb = '| 硬件-PCB | 厂家 A 已报价，嘉立创待询价。 | 按同版文件询 50 片。 |'
const ring = '| 硬件—戒指 | 待启动。 | — |'

const root = await makeRoot('.cclink-affairs-')
const s = await makeHome(root, 'affairs')
const project = join(s.home, '模拟日记项目')
const D = '000-个人计划'
await writeDiary(project, D, rel(d9), diary(d9.iso, [pcb, ring].join('\n')))
await writeDiary(
  project,
  D,
  rel(d2),
  diary(d2.iso, ['| 硬件—喇叭 | 现有两种喇叭。 | 先选型 |', pcb, ring].join('\n')),
)
await writeDiary(
  project,
  D,
  rel(d1),
  diary(
    d1.iso,
    ['| 硬件-喇叭 | 现有两种喇叭。已采购，一批已到。 | 到货后统一对比 |', pcb, ring].join('\n'),
  ),
)
await writeDiary(
  project,
  D,
  rel(d0),
  diary(
    d0.iso,
    ['| 硬件—喇叭 | 现有两种喇叭。已采购，一批已到。 | 到货后统一对比 |', pcb, ring].join('\n'),
    '【12:11】喇叭到了，16 点之后测试。',
  ),
)

try {
  const page = await s.launch()
  const space = await firstUse(s, { importFrom: project })
  const todayFile = join(space, SPACE_DIARY, rel(d0))
  const original = await readFile(todayFile, 'utf8')
  const bar = page.getByRole('group', { name: '项目功能' })

  // Overview: today's table, grouped as in the diary, with when each row last changed.
  await bar.getByRole('button', { name: '事务', exact: true }).click()
  const view = page.locator('.diary-affairs')
  await view.getByText('读了最近 4 篇日记，其中 4 篇有这一节').waitFor()
  const speaker = view.getByRole('button', { name: /硬件—喇叭/ })
  await speaker.waitFor()
  assert.match(await speaker.innerText(), /1 天前/)
  assert.equal(await speaker.locator('ins').innerText(), '已采购，一批已到。')
  assert.match(await view.getByRole('button', { name: /硬件-PCB/ }).innerText(), /9 天没动/)
  assert.match(await view.getByRole('button', { name: /硬件—戒指/ }).innerText(), /未开始/)
  await view.getByText('今日待做 2 条，已勾 1').waitFor()
  await page.screenshot({ path: join(shots, 'overview.png') })
  await view.getByRole('button', { name: /超过 7 天没动 1/ }).click()
  assert.equal(await view.locator('.diary-affairs-row').count(), 1)
  await view.getByRole('button', { name: /全部/ }).click()

  // Detail: how the row changed day by day, plus today's 打卡 that mentions it.
  await speaker.click()
  const list = view.getByRole('list', { name: '进展记录' })
  await list.getByText('首次出现').waitFor()
  await list.getByText('表格这一行和前一篇一样').waitFor()
  await list.getByText('【12:11】喇叭到了，16 点之后测试。').waitFor()
  assert.equal(await list.locator('ins').first().innerText(), '已采购，一批已到。')
  await page.screenshot({ path: join(shots, 'detail.png') })

  // Write back: only that row of today's diary changes; undo restores the file.
  await view.getByRole('button', { name: '更新今天的进展' }).click()
  const form = view.getByRole('form', { name: '更新今天的进展' })
  await form.getByRole('textbox').first().fill('现有两种喇叭。已采购，两批都已到货，晚上逐板试听。')
  await form.getByText(`将改动 ${d0.md}_${d0.wd}.md 第`).waitFor()
  await page.screenshot({ path: join(shots, 'write.png') })
  await form.getByRole('button', { name: '写入日记' }).click()
  await view.getByText(`已写入 ${d0.md}_${d0.wd}.md 第`).waitFor()
  const written = await readFile(todayFile, 'utf8')
  const row = '| 硬件—喇叭 | 现有两种喇叭。已采购，两批都已到货，晚上逐板试听。 | 到货后统一对比 |'
  assert(written.includes(row), written)
  assert.equal(
    written.replace(row, '| 硬件—喇叭 | 现有两种喇叭。已采购，一批已到。 | 到货后统一对比 |'),
    original,
  )
  // The timeline now shows today's change.
  await list.locator('ins', { hasText: '两批都已到货，晚上逐板试听。' }).waitFor()
  await view.getByRole('button', { name: '撤销这次写入' }).click()
  await list.getByText('表格这一行和前一篇一样').waitFor()
  assert.equal(await readFile(todayFile, 'utf8'), original)

  // Write again and see it in today's diary in the editor.
  await view.getByRole('button', { name: '更新今天的进展' }).click()
  await form.getByRole('textbox').nth(1).fill('逐板试听，再换型号复核。')
  await form.getByRole('button', { name: '写入日记' }).click()
  await view.getByRole('button', { name: '完成' }).click()
  assert((await readFile(todayFile, 'utf8')).includes('| 逐板试听，再换型号复核。 |'))
  await bar.getByRole('button', { name: '今天', exact: true }).click()
  await page.getByText('逐板试听，再换型号复核。').first().waitFor()
  await page.screenshot({ path: join(shots, 'today-diary.png') })
  console.log('PASS affairs')
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
