// Real Electron, disposable app profile. Defaults to the current out/ build.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electron from 'electron'
const root = resolve(import.meta.dirname, '..'),
  dir = await mkdtemp(join(tmpdir(), 'studio-owner-'))
for (const k of ['home', 'documents', 'profile']) await mkdir(join(dir, k))
await writeFile(
  join(dir, 'profile/settings.json'),
  JSON.stringify({ componentSetupPageSeenVersion: 2 }),
)
const sampleHome = process.env.OWNER_SMOKE_HOME || join(dir, 'home')
await mkdir(sampleHome, { recursive: true })
const launcher = join(dir, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron');app.setPath('home',${JSON.stringify(sampleHome)});app.setPath('documents',${JSON.stringify(join(dir, 'documents'))});app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(resolve(root, process.env.CCLINK_OWNER_BUILD || 'out', 'main/index.js'))})`,
)
let app, page
async function launch() {
  app = await _electron.launch({
    executablePath: electron,
    args: [launcher],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: join(dir, 'profile'),
    },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(18000)
  await page.locator('.main-window').waitFor()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1340, 860),
  )
  await page.getByRole('button', { name: /^◈ Owner/ }).click()
}
const click = (t) => page.getByRole('button', { name: t, exact: true }).click()
async function start(title, ai) {
  await click('从已有材料做摘录')
  await page.getByLabel('事务名称').fill(title)
  await page.getByLabel('交办目标').fill('为同事整理两份芯片说明中的架构原文')
  await page.getByPlaceholder('Ibex 流水线说明', { exact: false }).fill('处理器说明\n系统说明')
  await click('创建交办草案')
  await click(ai ? '确认交办 · 由 A 选摘' : '仅在本机汇编摘录')
}
const a = '处理器采用两级流水线。',
  b = '系统芯片集成存储器和外设。'
