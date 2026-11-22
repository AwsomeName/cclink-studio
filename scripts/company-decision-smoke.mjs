#!/usr/bin/env node
// Real Electron + real local Agent walk-through of the company decision card (ADR 0025).
// Needs a built app (`pnpm build`) and a ready local Agent (Codex or Claude Code).
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const rootDir = resolve(import.meta.dirname, '..')
const evidenceDir = join(rootDir, 'docs/testing/company-decision-card')
const runDir = await realpath(await mkdtemp(join(tmpdir(), 'cclink-decision-smoke-')))
const userData = join(runDir, 'user-data')
const workspaceRoot = await realpath(await mkdtemp(join(homedir(), '.cclink-decision-smoke-')))
const a = join(workspaceRoot, 'company-a')
await Promise.all([userData, a, evidenceDir].map((path) => mkdir(path, { recursive: true })))
await mkdir(join(a, '.cclink-studio'), { recursive: true })
await writeFile(
  join(a, '.cclink-studio', 'workspace-settings.json'),
  JSON.stringify({ version: 1, name: 'company-a', type: 'company' }),
)
await writeFile(
  join(userData, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: {
      'smoke-0': {
        workspaceKey: a,
        workspacePath: a,
        ownerKey: null,
        updatedAt: Date.now(),
        storage: 'fallback',
        projectId: null,
      },
    },
  }),
)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: a,
    recentWorkspacePaths: [a],
    componentSetupPageSeenVersion: 2,
  }),
)
const environment = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: '',
  ELECTRON_RENDERER_URL: '',
  CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
}
const month = new Date().toISOString().slice(0, 7)
const scope = { workspaceRef: { kind: 'local', path: a }, month }
const results = []
let app
let page
const assert = (value, message) => {
  if (!value) throw new Error(message)
}
const pass = (name, detail) => {
  results.push({ name, status: 'pass', ...(detail ? { detail } : {}) })
  console.log('PASS ' + name + (detail ? ' — ' + detail : ''))
}
const snapshot = async () => {
  const result = await page.evaluate(
    (input) => window.cclinkStudio.companyWorkspace.getSnapshot(input),
    scope,
  )
  if (!result.success) throw new Error(result.error.message)
  return result.data
}
async function waitDecision(predicate, description, timeout) {
  const end = Date.now() + timeout
  let last
  while (Date.now() < end) {
    last = (await snapshot()).decisions[0]
    if (last && predicate(last)) return last
    await new Promise((done) => setTimeout(done, 1000))
  }
  throw new Error(description + ': ' + JSON.stringify(last))
}
async function launch() {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [rootDir],
    cwd: rootDir,
    env: environment,
    timeout: 30000,
  })
  page = await app.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30000 })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 960),
  )
}
const shot = (name) =>
  page.locator('.company-decision').screenshot({ path: join(evidenceDir, name + '.png') })

