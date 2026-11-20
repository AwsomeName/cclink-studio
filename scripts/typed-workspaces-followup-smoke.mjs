import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-followup-smoke-')))
const workspace = join(root, 'home/woniu-forward')
let profile = join(root, 'profile')
const home = join(root, 'home')
await Promise.all([workspace, profile, home].map((p) => mkdir(p, { recursive: true })))
const now = new Date()
const month = String(now.getMonth() + 1).padStart(2, '0')
const day = month + String(now.getDate()).padStart(2, '0')
const filename = day + '_周' + '日一二三四五六'[now.getDay()] + '.md'
const directory = '000-个人计划/' + now.getFullYear() + '/' + month
await mkdir(join(workspace, directory), { recursive: true })
await mkdir(join(workspace, '000-个人计划', String(now.getFullYear()), '周计划'), {
  recursive: true,
})
await mkdir(join(workspace, directory, '1117_周二.assets'), { recursive: true })
const originals = new Map([
  [join(workspace, directory, '1117_周二.assets/原附件.txt'), '模拟原附件，保持原位'],
  [join(workspace, directory, filename), '# 今日打卡\n原日记保持不变\n'],
  [join(workspace, '000-个人计划/一日生活计划.md'), '# 一日生活计划\n原计划保持不变\n'],
  [
    join(workspace, '000-个人计划', String(now.getFullYear()), '周计划/本周.md'),
    '# 本周计划\n继续研究\n',
  ],
])
for (const [path, content] of originals) await writeFile(path, content)
await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({
    markdownAutoSave: false,
    componentSetupPageSeenVersion: 2,
    claudeRuntimeSource: 'system',
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
    startupWorkspaceTarget: 'resume',
  }),
)
await writeFile(
  join(profile, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: {
      fixture: {
        workspaceKey: workspace,
        workspacePath: workspace,
        ownerKey: null,
        updatedAt: Date.now(),
        storage: 'fallback',
        projectId: null,
      },
    },
  }),
)
const fixtureMain = resolve(`out/main/index.followup-${process.pid}.cjs`)
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron'); app.setPath('home',${JSON.stringify(home)});app.setPath('documents',${JSON.stringify(home)});app.setAppPath(${JSON.stringify(resolve('.'))});require(${JSON.stringify(fixtureMain)});`,
)
// Only the external generator is simulated. Original services, IPC, ledger and UI execute unchanged.
// Instrument a disposable build copy; no fixture hook is added to shipped source.
let built = await readFile(resolve('out/main/index.js'), 'utf8')
const runnerAnchor = 'new ScheduledTaskAgentRunner(agentBridge)'
assert.equal(built.split(runnerAnchor).length, 2)
built = built.replace(
  runnerAnchor,
  `({
  run(input) { return new Promise((resolve, reject) => { globalThis.__followupRuns ??= new Map(); globalThis.__followupRuns.set(input.runId, { input, resolve, reject }); }); },
  async cancel(id) { globalThis.__followupRuns?.get(id)?.reject(new Error('simulated generator cancelled')); globalThis.__followupRuns?.delete(id); }
})`,
)
await writeFile(fixtureMain, built)
let app
async function launch() {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [launcher],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
    },
    timeout: 30000,
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('UI:', message.text())
  })
  await page.waitForSelector('.main-window')
  return page
}

