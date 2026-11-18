import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-typed-smoke-')))
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
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron'); app.setPath('home',${JSON.stringify(home)});app.setPath('documents',${JSON.stringify(home)});app.setAppPath(${JSON.stringify(resolve('.'))});require(${JSON.stringify(resolve('out/main/index.js'))});`,
)
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

const git = async (cwd, args) =>
  (
    await exec('git', ['-c', 'credential.helper=', ...args], {
      cwd,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    })
  ).stdout.trim()
let page
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(
    '<html><body style="width:auto"><h1>器件资料验收</h1><p>本地网页原内容</p></body></html>',
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browserUrl = `http://127.0.0.1:${server.address().port}/parts`
async function pick(path) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, path)
}
async function createProject(type, name) {
  await pick(home)
  await page.getByRole('button', { name: '新建或打开项目', exact: true }).click()
  await page.getByRole('button', { name: '新建项目…', exact: false }).click()
  await page
    .getByRole('region', { name: '新建项目表单' })
    .getByLabel('项目类型', { exact: true })
    .selectOption(type)
  await page.getByLabel('新项目名称', { exact: true }).fill(name)
  await page.getByRole('button', { name: '选择父目录', exact: true }).click()
  await page.getByRole('button', { name: '创建并打开', exact: true }).click()
  await page.locator('.workspace-open-surface').waitFor({ state: 'hidden' })
  return join(home, name)
}
try {
  page = await launch()
  // Fixture tasks are created through the real service; all project use below is through UI.
  const tasks = await page.evaluate(async (path) => {
    await window.cclinkStudio.workspaceState.listLocalWorkspaces()
    await window.cclinkStudio.workspaceState.get(path)
    const tasks = []
    for (const title of ['每日简报', '每周计划和总结']) {
      const result = await window.cclinkStudio.scheduledTasks.save({
        workspacePath: path,
        title,
        instruction: '读取项目内日记，未知事实留空',
        schedule: { kind: 'daily', time: '23:59', timezone: 'Asia/Shanghai' },
        resources: [{ kind: 'workspace' }],
        outputPolicy: {
          directory: '000-个人计划',
          fileNameTemplate: '{date}.md',
          mode: 'create-only',
        },
        enable: false,
      })
      if (!result.success) throw Error(result.error.message)
      tasks.push(result.task)
    }
    return tasks
  }, workspace)
  for (const task of tasks) {
    const path = join(workspace, '.cclink-studio/scheduled-tasks', task.definition.id + '.json')
    originals.set(path, await readFile(path, 'utf8'))
  }
  await page.getByRole('button', { name: '当前项目设置', exact: true }).click()
  await page.getByLabel('项目类型', { exact: true }).selectOption('diary')
  await page.getByLabel('项目内日记目录（随项目配置保存）', { exact: true }).check()
  await page.getByLabel('项目内日记目录', { exact: true }).fill('000-个人计划')
  await page.getByRole('button', { name: '保存项目设置', exact: true }).click()
  await page.getByText('项目设置已保存；原文件与任务保持原位。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await page.getByText('原日记保持不变', { exact: true }).waitFor()
  await page.getByRole('button', { name: '定时整理', exact: true }).click()
  for (const title of ['每日简报', '每周计划和总结'])
    await page.getByLabel(title, { exact: true }).check()
  await page.getByRole('button', { name: '保存任务关联', exact: true }).click()
  await page.getByText('导出 / 接回原任务定义', { exact: true }).click()
  await page.getByRole('button', { name: '导出已勾选的原任务', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('textarea[aria-label="任务定义 JSON"]')?.value.includes('每日简报'),
  )
  const bundle = await page.getByLabel('任务定义 JSON', { exact: true }).inputValue()
  assert.equal(JSON.parse(bundle).tasks.length, 2)
  await page.screenshot({ path: join(root, 'task-transfer.png') })
  await git(workspace, ['init', '--initial-branch=main'])
  await git(workspace, ['config', 'user.name', 'Acceptance'])
  await git(workspace, ['config', 'user.email', 'test@example.invalid'])
  await page.getByRole('button', { name: '当前项目设置', exact: true }).click()
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await page.getByRole('button', { name: '将项目配置纳入 Git（仅暂存）', exact: true }).click()
  await page.getByText('项目设置：已纳入 Git', { exact: false }).waitFor()
  assert.equal(
    await git(workspace, ['diff', '--cached', '--name-only']),
    '.cclink-studio/workspace-settings.json',
  )
  await git(workspace, ['add', '000-个人计划'])
  await git(workspace, ['commit', '-m', 'Portable diary project'])
  const remote = join(home, 'journey.git')
  await git(home, ['init', '--bare', '--initial-branch=main', remote])
  await git(workspace, ['remote', 'add', 'origin', remote])
  await git(workspace, ['push', '-u', 'origin', 'main'])
  // A company and a separate engineering project share files through links, not copies.
  const engineering = await createProject('electronics', '眼镜研发')
  await page.getByRole('heading', { name: '工程概览', exact: true }).waitFor()
  await page.getByRole('button', { name: '当前项目设置', exact: true }).click()
  await page.getByLabel('固定浏览器', { exact: true }).check()
  await page.getByLabel('固定终端', { exact: true }).check()
  await page.getByRole('button', { name: 'terminal上移', exact: true }).click()
  assert.deepEqual(
    await page
      .getByRole('group', { name: '常用工具', exact: true })
      .locator('button')
      .allTextContents(),
    ['终端', '浏览器'],
  )
  const mdPath = join(engineering, '说明.md')
  await writeFile(mdPath, '# 工程说明\n独立工程原文\n')
  const stl =
    'solid sample\n facet normal 0 0 1\n outer loop\n vertex 0 0 0\n vertex 10 0 0\n vertex 0 10 0\n endloop\n endfacet\nendsolid sample\n'
  await writeFile(join(engineering, '外壳.stl'), stl)
  const company = await createProject('company', '模拟公司')
  assert.equal(await page.getByRole('group', { name: '常用工具', exact: true }).count(), 0)
  await page.getByLabel('公司显示名称', { exact: true }).fill('模拟公司')
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await page.getByRole('button', { name: '当前项目设置', exact: true }).click()
  await page.getByRole('button', { name: '将此公司关联到“我的公司”', exact: true }).click()
  await page.getByText('“我的公司”已关联当前公司。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '业务项目', exact: true }).first().click()
  await page.getByRole('button', { name: '创建业务项目', exact: true }).click()
  await page.getByLabel('业务项目名称', { exact: true }).fill('智能眼镜')
  await page.getByRole('button', { name: '创建并打开业务', exact: true }).click()
  await page.getByRole('heading', { name: '智能眼镜', exact: true }).waitFor()
  await pick(engineering)
  await page.getByRole('button', { name: '关联已有工程', exact: true }).click()
  const record = page.locator('.company-row').filter({ hasText: '关联工程' })
  await record.getByText('眼镜研发', { exact: true }).waitFor()
  await page.screenshot({ path: join(root, 'company-linked-engineering.png') })
  await record.getByRole('button', { name: '打开原记录', exact: true }).click()
  await page.getByRole('heading', { name: '工程概览', exact: true }).waitFor()
  assert.deepEqual(
    await page
      .getByRole('group', { name: '常用工具', exact: true })
      .locator('button')
      .allTextContents(),
    ['终端', '浏览器'],
  )
  await page
    .getByRole('region', { name: '工程文件', exact: true })
    .getByRole('button')
    .filter({ hasText: '外壳.stl' })
    .waitFor()
  await page.screenshot({ path: join(root, 'engineering-home-audit.png') })
  await page
    .getByRole('region', { name: '工程文件', exact: true })
    .getByRole('button')
    .filter({ hasText: '外壳.stl' })
    .click()
  await page.locator('.model-viewer canvas').waitFor()
  await page.waitForFunction(() => !document.querySelector('.model-viewer-overlay'))
  assert.equal(await page.locator('.model-viewer-error').count(), 0)

  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.locator('.file-tree-name').getByText('说明.md', { exact: true }).click()
  await page.locator('.tiptap[contenteditable="true"]').waitFor()
  await page.getByLabel('工作版面', { exact: true }).selectOption('focus')
  await page
    .locator('.tiptap[contenteditable="true"]')
    .fill('工程说明\n独立工程原文\n版面切换继续编辑')
  await page.getByLabel('工作版面', { exact: true }).selectOption('standard')
  assert((await page.locator('.tiptap').innerText()).includes('版面切换继续编辑'))
  await page.getByRole('button', { name: '新建浏览器页', exact: true }).click()
  await page.locator('.browser-toolbar').waitFor()
  await page.getByLabel('浏览器地址', { exact: true }).fill(browserUrl)
  assert.equal(await page.getByLabel('浏览器地址', { exact: true }).inputValue(), browserUrl)
  await page.getByLabel('浏览器地址', { exact: true }).press('Enter')
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      await app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .some((content) => content.getURL() === url && !content.isLoading()),
        browserUrl,
      )
    )
      break
    await page.waitForTimeout(150)
  }
  for (const layout of ['focus', 'standard']) {
    await page.getByLabel('工作版面', { exact: true }).selectOption(layout)
    await page.waitForTimeout(250)
    const evidence = await app.evaluate(async ({ webContents }, url) => {
      const content = webContents.getAllWebContents().find((content) => content.getURL() === url)
      return {
        zoom: content.getZoomFactor(),
        title: await content.executeJavaScript('document.body.innerText'),
      }
    }, browserUrl)
    assert.equal(evidence.zoom, 1)
    assert(evidence.title.includes('器件资料验收'))
  }
  await page.locator('.tab-title').getByText('说明.md', { exact: true }).click()
  assert((await page.locator('.tiptap').innerText()).includes('版面切换继续编辑'))
  await page.locator('.file-tree-name').getByText('外壳.stl', { exact: true }).click()
  await page.locator('.model-viewer canvas').waitFor()
  await page.waitForFunction(() => !document.querySelector('.model-viewer-overlay'))
  assert.equal(await page.locator('.model-viewer-error').count(), 0)
  await page.getByLabel('工作版面', { exact: true }).selectOption('focus')
  await page.screenshot({ path: join(root, 'engineering-model-layout.png') })
  await page.getByRole('button', { name: '我的公司', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await writeFile(join(company, '公司模型.stl'), stl)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.locator('.file-tree-name').getByText('公司模型.stl', { exact: true }).click()
  await page.locator('.model-viewer canvas').waitFor()
  await page.waitForFunction(() => !document.querySelector('.model-viewer-overlay'))
  assert.equal(
    (await page.getByRole('button', { name: '业务项目', exact: true }).count()) > 0,
    true,
  )
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('.settings-nav').getByText('网站与账号', { exact: true }).click()
  await page.getByRole('heading', { name: '网站与账号', exact: true }).waitFor()
  await page.locator('.settings-nav').getByText('角色', { exact: true }).click()
  await page.getByRole('heading', { name: '角色', exact: true }).waitFor()
  await page.screenshot({ path: join(root, 'settings-management.png') })
  await page.locator('.settings-nav').getByText('数据源连接', { exact: true }).click()
  await page.getByText('添加 Elasticsearch', { exact: true }).waitFor()
  await page.screenshot({ path: join(root, 'data-connections-audit.png') })
  await page.locator('.settings-nav').getByText('远程设备', { exact: true }).click()
  await page.getByRole('heading', { name: '远程设备', exact: true }).waitFor()
  await page.locator('.activity-more > summary').click()
  await page.getByRole('button', { name: '数据源', exact: true }).click()
  await page.getByRole('button', { name: '管理数据源连接 →', exact: true }).waitFor()
  assert.equal(
    await page.locator('.sidebar').getByText('添加 Elasticsearch', { exact: true }).count(),
    0,
  )
  for (const [path, bytes] of originals) assert.equal(await readFile(path, 'utf8'), bytes)
  await page.getByRole('button', { name: '业务项目', exact: true }).first().click()
  await page.locator('.company-link').getByText('智能眼镜', { exact: true }).click()
  await page.getByRole('button', { name: '新建工程并关联', exact: true }).click()
  await pick(home)
  const form = page.getByRole('region', { name: '新建项目表单' })
  assert.equal(await form.getByLabel('项目类型', { exact: true }).inputValue(), 'electronics')
  await form.getByLabel('新项目名称', { exact: true }).fill('电源研发')
  await form.getByRole('button', { name: '选择父目录', exact: true }).click()
  await form.getByRole('button', { name: '创建并打开', exact: true }).click()
  await page.getByRole('heading', { name: '工程概览', exact: true }).waitFor()
  await page.getByRole('button', { name: '我的公司', exact: true }).click()
  await page.getByRole('button', { name: '业务项目', exact: true }).first().click()
  await page.locator('.company-link').getByText('智能眼镜', { exact: true }).click()
  await page
    .locator('.company-row')
    .filter({ hasText: '关联工程' })
    .getByText('电源研发', { exact: true })
    .waitFor()
  // Fixed labels are shortcuts; explicitly changing the referenced type must change its home.
  await page.getByRole('button', { name: '当前项目设置', exact: true }).click()
  await page.getByLabel('项目类型', { exact: true }).selectOption('general')
  await page.getByRole('button', { name: '保存项目设置', exact: true }).click()
  await page.getByText('项目设置已保存；原文件与任务保持原位。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '我的公司', exact: true }).click()
  await page.getByRole('heading', { name: '模拟公司', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '业务项目', exact: true }).count(), 0)
  await page.getByRole('button', { name: '当前项目设置', exact: true }).click()
  await page.getByLabel('项目类型', { exact: true }).selectOption('company')
  await page.getByRole('button', { name: '保存项目设置', exact: true }).click()
  await page.getByText('项目设置已保存；原文件与任务保持原位。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '我的公司', exact: true }).click()
  await page.getByRole('heading', { name: '公司总览', exact: true }).waitFor()
  await page.getByRole('button', { name: '业务项目', exact: true }).first().click()
  await page.locator('.company-link').getByText('智能眼镜', { exact: true }).waitFor()
  const secondCompany = await createProject('company', '第二家公司')
  await page.getByLabel('公司显示名称', { exact: true }).fill('第二家公司')
  await page.getByRole('button', { name: '开始使用', exact: true }).click()
  await page.getByRole('button', { name: '业务项目', exact: true }).first().click()
  assert.equal(
    await page.locator('.company-link').getByText('智能眼镜', { exact: true }).count(),
    0,
  )
  await page.keyboard.press('Meta+Shift+p')
  await page.getByPlaceholder('输入命令...').fill('打开财务')
  await page.locator('.command-palette-label').getByText('打开财务', { exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('.tab.active')?.textContent.includes('公司账目'),
  )
  assert(
    (await page.locator('.status-bar-workspace').getAttribute('title')).includes(secondCompany),
  )
  assert.equal(
    await page.locator('.activity-bar [aria-label="公司账目"][aria-pressed="true"]').count(),
    1,
  )
  await page.screenshot({ path: join(root, 'second-company-audit.png') })
  // New-machine simulation: fresh application profile, no prior local paths, tasks or bindings.
  await app.close()
  app = null
  profile = join(root, 'new-mac-profile')
  await mkdir(profile)
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({ componentSetupPageSeenVersion: 2, claudeRuntimeSource: 'system' }),
  )
  page = await launch()
  const downloads = join(home, '新电脑资料')
  await mkdir(downloads)
  await pick(downloads)
  await page.getByRole('button', { name: '新建或打开项目', exact: true }).click()
  await page.getByRole('button', { name: '从 Git 获取…', exact: false }).click()
  await page.getByLabel('获取项目仓库地址', { exact: true }).fill(remote)
  await page.getByRole('button', { name: '选择 Git 保存位置', exact: true }).click()
  await page.getByRole('button', { name: '获取并打开', exact: true }).click()
  await page.getByText('原日记保持不变', { exact: true }).waitFor()
  const copy = await page.evaluate(
    async (downloads) =>
      (await window.cclinkStudio.workspaceState.listLocalWorkspaces()).find((item) =>
        item.workspacePath.startsWith(downloads + '/'),
      ).workspacePath,
    downloads,
  )
  assert(copy.startsWith(downloads + '/'))
  assert.notEqual(copy, workspace)
  await page.getByRole('button', { name: '定时整理', exact: true }).click()
  await page.getByText('尚未接回任务定义。', { exact: false }).waitFor()
  await page.getByText('导出 / 接回原任务定义', { exact: true }).click()
  await page.getByLabel('任务定义 JSON', { exact: true }).fill(bundle)
  await page
    .getByLabel('已核对时间、时区、资源和输出位置；我会另行核对其他电脑的任务执行情况', {
      exact: true,
    })
    .check()
  await page.getByRole('button', { name: '接回定义（不启用）', exact: true }).click()
  await page.getByText('定义已接回；', { exact: false }).waitFor()
  await page.getByRole('button', { name: '保存任务关联', exact: true }).click()
  const imported = await page.evaluate(
    (path) => window.cclinkStudio.scheduledTasks.inspect(path),
    copy,
  )
  assert.equal(imported.tasks.length, 2)
  assert(imported.tasks.every((task) => !task.activation.enabled))
  assert.deepEqual(
    imported.tasks.map((t) => t.definition.id).sort(),
    tasks.map((t) => t.definition.id).sort(),
  )
  await page.getByRole('button', { name: '接回定义（不启用）', exact: true }).click()
  assert.equal(
    (await page.evaluate((path) => window.cclinkStudio.scheduledTasks.inspect(path), copy)).tasks
      .length,
    2,
  )
  await page.screenshot({ path: join(root, 'new-mac-tasks-paused.png') })
  await page.getByRole('button', { name: '当前项目设置', exact: true }).click()
  await page.getByRole('button', { name: '将此项目关联到“我的空间”', exact: true }).click()
  await page
    .getByText('“我的空间”已关联当前项目；旧项目和资料保持原位。', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: '我的空间', exact: true }).click()
  await page.getByText('原日记保持不变', { exact: true }).waitFor()
  await page.screenshot({ path: join(root, 'new-mac-diary.png') })
  await page
    .locator('.personal-diary-home')
    .getByRole('button')
    .filter({ hasText: '每日简报' })
    .click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '在此设备启用', exact: true }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor()
  const enabled = await page.evaluate(
    (path) => window.cclinkStudio.scheduledTasks.inspect(path),
    copy,
  )
  assert.equal(enabled.tasks.filter((task) => task.activation.enabled).length, 1)
  const rejectedHandoff = await page.evaluate(
    async (path) =>
      window.cclinkStudio.workspaceState.setSection(path, 'personalDiarySource', null),
    copy,
  )
  assert.equal(rejectedHandoff.success, false)
  assert.match(rejectedHandoff.error, /启用或运行/)
  const removedTask = await page.evaluate(async (path) => {
    const state = await window.cclinkStudio.workspaceState.get(path)
    return window.cclinkStudio.workspaceState.setSection(path, 'personalDiarySource', {
      ...state.sections.personalDiarySource,
      taskIds: [],
    })
  }, copy)
  assert.equal(removedTask.success, false)
  assert.match(removedTask.error, /启用或运行/)

  await page.getByRole('button', { name: '进行中的工作', exact: true }).click()
  const runningDialog = page.getByRole('dialog').filter({ hasText: '刷新工作状态' })
  await runningDialog.getByRole('button').filter({ hasText: '每日简报' }).waitFor()
  await page.screenshot({ path: join(root, 'running-work.png') })
  await runningDialog.getByRole('button').filter({ hasText: '每日简报' }).click()

  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.getByRole('button', { name: '在此设备启用', exact: true }).waitFor()
  await app.close()
  app = null
  page = await launch()
  await page.getByRole('button', { name: '我的空间', exact: true }).click()
  await page.getByText('原日记保持不变', { exact: true }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.cclinkStudio.workspaceState.getFixedSpaces())).personal
      .workspacePath,
    copy,
  )
  for (const [path, bytes] of originals) assert.equal(await readFile(path, 'utf8'), bytes)
  const result = {
    root,
    passed: [
      'per-project pinned tool order restores and does not leak into another project',
      'engineering homepage lists actual files from the existing scan service',
      'data connection configuration in settings while querying remains in tools',
      'remote settings entry reachable without blocking local work',
      'two company instances keep separate records and finance command stays in current company',
      'company activity selection reflects the actual finance page',
      'removing linked enabled task is rejected before association changes',
      'project type and relative diary settings through UI',
      'original task export bytes preserved',
      'configuration shared alone without local identity',
      'company business links original engineering project',
      'new engineering project created and associated from the same business form',
      'native browser content and 100% zoom survive both layouts',
      'Markdown layout and browser switching retains edited content',
      '3D viewer in electronics and company without changing project type',
      'accounts and roles accessible through settings',
      'fresh profile Git clone restores diary type and original text',
      'missing private task definitions reported honestly',
      'import preserves two task IDs and defaults paused',
      'repeat import creates no duplicate',
      'explicit shared task enable and pause in real UI',
      'running-work summary returns to the original task',
      'main process refuses source detachment while linked task is enabled',
      'fixed shortcut rebinding and restart restore',
      'fixed company shortcut respects changed type and preserves business records when changed back',
      'original diary, attachments, plans and local task bytes unchanged',
    ],
    scope:
      'Real Electron, isolated profiles and local bare Git; no hosted account or external model calls',
  }
  await writeFile(join(root, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  if (app) {
    console.log(await page.locator('body').innerText())
    await page.screenshot({ path: join(root, 'failure.png') })
  }
  console.log('ROOT', root)
  throw error
} finally {
  if (app) await app.close()
  server.close()
}