try {
  await launch()
  await page.getByRole('heading', { name: '启用公司视图', exact: true }).waitFor({ timeout: 20000 })
  await page.getByLabel('公司显示名称').fill('眼镜研发公司')
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  await page.getByRole('heading', { name: '经营决策', exact: true }).waitFor()
  const first = await page.evaluate(() => {
    const home = document.querySelector('.company-home')
    return home?.firstElementChild?.classList.contains('company-decision') ?? false
  })
  assert(first, 'Decision card is not the first block on the company home')
  await page.screenshot({ path: join(evidenceDir, '01-home.png') })
  pass('公司首页最上方显示经营决策卡，其他区块保留')

  await page.getByRole('button', { name: '帮我想清楚一个问题', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '帮我想清楚一个问题' })
  await dialog.waitFor()
  const checked = await dialog
    .locator('input[type=checkbox]')
    .evaluateAll((items) => items.map((item) => item.checked))
  assert(JSON.stringify(checked) === '[true,true,true,false]', 'Default scopes ' + checked)
  await dialog.getByLabel('你想决定什么？').fill('AR 眼镜一代首批先卖给谁，怎么定价？')
  await dialog
    .getByLabel('补充情况（可选）')
    .fill(
      '首批能交 300 台，零件和组装成本约每台 600 元，平台佣金和运费约每台 150 元。还没有渠道，近视用户要配镜片。',
    )
  await page.screenshot({ path: join(evidenceDir, '02-ask.png') })
  await dialog.getByRole('button', { name: '交给 Owner', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const thinking = await waitDecision(
    (item) => item.runId !== null || item.issue !== '' || item.status !== 'thinking',
    'Dispatch recorded',
    60000,
  )
  assert(!thinking.issue, 'Owner dispatch failed: ' + thinking.issue)
  if (thinking.attempt) {
    await page.getByText('Owner 正在读资料并思考', { exact: false }).waitFor()
    await shot('03-thinking')
  }
  pass('交办后记录本次运行并显示思考中', 'run ' + (thinking.runId ?? '已完成'))

  let rounds = 0
  let decision
  for (;;) {
    decision = await waitDecision((item) => item.attempt === null, 'Owner result', 8 * 60 * 1000)
    if (decision.status !== 'clarify') break
    rounds++
    await page.locator('.company-decision-clarify').waitFor()
    await shot('04-clarify-' + rounds)
    const sets = page.locator('.company-decision-clarify fieldset')
    // Round 1 uses the choice buttons; later rounds answer in the user's own words.
    for (let index = 0; index < (await sets.count()); index++) {
      const set = sets.nth(index)
      if (rounds === 1) await set.locator('.company-decision-choices button').first().click()
      else
        await set
          .getByLabel('其他回答')
          .fill('还不确定，没有具体金额或台数，请按常见情况估算并说明')
    }
    await page.getByRole('button', { name: '回答并继续', exact: true }).click()
    await waitDecision((item) => item.attempt !== null || item.issue !== '', 'Re-dispatch', 30000)
    pass('Owner 追问，点选回答后继续思考', decision.questions.map((q) => q.text).join(' / '))
  }
  assert(decision.status === 'decide', 'Owner did not deliver: ' + JSON.stringify(decision))
  await page.locator('.company-decision-options').waitFor()
  await page.locator('.company-decision-evidence summary').click()
  await shot('05-decide')
  pass(
    'Owner 给出建议、方案、依据与重想条件',
    `${decision.draft.options.length} 个方案，${decision.draft.evidence.length} 条依据，追问 ${rounds} 轮`,
  )

  const before = await snapshot()
  const other = decision.draft.options.find(
    (item) => item.id !== decision.draft.recommendedOptionId,
  )
  await page.locator('.company-decision-options label').filter({ hasText: other.title }).click()
  await page.getByRole('button', { name: '改一下再采纳', exact: true }).click()
  await page.getByLabel('写下你的决定').fill(other.title + '：先小批量试卖 100 台，看退货率再定价')
  await page.getByRole('button', { name: '采纳并记为决策', exact: true }).click()
  await page.getByText('已记为决策', { exact: false }).waitFor()
  const after = await snapshot()
  const adopted = after.decisions[0]
  assert(adopted.status === 'adopted' && adopted.chosenOptionId === other.id, 'Not adopted')
  assert(
    JSON.stringify([before.projects, before.cases, before.links, before.finance]) ===
      JSON.stringify([after.projects, after.cases, after.links, after.finance]),
    'Adopting changed other company data',
  )
  for (const name of ['推广产品', '跟进客户', '售后服务'])
    await page
      .locator('.company-decision-done')
      .getByRole('button', { name, exact: true })
      .waitFor()
  await shot('06-adopted')
  pass('改写后采纳；只写决策记录，账目客户业务不变；给出三个入口')

  await app.close()
  await launch()
  await page.getByRole('heading', { name: '经营决策', exact: true }).waitFor({ timeout: 20000 })
  const restored = (await snapshot()).decisions
  assert(restored.length === 1 && restored[0].status === 'adopted', 'Decision lost on restart')
  assert(restored[0].version === adopted.version, 'Decision changed on restart (re-dispatch?)')
  await page.locator('.company-decision-history').getByText('已采纳', { exact: true }).waitFor()
  await shot('07-restart')
  pass('重启后决策仍在、状态已采纳，没有重新派工')
} catch (error) {
  results.push({ name: 'failure', status: 'fail', detail: String(error?.stack ?? error) })
  console.error('FAIL', error)
  await page?.screenshot({ path: join(evidenceDir, 'failure.png') }).catch(() => undefined)
  process.exitCode = 1
} finally {
  await writeFile(
    join(evidenceDir, 'result.json'),
    JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + '\n',
  )
  await app?.close().catch(() => undefined)
  await rm(runDir, { recursive: true, force: true })
  await rm(workspaceRoot, { recursive: true, force: true })
}