try {
  await launch()
  if (process.argv.includes('--interruption')) {
    await page
      .getByPlaceholder('帮我调研开源芯片项目', { exact: true })
      .fill('帮我调研开源芯片 Ibex，给我一张源码入门卡。')
    await click('发给 Owner')
    await page.getByText('Owner 正在整理范围和交付物', { exact: true }).waitFor()
    await app.close()
    app = null
    await launch()
    await page.getByRole('heading', { name: /^待恢复/ }).waitFor()
    assert.match(await page.getByRole('button', { name: /^◈ Owner/ }).innerText(), /1 待处理/)
    await page.locator('.own-row').click()
    await page.getByText('待恢复', { exact: true }).waitFor()
    await click('从这里继续')
    await page
      .getByRole('button', { name: '确认范围和交付物，开始调研' })
      .waitFor({ timeout: 150000 })
    console.log(
      'PASS interrupted planning → restart → pending badge and list → manual resume → plan ready',
    )
  } else if (process.argv.includes('--research')) {
    const snap = async (name) => {
      if (process.env.OWNER_RESEARCH_SHOTS)
        await page.screenshot({ path: join(process.env.OWNER_RESEARCH_SHOTS, name + '.png') })
    }
    const recovery = process.argv.includes('--save-recovery')
    const observeRuns = () =>
      page.evaluate(() => {
        window.ownerSmokeRuns = new Set()
        window.cclinkStudio.agent.onRunStatus((run) => {
          if (/^owner-.*-a$/.test(run.conversationId)) window.ownerSmokeRuns.add(run.runId)
        })
      })
    await observeRuns()
    let startPage = page
    const state = () =>
      page.evaluate(async () => (await window.cclinkStudio.ownerDirectories.list()).items[0])
    await page
      .getByPlaceholder('帮我调研开源芯片项目', { exact: true })
      .fill(
        '开源芯片 Ibex 调研。请交付一张中文《Ibex 源码入门卡》，用这个标题。先从项目定位和默认流水线各级职责中选出适合初读的一级，再沿你选的级追到一处真实寄存器，用 RTL 中的更新条件和赋值解释它何时更新。',
      )
    await click('发给 Owner')
    const confirm = page.getByRole('button', { name: '确认范围和交付物，开始调研' })
    await page.waitForFunction(
      () =>
        ['ready', 'error'].includes(
          document.querySelector('[data-owner-phase]')?.dataset.ownerPhase,
        ),
      null,
      { timeout: 150000 },
    )
    const proposed = await state()
    assert.equal(proposed.research.phase, 'ready', proposed.issue)
    const folder = proposed.directory.path
    console.log('建档', folder)
    assert.deepEqual(
      (await readdir(folder)).filter((n) => !n.startsWith('.')).sort(),
      ['事务.md', '工作记录.md'].sort(),
    )
    assert.match(await readFile(join(folder, '事务.md'), 'utf8'), /Ibex/)
    await confirm.waitFor()
    assert.equal((await state()).research.docs.length, 0)
    await snap('adaptive-01-plan')
    if (recovery) await writeFile(join(folder, '交付物'), '验收专用文件占位', { flag: 'wx' })
    await confirm.click()
    const deadline = Date.now() + 450000
    let workerRun
    while (!workerRun && Date.now() < deadline) {
      const sample = await page.evaluate(async () => {
        const a = (await window.cclinkStudio.ownerDirectories.list()).items[0]
        if (['done', 'error'].includes(a.research.phase))
          return { status: a.research.phase, issue: a.issue }
        const runId = document.querySelector('[data-owner-worker-run]')?.dataset.ownerWorkerRun
        if (!runId || a.research.decisions?.at(-1)?.kind !== 'more') return null
        return await window.cclinkStudio.agent.getRunStatus('owner-' + a.id + '-a', runId)
      })
      if (sample?.status === 'running') {
        workerRun = sample
        break
      }
      if (sample && ['done', 'error'].includes(sample.status))
        throw Error(sample.issue || '事务已结束，未观察到执行中的补查')
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    assert.ok(workerRun, '未观察到 A 的原生补查运行')
    const beforeQuestion = await state()
    const during = await readFile(join(folder, '工作记录.md'), 'utf8')
    assert.match(during, /续用会话 A 补查/)
    assert.ok((await readdir(join(folder, '资料'))).length > 0)
    console.log('补查时已保存', await readdir(join(folder, '资料')))
    const question = '为什么要让 A 补查？已取得的资料能说明什么，还缺什么？'
    await page.getByLabel('和 Owner 沟通').fill(question)
    await click('发送给 Owner')
    await snap('adaptive-02-followup')
    await click('‹ 我的事务')
    await page.locator('.own-row').first().click()
    await page.locator('.own-answer').first().waitFor({ timeout: 240000 })
    const answer = await page.locator('.own-answer p').first().innerText()
    assert.match(answer, /Ibex|取指|寄存器|流水线|RTL/i)
    assert.deepEqual((await state()).research.plan, beforeQuestion.research.plan)
    await snap('live-question')
    console.log('Owner answered during research:', answer)

    await page.waitForFunction(
      () =>
        ['done', 'pending-save', 'error'].includes(
          document.querySelector('[data-owner-phase]')?.dataset.ownerPhase,
        ),
      null,
      { timeout: 450000 },
    )
    if (recovery) {
      const pending = await state()
      assert.ok(pending.directory.error)
      assert.equal(pending.research.phase, 'done', pending.issue)
      assert.equal(await page.locator('.own-call small').innerText(), '待保存')
      await page
        .locator('.own-thread')
        .getByText(/原报告待保存/)
        .waitFor()
      assert.equal(await page.getByRole('button', { name: '打开交付物' }).count(), 0)
      const original = pending.research.report
      const runs = await page.evaluate(() => [...window.ownerSmokeRuns])
      assert.ok(runs.includes(workerRun.runId))
      console.log('待保存，已收到原生 A 运行', runs)
      await snap('01-pending-board-chat')
      await click('‹ 我的事务')
      await page.getByRole('heading', { name: /^待保存/ }).waitFor()
      await snap('02-pending-list')
      await app.close()
      app = null
      await launch()
      startPage = page
      await observeRuns()
      await page.getByRole('heading', { name: /^待保存/ }).waitFor()
      await page.locator('.own-row').first().click()
      assert.deepEqual((await state()).research.report, original)
      const blocker = join(folder, '交付物')
      assert.equal(await readFile(blocker, 'utf8'), '验收专用文件占位')
      await rm(blocker)
      await click('重试保存文件')
      await page.getByRole('button', { name: '打开交付物' }).waitFor()
      const saved = await state()
      assert.deepEqual(saved.research, pending.research)
      assert.deepEqual(await page.evaluate(() => [...window.ownerSmokeRuns]), [])
      const bytes = await readFile(join(folder, saved.directory.reportFile), 'utf8')
      assert.ok(bytes.startsWith(original.conclusion + '\n\n'))
      for (const item of original.items) {
        assert.ok(bytes.includes(item.finding))
        assert.ok(bytes.includes('> ' + item.quote.replaceAll('\n', '\n> ')))
      }
      console.log(
        '重启并重试，原报告一致，新增 A 运行 0，落盘 SHA-256',
        createHash('sha256').update(bytes).digest('hex'),
      )
      await click('‹ 我的事务')
      await page.getByRole('heading', { name: /^已交付/ }).waitFor()
      await snap('03-delivered-list')
      await page.locator('.own-row').first().click()
    }
    const a = await state()
    assert.equal(a.research.phase, 'done', a.issue)
    assert.equal(
      await page.evaluate(
        async ({ conversationId, runId }) =>
          (await window.cclinkStudio.agent.getRunStatus(conversationId, runId))?.status,
        workerRun,
      ),
      'succeeded',
    )
    assert.ok(a.research.decisions.some((d) => d.kind === 'more' && d.reason))
    assert.equal(a.research.decisions.at(-1).kind, 'deliver')
    assert.ok(a.research.docs.some((d) => d.path && !/^readme(\.md)?$/i.test(d.path)))
    assert.ok(
      a.research.report.items.every((item) =>
        a.research.docs.some(
          (d) =>
            d.url === item.url &&
            d.text.replace(/\s+/g, ' ').includes(item.quote.replace(/\s+/g, ' ')),
        ),
      ),
    )
    assert.ok(!a.directory.error, a.directory.error)
    const report = await readFile(join(folder, a.directory.reportFile), 'utf8')
    assert.match(report, /Ibex/i)
    assert.match(report, /\[本地证据\]/)
    const raw = await Promise.all(
      (await readdir(join(folder, '资料'))).map((f) => readFile(join(folder, '资料', f), 'utf8')),
    )
    assert.ok(raw.some((content) => content.includes('rtl/') && content.includes('always_ff')))
    for (const link of report.matchAll(/\[本地证据\]\(\.\.\/(.*?)\)/g))
      assert.ok(await readFile(join(folder, decodeURI(link[1].split('#')[0])), 'utf8'))
    await click('打开交付物')
    await page.getByRole('heading', { name: a.directory.reportFile, exact: true }).waitFor()
    const refs = [...report.matchAll(/\[本地证据\]\(\.\.\/(.*?)(?:#L(\d+))?\)/g)]
    const isRtl = (link) => link[2] && /\.sv\.md$/.test(decodeURI(link[1]))
    const assignment = refs.findIndex(
      (link, i) => isRtl(link) && /<=/.test(a.research.report.items[i].quote),
    )
    const rtl = assignment >= 0 ? assignment : refs.findIndex(isRtl)
    assert.ok(rtl >= 0)
    const ref = refs[rtl],
      sourceFile = decodeURI(ref[1]),
      line = Number(ref[2])
    const refButton = page.getByRole('button', { name: '本地证据', exact: true }).nth(rtl)
    await refButton.scrollIntoViewIfNeeded()
    await snap('04-card-reference')
    await refButton.click()
    const mark = page.locator('mark[data-source-line="' + line + '"]')
    await mark.waitFor()
    const disk = await readFile(join(folder, sourceFile), 'utf8')
    const start = Number(/片段起始行 (\d+)/.exec(disk)[1])
    const excerpt = disk.split(/^`{3,}text\r?\n/m)[1].split('\n')[line - start]
    assert.ok(excerpt.trim())
    assert.ok((await mark.textContent()).endsWith(excerpt))
    await page.getByRole('heading', { name: sourceFile, exact: true }).waitFor()
    await snap('05-rtl-line')
    console.log('引用打开', sourceFile, 'L' + line, excerpt)
    await click('返回报告')
    await click('关闭预览')
    console.log(
      '成品',
      join(folder, a.directory.reportFile),
      '已核对引文',
      a.research.report.items.length,
    )
    const count = a.research.report.items.length
    assert.equal(page, startPage)
    assert.equal((await app.windows()).length, 1)
    await snap('adaptive-03-delivery')
    await click('‹ 我的事务')
    await app.close()
    app = null
    await launch()
    await page.locator('.own-row').first().click()
    assert.equal(await page.locator('.own-detail article blockquote').count(), count)
    assert.equal(await page.locator('.own-answer p').first().innerText(), answer)
    console.log(
      'PASS single Studio window → goal → evidence review → same A follows up → sourced delivery → restored',
    )
  } else {
    await start('芯片调研 · 入门资料', false)
    await page.getByRole('textbox', { name: '处理器说明', exact: true }).fill(a)
    await click('保存材料并继续')
    await click('‹ 我的事务')
    assert.match(await page.locator('.own-row').innerText(), /缺：系统说明/)
    await app.close()
    app = null
    await launch()
    await page.locator('.own-row').click()
    assert.equal(
      await page.getByRole('textbox', { name: '处理器说明', exact: true }).inputValue(),
      a,
    )
    await page.getByRole('textbox', { name: '系统说明', exact: true }).fill(b)
    await click('保存材料并继续')
    await page.getByText('摘录简报', { exact: true }).waitFor()
    assert.match(await page.locator('.own-detail pre').innerText(), /系统芯片集成/)
    const dest = join(dir, 'documents', '验收.md')
    await app.evaluate(({ dialog }, dest) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: dest })
    }, dest)
    await click('导出 Markdown')
    await page.getByText('已保存：' + dest, { exact: true }).waitFor()
    assert.match(await readFile(dest, 'utf8'), /两级流水线/)

    console.log('PASS create → confirm → partially supply → restart → finish → export Markdown')
    if (process.argv.includes('--agent')) {
      await click('‹ 我的事务')
      await start('芯片资料 · Agent 摘录', true)
      await page.getByRole('textbox', { name: '处理器说明', exact: true }).fill(a)
      await page.getByRole('textbox', { name: '系统说明', exact: true }).fill(b)
      await click('保存材料并继续')
      await page.waitForFunction(
        () =>
          ['已交付', '需要处理'].includes(document.querySelector('.own-call small')?.textContent),
        null,
        { timeout: 120000 },
      )
      console.log('Agent result:', await page.locator('.own-call').innerText())
      assert.match(await page.locator('.own-call small').innerText(), /已交付/)
      console.log('PASS native Agent result verified')
      await page
        .getByRole('textbox', { name: '询问 Owner' })
        .fill('用一句话说明这份简报引用了几份材料。')
      await click('发送给 Owner')
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('.own-thread div')].some(
            (el) =>
              el.querySelector('b')?.textContent === 'Owner' &&
              el.querySelector('p')?.textContent?.trim(),
          ),
        null,
        { timeout: 95000 },
      )
      await page.getByRole('button', { name: '发送给 Owner', exact: true }).waitFor()
      await page.locator('.own-detail article').evaluate((el) => (el.scrollTop = 0))
      if (process.env.OWNER_SCREENSHOT)
        await page.screenshot({ path: process.env.OWNER_SCREENSHOT })
      console.log('PASS independent main chat replied with the affair context')
    }
  }
} finally {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
}