const results = []
const pass = (name) => {
  results.push(name)
  console.log('PASS', name)
}
async function setLayout(layout) {
  const button = page.getByRole('button', { name: /^(展开|收起) Agent 面板$/ })
  if (((await button.getAttribute('aria-pressed')) === 'true') !== (layout === 'standard'))
    await button.click()
  assert.equal(await page.locator('.tab-create-actions select').count(), 0)
}
let page
async function file(name) {
  const target = page.locator('.file-tree-name').getByText(name, { exact: true })
  if (!(await target.isVisible())) {
    if (await page.locator('.sidebar-back').isVisible()) await page.locator('.sidebar-back').click()
    await page.getByRole('button', { name: '文件', exact: true }).click()
  }
  await target.click()
}
async function running(title) {
  await page.getByRole('button', { name: '进行中的工作', exact: true }).click()
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: '进行中的工作', exact: true }) })
  await dialog.getByRole('button').filter({ hasText: title }).first().click()
  await dialog.waitFor({ state: 'hidden' })
}
async function closeActiveTab() {
  await page.locator('.tab.active .tab-close').click()
}
async function runs(taskId) {
  return page.evaluate(
    async ({ workspace, taskId }) => {
      const value = await window.cclinkStudio.scheduledTasks.listRuns(workspace, taskId)
      if (!value.success) throw Error(JSON.stringify(value))
      return value.runs
    },
    { workspace, taskId },
  )
}
async function until(fn, label) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw Error('timeout: ' + label)
}
try {
  const md = join(workspace, '版面验收.md')
  originals.set(md, '# 原始文档\n保持源文件不变\n')
  const html = join(workspace, '本地页面.html')
  originals.set(html, '<html><body><h1>本地预览验收</h1></body></html>')
  const ts = join(workspace, 'example.ts')
  originals.set(ts, 'const answer = 42;\n')
  const gerber = join(workspace, 'board.gtl')
  originals.set(
    gerber,
    '%FSLAX24Y24*%\n%MOMM*%\n%ADD10C,0.100*%\nD10*\nX000000Y000000D02*\nX100000Y000000D01*\nX100000Y100000D01*\nX000000Y100000D01*\nX000000Y000000D01*\nM02*\n',
  )
  for (const [path, value] of originals) await writeFile(path, value)
  page = await launch()
  await file('版面验收.md')
  await page.locator('.tiptap[contenteditable="true"]').fill('尚未保存的版面验收')
  const originalTabId = await page.locator('.tab.active').getAttribute('data-workbench-tab-id')
  await page.getByLabel('打开方式', { exact: true }).selectOption('source')
  assert.match(
    await page.locator('.source-text-editor textarea').inputValue(),
    /尚未保存的版面验收/,
  )
  await page.locator('.source-text-editor textarea').fill('# 源码继续编辑\n没有另建副本\n')
  await page.getByLabel('打开方式', { exact: true }).selectOption('markdown')
  assert.match(await page.locator('.tiptap').innerText(), /源码继续编辑/)
  assert.equal(
    await page.locator('.tab.active').getAttribute('data-workbench-tab-id'),
    originalTabId,
  )
  assert.equal(await readFile(md, 'utf8'), originals.get(md))
  pass('Markdown 正文/源码共享原未保存内容与标签，原文件未写入')
  await page.getByLabel('打开方式', { exact: true }).selectOption('source')
  await setLayout('standard')
  const agentPanel = page.locator('.agent-workspace')
  await agentPanel.waitFor()
  const agentWidth = (await agentPanel.boundingBox()).width
  await agentPanel.getByRole('button', { name: '会话列表', exact: true }).click()
  assert.equal((await agentPanel.boundingBox()).width, agentWidth)
  await agentPanel.getByRole('button', { name: '新建对话', exact: true }).click()
  assert.equal((await agentPanel.boundingBox()).width, agentWidth)
  assert.match(await page.locator('.source-text-editor textarea').inputValue(), /源码继续编辑/)
  assert.equal(
    await page.locator('.tab.active').getAttribute('data-workbench-tab-id'),
    originalTabId,
  )
  await page.getByRole('button', { name: /^◈ Owner/ }).click()
  await page.locator('#owner-board').waitFor()
  await page.screenshot({ path: join(root, 'owner-project-integration.png') })
  await page.getByRole('button', { name: /^◈ Owner/ }).click()
  await page.locator('.source-text-editor textarea').waitFor()
  assert.match(await page.locator('.source-text-editor textarea').inputValue(), /源码继续编辑/)
  assert.equal(
    await page.locator('.tab.active').getAttribute('data-workbench-tab-id'),
    originalTabId,
  )
  pass('合并组合：Agent 列表/对话同宽切换、Owner 往返保留原 Markdown 标签和未保存内容')
  await setLayout('focus')
  await page.screenshot({ path: join(root, 'markdown-source.png') })
  await file('example.ts')
  assert.equal(await page.locator('.source-text-editor textarea').inputValue(), originals.get(ts))
  assert.equal(await page.getByRole('button', { name: '预览', exact: true }).count(), 0)
  pass('代码默认源码，不提供 Markdown 或网页转换')
  await file('本地页面.html')
  await page.getByLabel('打开方式', { exact: true }).selectOption('html')
  await until(
    () =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some(
            (wc) =>
              wc.getURL().endsWith('/本地页面.html') || wc.getURL().includes('%E6%9C%AC%E5%9C%B0'),
          ),
      ),
    'HTML native page',
  )
  const nativeId = await app.evaluate(
    ({ webContents }) =>
      webContents
        .getAllWebContents()
        .find(
          (wc) =>
            wc.getURL().includes('%E6%9C%AC%E5%9C%B0') || wc.getURL().endsWith('/本地页面.html'),
        ).id,
  )
  const attached = () =>
    app.evaluate(
      ({ BrowserWindow }, id) =>
        BrowserWindow.getAllWindows().some((win) =>
          win.contentView.children.some((view) => view.webContents?.id === id),
        ),
      nativeId,
    )
  await until(attached, 'native browser attached')
  await page.getByRole('button', { name: /^◈ Owner/ }).click()
  await page.locator('#owner-board').waitFor()
  await until(async () => !(await attached()), 'Owner hides native browser')
  await page.getByRole('button', { name: /^◈ Owner/ }).click()
  await until(attached, 'original native browser reattached')
  pass('合并组合：Owner 展开隐藏原生网页，返回重新附着同一 WebContents')
  await page.getByLabel('打开方式', { exact: true }).selectOption('source')
  await page.locator('.source-text-editor textarea').waitFor()
  assert.equal(await page.locator('.source-text-editor textarea').inputValue(), originals.get(html))
  pass('HTML 在真实原生浏览器与原源码标签间切换')
  await page.getByRole('button', { name: 'Studio 设置', exact: true }).click()
  await page.getByRole('button', { name: '运行状态与诊断', exact: true }).click()
  await until(
    async () =>
      (await page.getByLabel('脱敏诊断报告', { exact: true }).textContent()).includes(
        '定时任务框架',
      ),
    'diagnostics loaded',
  )
  assert(!(await page.getByLabel('脱敏诊断报告', { exact: true }).textContent()).includes(home))
  await page.screenshot({ path: join(root, 'diagnostics.png') })
  pass('设置显示原服务脱敏诊断、组件/模型/用量入口')
  await page.getByRole('button', { name: '远程设备', exact: true }).click()
  assert.match(await page.locator('.settings-content').innerText(), /本机账号与设备连接/)
  assert.equal(await page.getByRole('button', { name: '作为远程项目打开', exact: true }).count(), 0)
  pass('远程设备配置不混入目录选择，本地继续可用')
  await file('board.gtl')
  await page.locator('.gerber-preview').waitFor()
  await page.locator('.gerber-render-panel svg').waitFor()
  assert.equal(await page.getByLabel('打开方式', { exact: true }).inputValue(), 'circuit')
  assert(await page.getByLabel('打开方式', { exact: true }).isDisabled())
  await page.screenshot({ path: join(root, 'circuit-view.png') })
  pass('真实 Gerber 图层画布和电路只读打开方式，不显示虚假编辑选项')
  await page.getByRole('button', { name: '新建 Terminal', exact: true }).click()
  await page.locator('.terminal-pty-shell .xterm-helper-textarea').waitFor()
  const terminalSession = await page.evaluate(async () =>
    (await window.cclinkStudio.terminal.listSessions()).find((s) => s.status === 'running'),
  )
  assert(terminalSession)
  await page.locator('.terminal-pty-shell .xterm-helper-textarea').pressSequentially('sleep 60')
  await page.locator('.terminal-pty-shell .xterm-helper-textarea').press('Enter')
  await closeActiveTab()
  assert(
    (await page.evaluate(() => window.cclinkStudio.terminal.listSessions())).some(
      (s) => s.sessionId === terminalSession.sessionId && s.status === 'running',
    ),
  )
  await running('Terminal')
  await page.locator('.terminal-pty-shell').waitFor()
  assert.equal(
    (await page.evaluate(() => window.cclinkStudio.terminal.listSessions())).filter(
      (s) => s.status === 'running',
    ).length,
    1,
  )
  const terminated = await page.evaluate(
    (id) => window.cclinkStudio.terminal.terminatePty(id),
    terminalSession.sessionId,
  )
  assert(terminated.success)
  pass('真实本地 PTY 关闭视图保留进程，汇总重新附着同一 session，显式终止成功')
  // Real service creates one simulation task, without enabling recurring execution.
  const task = await page.evaluate(async (workspacePath) => {
    const result = await window.cclinkStudio.scheduledTasks.save({
      workspacePath,
      title: '模拟长整理任务',
      instruction: '只读取模拟资料并生成报告',
      schedule: { kind: 'daily', time: '23:59', timezone: 'Asia/Shanghai' },
      resources: [{ kind: 'workspace' }],
      outputPolicy: { directory: 'reports', fileNameTemplate: '{date}.md', mode: 'create-only' },
      enable: false,
    })
    if (!result.success) throw Error(JSON.stringify(result))
    return result.task
  }, workspace)
  const definitionPath = join(
    workspace,
    '.cclink-studio/scheduled-tasks',
    task.definition.id + '.json',
  )
  originals.set(definitionPath, await readFile(definitionPath, 'utf8'))
  if (await page.locator('.sidebar-back').isVisible()) await page.locator('.sidebar-back').click()
  if (!(await page.locator('.activity-more').evaluate((el) => el.open)))
    await page.locator('.activity-more summary').click()
  await page.getByRole('button', { name: '定时任务', exact: true }).click()
  await page.getByText('模拟长整理任务', { exact: true }).first().click()
  await page.locator('.scheduled-task-tab').waitFor()
  await page
    .locator('.scheduled-task-tab')
    .getByRole('button', { name: '立即运行', exact: true })
    .click()
  await until(
    async () => (await runs(task.definition.id))[0]?.status === 'running',
    'long task started',
  )
  const firstRun = (await runs(task.definition.id))[0]
  await page.getByRole('button', { name: /^◈ Owner/ }).click()
  await page.locator('#owner-board').waitFor()
  assert.equal((await runs(task.definition.id))[0].id, firstRun.id)
  assert.equal((await runs(task.definition.id))[0].status, 'running')
  await page.getByRole('button', { name: /^◈ Owner/ }).click()
  await page.locator('.scheduled-task-tab').waitFor()
  pass('合并组合：Owner 往返不打断原定时长任务、不创建新运行')
  await closeActiveTab()
  assert.equal((await runs(task.definition.id))[0].id, firstRun.id)
  assert.equal((await runs(task.definition.id))[0].status, 'running')
  await running('模拟长整理任务')
  await page.locator('.scheduled-task-tab').waitFor()
  pass('关闭任务标签后运行继续，汇总返回原任务/原运行 ID')
  // Waiting-human affair uses the original WebAffair service and state transitions.
  const affair = await page.evaluate(async (path) => {
    const workspaceRef = { kind: 'local', path }
    const connection = await window.cclinkStudio.webResources.createConnection({
      workspaceRef,
      websiteName: '本地模拟平台',
      entryUrl: 'https://example.invalid',
      principalKind: 'personal',
      principalName: '模拟用户',
      accountLabel: '模拟账号',
    })
    if (!connection.success) throw Error(JSON.stringify(connection))
    const created = await window.cclinkStudio.webAffairs.createAffair({
      workspaceRef,
      title: '等待人工验收事务',
      objective: '只验收等待与返回，不访问或提交平台',
      principalId: connection.data.principal.id,
      accountIds: [],
      materialPaths: [],
      nodeTitles: ['等待人工检查模拟资料'],
    })
    if (!created.success) throw Error(JSON.stringify(created))
    const node = created.data.flow.nodes[0]
    const updated = await window.cclinkStudio.webAffairs.updateNode({
      workspaceRef,
      affairId: created.data.id,
      nodeId: node.id,
      status: 'waiting-human',
      resultNote: '模拟等待人工，不执行外部副作用',
    })
    if (!updated.success) throw Error(JSON.stringify(updated))
    return updated.data
  }, workspace)
  await running('等待人工验收事务')
  await page.locator('.web-affair-tab').waitFor()
  await closeActiveTab()
  await running('等待人工验收事务')
  assert.match(await page.locator('.web-affair-tab').innerText(), /需要我处理|等待人工/)
  pass('等待人工事务关闭后可返回原节点，未复制任务或继续外部动作')
  await page
    .locator('.project-strip-item')
    .filter({ hasText: 'woniu-forward' })
    .click({ button: 'right' })
  let closeText = ''
  page.once('dialog', async (dialog) => {
    closeText = dialog.message()
    await dialog.accept()
  })
  await page.getByRole('menuitem', { name: '关闭项目', exact: true }).click()
  await until(
    async () =>
      !(await page.locator('.project-strip-item').filter({ hasText: 'woniu-forward' }).count()),
    'project removed',
  )
  assert.match(closeText, /模拟长整理任务/)
  assert.match(closeText, /等待人工验收事务/)
  assert.equal((await runs(task.definition.id))[0].status, 'running')
  await running('模拟长整理任务')
  assert.match(await page.locator('.status-bar-workspace').getAttribute('title'), /woniu-forward/)
  pass('关闭项目提示原任务和等待事务，后台运行保留并可返回原项目')
  await page.screenshot({ path: join(root, 'returned-task.png') })
  await app.close()
  app = null
  page = await launch()
  const recovered = (await runs(task.definition.id))[0]
  assert.equal(recovered.id, firstRun.id)
  assert.equal(recovered.status, 'interrupted')
  await running('模拟长整理任务')
  assert.match(await page.locator('.scheduled-task-tab').innerText(), /中断/)
  await page.screenshot({ path: join(root, 'interrupted-restart.png') })
  pass('完全退出后重启：原运行标为中断，无自动续跑或假成功')
  await page
    .locator('.scheduled-task-tab')
    .getByRole('button', { name: '立即运行', exact: true })
    .click()
  await until(async () => {
    const list = await runs(task.definition.id)
    return list.length === 2 && list[0].status === 'running'
  }, 'explicit retry')
  const retry = (await runs(task.definition.id))[0]
  assert.notEqual(retry.id, firstRun.id)
  const relativePath = 'reports/simulated-' + retry.id + '.md',
    content = '# 模拟执行结果\n仅验证原调度生命周期\n'
  await mkdir(join(workspace, 'reports'), { recursive: true })
  await writeFile(join(workspace, relativePath), content, { flag: 'wx' })
  await app.evaluate(
    (_electron, { id, artifact }) => {
      const pending = globalThis.__followupRuns.get(id)
      if (!pending) throw Error('simulation generator missing')
      pending.resolve({ artifact })
      globalThis.__followupRuns.delete(id)
    },
    {
      id: retry.id,
      artifact: {
        relativePath,
        bytes: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
      },
    },
  )
  await until(
    async () => (await runs(task.definition.id))[0].status === 'completed',
    'retry success',
  )
  assert.equal((await runs(task.definition.id))[1].status, 'interrupted')
  pass('显式重试产生新运行，原中断历史保留，模拟产物独占创建')
  await running('等待人工验收事务')
  assert.match(await page.locator('.web-affair-tab').innerText(), /需要我处理|等待人工/)
  const after = await page.evaluate(
    async ({ workspace, id }) => {
      const snap = await window.cclinkStudio.webAffairs.getSnapshot({
        workspaceRef: { kind: 'local', path: workspace },
      })
      return snap.data.affairs.find((a) => a.id === id)
    },
    { workspace, id: affair.id },
  )
  assert.equal(after.flow.nodes[0].status, 'waiting-human')
  pass('重启保留等待人工事务原 ID/节点，未隐式执行')
  await file('版面验收.md')
  assert.equal(await page.getByLabel('打开方式', { exact: true }).inputValue(), 'source')
  await page.getByRole('button', { name: '展开 Agent 面板', pressed: false }).waitFor()
  assert.match(await page.locator('.source-text-editor textarea').inputValue(), /源码继续编辑/)
  pass('重启恢复标签打开方式、未保存正文与专注版面')
  for (const [path, content] of originals) assert.equal(await readFile(path, 'utf8'), content, path)
  pass('全部原模拟资料与原任务定义逐字节不变')
  await writeFile(
    join(root, 'results.json'),
    JSON.stringify(
      {
        root,
        results,
        externalExecution: 'deterministic generator only; original service/IPC/UI/ledger',
        taskId: task.definition.id,
        firstRun: firstRun.id,
        retryRun: retry.id,
        affairId: affair.id,
      },
      null,
      2,
    ),
  )
  console.log('RESULT', root, results.length)
} catch (error) {
  console.error(error)
  if (page) await page.screenshot({ path: join(root, 'failure.png') }).catch(() => {})
  console.log('ROOT', root)
  process.exitCode = 1
} finally {
  try {
    if (app) await app.close()
  } finally {
    await unlink(fixtureMain)
  }
}
