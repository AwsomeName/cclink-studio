// Real Electron, disposable app profile. Defaults to the current out/ build.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, realpath } from 'node:fs/promises'
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
  if (!(await page.getByRole('button', { name: '从已有材料做摘录' }).isVisible()))
    await page.locator('nav.own-side').getByRole('button', { name: '＋ 交办新事务' }).click()
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
  if (process.argv.includes('--v2')) {
    // Owner v2 pages from an empty profile: entry, settings, hand-over, agreement, list, grant.
    const shots = process.env.OWNER_V2_SHOTS
    const snap = async (name) => shots && page.screenshot({ path: join(shots, name + '.png') })
    const side = page.locator('nav.own-side')
    await page.getByRole('heading', { name: '交给 Owner 一件事' }).waitFor()
    await side.getByText('还没有事务').waitFor()
    assert.equal(Math.round((await side.boundingBox()).width), 208)
    assert.match(await page.locator('.own-compose-bar small').innerText(), /我的空间.*Owner 事务/)
    await snap('v2-01-entry-empty')
    // Settings: choose another save location and register a reference directory.
    await mkdir(join(dir, 'research-out'))
    await mkdir(join(dir, 'chip-notes', 'ibex'), { recursive: true })
    const out = await realpath(join(dir, 'research-out')),
      notes = await realpath(join(dir, 'chip-notes'))
    await writeFile(join(notes, 'ibex', '验证笔记.md'), '# 验证笔记\n')
    await app.evaluate(
      ({ dialog }, paths) => {
        const queue = [...paths]
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [queue.shift()] })
      },
      [out, notes],
    )
    await side.getByRole('button', { name: '⚙ Owner 设置' }).click()
    await page.getByRole('heading', { name: 'Owner 设置' }).waitFor()
    await click('更改…')
    await page.locator('[data-owner-save-location="' + out + '"]').waitFor()
    await click('＋ 登记目录…')
    await page.locator('[data-owner-root="chip-notes"]').getByText('未授权').waitFor()
    await snap('v2-09-settings')
    await side.getByRole('button', { name: '＋ 交办新事务' }).click()
    assert.match(await page.locator('.own-compose-bar small').innerText(), /research-out/)
    await page
      .getByPlaceholder('帮我调研开源芯片项目', { exact: true })
      .fill('调研开源芯片 Ibex，交付一张有源码依据的中文入门卡。')
    await click('交给 Owner')
    await page.locator('[data-owner-agreement]').waitFor({ timeout: 150000 })
    const affair = await page.evaluate(
      async () => (await window.cclinkStudio.ownerDirectories.list()).items[0],
    )
    assert.ok(affair.directory.path.startsWith(out + '/'), affair.directory.path)
    await page.getByRole('button', { name: '确认约定，开始' }).waitFor()
    assert.match(await page.locator('[data-owner-chips]').innerText(), /待确认|等我确认/)
    await snap('v2-03-agreement')
    // Copy Owner diagnostics from the title row: this affair's facts, no chat or evidence text.
    const clip = () => app.evaluate(({ clipboard }) => clipboard.readText())
    await click('⧉ 复制 Owner 诊断')
    const pop = page.getByRole('dialog', { name: 'Owner 诊断复制结果' })
    await pop.getByText(/已复制到剪贴板/).waitFor()
    let report = await clip()
    assert.ok(report.startsWith('# Owner 诊断'), report.slice(0, 80))
    assert.ok(report.includes('事务 ID：' + affair.id))
    assert.ok(report.includes('等你确认约定'))
    assert.ok(!/\/Users\/[^/~]/.test(report), '本机用户名已替换')
    const ownerReply = (
      await page.evaluate(async () => (await window.cclinkStudio.ownerDirectories.list()).items[0])
    ).research.chat.find((m) => m.who === 'Owner')?.text
    if (ownerReply) assert.ok(!report.includes(ownerReply.slice(0, 20)), '不含聊天正文')
    await snap('v2-10-diagnostics-copied')
    await pop.getByRole('button', { name: '关闭' }).click()
    console.log('诊断已复制', Buffer.byteLength(report), 'bytes')
    // Grant the registered directory through the two-step confirmation.
    await side.getByRole('button', { name: /配置参考目录/ }).click()
    await page.getByRole('button', { name: '📁 ' + notes }).click()
    await page.locator('[data-owner-candidate="' + notes + '"]').waitFor()
    await snap('v2-08-grant')
    await click('允许本事务只读')
    await side.getByRole('button', { name: /^[▸▾] chip-notes$/ }).waitFor()
    await side.getByRole('button', { name: '‹ 我的事务' }).click()
    await page.getByRole('heading', { name: /^等我确认/ }).waitFor()
    assert.match(await page.getByRole('button', { name: /^◈ Owner/ }).innerText(), /1 等你/)
    await snap('v2-02-list')
    // Force a save conflict on confirmation: no dispatch, problem card offers retry and copy.
    await page.locator('.own-row').first().click()
    await writeFile(join(affair.directory.path, '事务配置.md'), '\n用户手改', { flag: 'a' })
    await page.getByRole('button', { name: '确认约定，开始' }).click()
    await page.locator('[data-owner-phase="pending-save"]').waitFor({ timeout: 30000 })
    const card = page.locator('.own-call')
    await card.getByRole('button', { name: '重试保存文件' }).waitFor()
    await card.getByRole('button', { name: '⧉ 复制 Owner 诊断' }).click()
    await page
      .getByRole('dialog', { name: 'Owner 诊断复制结果' })
      .getByText(/已复制到剪贴板/)
      .waitFor()
    report = await clip()
    assert.match(report, /待保存：.*事务配置\.md/)
    assert.deepEqual(
      (
        await page.evaluate(
          async () => (await window.cclinkStudio.ownerDirectories.list()).items[0],
        )
      ).research.decisions ?? [],
      [],
    )
    await snap('v2-12-diagnostics-on-failure')
    console.log('保存冲突时从问题卡片复制诊断，未派工')
    await page
      .getByRole('dialog', { name: 'Owner 诊断复制结果' })
      .getByRole('button', { name: '关闭' })
      .click()
    await page.locator('nav.own-side').getByRole('button', { name: '‹ 我的事务' }).click()
    await side.getByRole('button', { name: '⚙ Owner 设置' }).click()
    await page.locator('[data-owner-root="chip-notes"]').getByText('已授权给 1 件事务').waitFor()
    console.log(
      'PASS v2 entry → settings → hand-over at chosen location → agreement → grant → list',
    )
  } else if (process.argv.includes('--sessions')) {
    // Independent subtasks should go to separate execution sessions; dependent ones continue.
    const shots = process.env.OWNER_V2_SHOTS
    const snap = async (name) => shots && page.screenshot({ path: join(shots, name + '.png') })
    const state = () =>
      page.evaluate(async () => (await window.cclinkStudio.ownerDirectories.list()).items[0])
    await page
      .getByPlaceholder('帮我调研开源芯片项目', { exact: true })
      .fill(
        '对比开源 RISC-V 处理器 lowRISC/ibex 和 openhwgroup/cva6：两个项目各自的定位，以及各自默认流水线分几级、各级负责什么。交付一张中文对比简报，结论附官方仓库原文出处。',
      )
    await click('交给 Owner')
    await page.getByRole('button', { name: '确认约定，开始' }).waitFor({ timeout: 150000 })
    await click('确认约定，开始')
    let midShot = false
    await page
      .waitForFunction(
        () =>
          ['done', 'error', 'pending-save'].includes(
            document.querySelector('[data-owner-phase]')?.dataset.ownerPhase,
          ),
        null,
        { timeout: 900000, polling: 2000 },
      )
      .catch((e) => {
        throw e
      })
    const a = await state()
    const r = a.research
    console.log('阶段', r.phase, a.issue || '')
    console.log(
      '执行会话',
      JSON.stringify((r.workers ?? []).map((w) => [w.key, w.purpose, w.reason, w.agent])),
    )
    for (const d of r.decisions ?? [])
      console.log(
        '判断',
        d.kind,
        d.worker ?? '-',
        d.workerChoice ?? '-',
        '|',
        (d.choiceReason ?? '').slice(0, 60),
        '| 完成标准:',
        (d.doneWhen ?? '').slice(0, 60),
        '| 验收:',
        d.verdict ? (d.verdict.met ? '满足' : '未满足 ' + d.verdict.note.slice(0, 40)) : '-',
      )
    await page.locator('[data-owner-sessions]').scrollIntoViewIfNeeded()
    await snap('v2-13-sessions')
    const schedule = await readFile(join(a.directory.path, '调度.md'), 'utf8')
    const work = await readFile(join(a.directory.path, '工作记录.md'), 'utf8')
    assert.equal(r.phase, 'done', a.issue)
    assert.ok((r.workers ?? []).length >= 2, '独立子任务应分配到不同执行会话')
    assert.ok(r.decisions.some((d) => d.workerChoice === 'new' && d.worker !== 'a'))
    assert.ok(r.decisions.filter((d) => d.kind !== 'deliver').every((d) => d.ask && d.doneWhen))
    assert.ok(
      r.decisions.some((d) => d.verdict),
      '至少一次按完成标准验收',
    )
    for (const w of r.workers) {
      assert.ok(w.agent, '新会话记录了启动前选用的 Agent')
      const runs = r.decisions.filter((d) => (d.worker ?? 'a') === w.key && d.workerRunId)
      for (const d of runs)
        assert.equal(
          await page.evaluate(
            async ({ c, run }) => (await window.cclinkStudio.agent.getRunStatus(c, run))?.status,
            { c: 'owner-' + a.id + '-' + w.key, run: d.workerRunId },
          ),
          'succeeded',
        )
    }
    assert.match(work, /新开执行会话 B/)
    assert.match(schedule, /本步问题|## 执行会话/)
    void midShot
    console.log('PASS independent subtasks → separate sessions with dispatch sheets and verdicts')
  } else if (process.argv.includes('--worker-recovery')) {
    await page
      .getByPlaceholder('帮我调研开源芯片项目', { exact: true })
      .fill('调研 lowRISC/ibex，用官方 README 写一张项目定位卡，附一条原文出处。')
    await click('交给 Owner')
    const confirm = page.getByRole('button', { name: '确认约定，开始' })
    await confirm.waitFor({ timeout: 150000 })
    const state = () =>
      page.evaluate(async () => (await window.cclinkStudio.ownerDirectories.list()).items[0])
    const blocker = join((await state()).directory.path, '资料')
    await writeFile(blocker, '验收专用占位', { flag: 'wx' })
    await confirm.click()
    await page.locator('[data-owner-phase="pending-save"]').waitFor({ timeout: 180000 })
    const pending = await state()
    const order = pending.research.decisions.at(-1)
    assert.ok(order.workerRunId && order.workerFiles?.length && order.filesProcessed)
    await app.close()
    app = null
    await launch()
    await page.locator('.own-row').click()
    await page.evaluate(() => {
      window.ownerSmokeRuns = new Set()
      window.cclinkStudio.agent.onRunStatus((run) => {
        if (/^owner-.*-a$/.test(run.conversationId)) window.ownerSmokeRuns.add(run.runId)
      })
    })
    assert.equal(await readFile(blocker, 'utf8'), '验收专用占位')
    await rm(blocker)
    await click('重试保存文件')
    await click('核对原委托并继续')
    await page.waitForFunction(
      async () => {
        const a = (await window.cclinkStudio.ownerDirectories.list()).items[0]
        return a.research.decisions[0].collectionClosed
      },
      null,
      { timeout: 90000 },
    )
    const restored = await state()
    assert.equal(restored.research.decisions[0].workerRunId, order.workerRunId)
    assert.equal(restored.research.decisions[0].filesProcessed, order.workerFiles.length)
    assert.ok(restored.research.docs.length >= pending.research.docs.length)
    assert.deepEqual(await page.evaluate(() => [...window.ownerSmokeRuns]), [])
    console.log(
      'PASS 证据写入中断 → 重启 → 重试保存 → 沿用原 A 回执完成取证',
      order.workerRunId,
      '新增 A 运行 0',
    )
  } else if (process.argv.includes('--interruption')) {
    await page
      .getByPlaceholder('帮我调研开源芯片项目', { exact: true })
      .fill('帮我调研开源芯片 Ibex，给我一张源码入门卡。')
    await click('交给 Owner')
    await page.getByText('Owner 正在整理范围和交付物', { exact: true }).waitFor()
    await app.close()
    app = null
    await launch()
    await page.getByRole('heading', { name: /^需要我处理/ }).waitFor()
    assert.match(await page.getByRole('button', { name: /^◈ Owner/ }).innerText(), /1 等你/)
    await page.locator('.own-row').click()
    await page.getByText('待恢复', { exact: true }).waitFor()
    await click('从这里继续')
    await page.getByRole('button', { name: '确认约定，开始' }).waitFor({ timeout: 150000 })
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
    await click('交给 Owner')
    const confirm = page.getByRole('button', { name: '确认约定，开始' })
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
      ['事务.md', '事务配置.md', '调度.md', '工作记录.md'].sort(),
    )
    assert.match(await readFile(join(folder, '事务.md'), 'utf8'), /Ibex/)
    assert.deepEqual(await page.evaluate(() => [...window.ownerSmokeRuns]), [])
    assert.match(await readFile(join(folder, '事务配置.md'), 'utf8'), /待确认草案/)
    assert.match(await readFile(join(folder, '调度.md'), 'utf8'), /尚未派工/)
    // Fixed Owner sidebar: 208px, documents open as center tabs, main chat stays on the right.
    const side = page.locator('nav.own-side')
    assert.equal(Math.round((await side.boundingBox()).width), 208)
    await side.getByRole('button', { name: '事务配置.md', exact: true }).click()
    await page.getByRole('heading', { name: '事务配置.md', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Owner 主对话' }).waitFor()
    await click('关闭 事务配置.md')
    await side.getByRole('button', { name: '调度.md', exact: true }).click()
    const schedulePreview = page
      .getByRole('heading', { name: '调度.md', exact: true })
      .locator('..')
    await schedulePreview
      .getByText(/尚未派工/)
      .first()
      .waitFor()
    await confirm.waitFor()
    assert.equal((await state()).research.docs.length, 0)
    await snap('adaptive-01-plan')
    if (recovery) await writeFile(join(folder, '交付物'), '验收专用文件占位', { flag: 'wx' })
    await confirm.click()
    // Capture committed dispatch documents even when a native run finishes between UI polls.
    const dispatches = new Map()
    const readSchedule = async () => {
      const deadline = Date.now() + 450000
      while (Date.now() < deadline) {
        const journal = JSON.parse(await readFile(join(folder, '.owner.json'), 'utf8'))
        const r = journal.record.research
        if (['done', 'error'].includes(r.phase)) return
        const order = r.decisions?.at(-1)
        if (!journal.pending && order?.workerRunId && !dispatches.has(order.workerRunId)) {
          const md = await readFile(join(folder, '调度.md'), 'utf8')
          if (md.includes('revision: ' + journal.revision + '\n')) {
            assert.ok(md.includes(order.reason))
            assert.ok(md.includes(order.workerRunId))
            assert.match(md, /继续条件与下一步/)
            dispatches.set(order.workerRunId, md)
            console.log('已保存委托原因、运行和继续条件', order.kind, order.workerRunId)
            if (order.kind === 'more' && process.env.OWNER_RESEARCH_SHOTS)
              await writeFile(join(process.env.OWNER_RESEARCH_SHOTS, '补查中的调度.md'), md)
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw Error('等待调研终态超时')
    }
    const capture = readSchedule()
    // Keep a sampling failure observable at the join below while the UI assertions are running.
    void capture.catch(() => {})
    await page.waitForFunction(() => !!document.querySelector('[data-owner-worker-run]'), null, {
      timeout: 150000,
    })
    await schedulePreview
      .getByText(/新开执行会话|委派会话/)
      .first()
      .waitFor()
    await click('关闭 调度.md')
    const beforeQuestion = await state()
    assert.match(await readFile(join(folder, '事务配置.md'), 'utf8'), /已确认的约定/)
    const question = '为什么选择这些资料？目前还有哪些结论需要核对？'
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
    await capture
    assert.ok(dispatches.size > 0)
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
      for (const run of dispatches.keys()) assert.ok(runs.includes(run))
      console.log('待保存，已收到原生 A 运行', runs)
      await snap('01-pending-board-chat')
      await click('‹ 我的事务')
      await page.getByRole('heading', { name: /^需要我处理/ }).waitFor()
      await snap('02-pending-list')
      await app.close()
      app = null
      await launch()
      startPage = page
      await observeRuns()
      await page.getByRole('heading', { name: /^需要我处理/ }).waitFor()
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
    for (const order of a.research.decisions.filter((d) => d.workerRunId)) {
      assert.equal(
        await page.evaluate(
          async ({ id, run }) =>
            (await window.cclinkStudio.agent.getRunStatus('owner-' + id + '-a', run))?.status,
          { id: a.id, run: order.workerRunId },
        ),
        'succeeded',
      )
      assert.equal(order.workerReturned, true)
      assert.ok(dispatches.has(order.workerRunId), '该次真实派工有对应的落盘调度')
    }
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
    await page.getByRole('heading', { name: 'Owner 主对话' }).waitFor()
    assert.ok(await page.getByLabel('和 Owner 沟通').isVisible())
    await click('返回报告')
    await page.getByRole('heading', { name: a.directory.reportFile, exact: true }).waitFor()
    await click('关闭 ' + a.directory.reportFile.split('/').pop())
    await click('关闭 ' + sourceFile.split('/').pop())
    await page.locator('[data-owner-phase]').waitFor()
    await page.locator('[data-owner-delivery]').waitFor()
    await snap('06-delivered-board')

    // Read-only source directory for this affair only: pick, browse, preview, persist, revoke.
    const notes = join(dir, 'ibex-notes')
    await mkdir(join(notes, 'rtl'), { recursive: true })
    await writeFile(join(notes, '验证笔记.md'), '# 验证笔记\n\n取指级有效位需对照 RTL。\n')
    await writeFile(join(notes, 'rtl', 'if_note.sv'), 'line one\n// 验收笔记：有效位输出\n')
    await app.evaluate(({ dialog }, notes) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [notes] })
    }, notes)
    await page.getByRole('button', { name: /配置参考目录/ }).click()
    await page
      .getByRole('dialog', { name: '授权本事务只读目录' })
      .getByText('含子目录 · 2 个文件')
      .waitFor()
    await click('允许本事务只读')
    await side.getByRole('button', { name: /^[▸▾] ibex-notes$/ }).waitFor()
    await side.getByRole('button', { name: /^▸ rtl\/$/ }).click()
    await side.getByRole('button', { name: 'if_note.sv', exact: true }).click()
    await page.getByRole('heading', { name: 'ibex-notes/rtl/if_note.sv', exact: true }).waitFor()
    await page.locator('.own-doc').getByText('// 验收笔记：有效位输出').waitFor()
    await snap('06-source-directory')
    assert.deepEqual((await readdir(notes)).sort(), ['rtl', '验证笔记.md'].sort())
    console.log('参考目录已授权并可只读预览', notes)
    console.log(
      '成品',
      join(folder, a.directory.reportFile),
      '已核对引文',
      a.research.report.items.length,
    )
    assert.match(await readFile(join(folder, '调度.md'), 'utf8'), /无后续派工/)
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
    const restoredSide = page.locator('nav.own-side')
    await restoredSide.getByRole('button', { name: /^[▸▾] ibex-notes$/ }).waitFor()
    await page.getByRole('button', { name: /撤销本事务对「ibex-notes」/ }).click()
    await page.waitForFunction(() => !document.querySelector('[data-owner-grant]'))
    const grants = await page.evaluate(
      async (id) => window.cclinkStudio.ownerSources.list(id),
      a.id,
    )
    assert.deepEqual(grants, [])
    console.log('重启后参考目录授权仍在，撤销后不再列出')
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
