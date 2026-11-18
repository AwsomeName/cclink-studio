import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-typed-smoke-')))
const workspace = join(root, 'home/woniu-forward')
const profile = join(root, 'profile')
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
  await page.waitForSelector('.main-window')
  return page
}
try {
  let page = await launch()
  const tasks = await page.evaluate(async (workspace) => {
    await window.cclinkStudio.workspaceState.listLocalWorkspaces()
    await window.cclinkStudio.workspaceState.get(workspace)
    const result = []
    for (const title of ['每日简报', '每周计划和总结']) {
      const saved = await window.cclinkStudio.scheduledTasks.save({
        workspacePath: workspace,
        title,
        instruction: '读取原日记，未知事实留空',
        schedule:
          title === '每日简报'
            ? { kind: 'daily', time: '23:59', timezone: 'Asia/Shanghai' }
            : { kind: 'weekly', time: '23:59', weekdays: [1], timezone: 'Asia/Shanghai' },
        resources: [{ kind: 'workspace' }],
        outputPolicy: {
          directory: '000-个人计划',
          fileNameTemplate: '{date}.md',
          mode: 'create-only',
        },
        enable: false,
      })
      if (!saved.success) throw Error(JSON.stringify(saved))
      result.push(saved.task)
    }
    return result
  }, workspace)
  for (const task of tasks) {
    const p = join(workspace, '.cclink-studio/scheduled-tasks', task.definition.id + '.json')
    originals.set(p, await readFile(p, 'utf8'))
  }
  await app.evaluate(({ dialog }, parent) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent] })
  }, home)
  await page.getByRole('button', { name: '新建或打开项目', exact: true }).click()
  await page.getByRole('button', { name: '新建项目…', exact: false }).click()
  await page.getByLabel('项目类型', { exact: true }).selectOption('diary')
  await page.getByLabel('新项目名称', { exact: true }).fill('独立日记')
  await page.getByRole('button', { name: '选择父目录', exact: true }).click()
  await page.getByRole('button', { name: '创建并打开', exact: true }).click()
  await page.locator('.personal-diary-home').waitFor()
  const typed = join(home, '独立日记')
  const configFile = join(typed, '.cclink-studio/workspace-settings.json')
  assert.equal(JSON.parse(await readFile(configFile, 'utf8')).type, 'diary')
  await page.getByRole('button', { name: '当前项目设置', exact: true }).click()
  await page.getByLabel('项目显示名称', { exact: true }).fill('旅行日记')
  await page.getByRole('button', { name: '保存项目设置', exact: true }).click()
  await page.getByText('项目设置已保存；原文件与任务保持原位。', { exact: true }).waitFor()
  assert.equal(JSON.parse(await readFile(configFile, 'utf8')).name, '旅行日记')
  await page.screenshot({ path: join(root, 'workspace-settings.png') })
  const collision = await page.evaluate(async (parent) => {
    try {
      await window.cclinkStudio.workspaceState.createWorkspace({
        parentPath: parent,
        directoryName: '独立日记',
        settings: { version: 1, name: '覆盖', type: 'company' },
      })
      return false
    } catch {
      return true
    }
  }, home)
  assert.equal(collision, true)
  assert.equal(JSON.parse(await readFile(configFile, 'utf8')).name, '旅行日记')
  await page.getByRole('button', { name: '我的空间', exact: true }).click()
  await page.getByRole('button', { name: '从空白日记开始', exact: true }).click()
  await page.getByRole('button', { name: '创建今日空白模板', exact: true }).waitFor()
  await page.getByRole('button', { name: '资料接入', exact: true }).click()
  await page.getByLabel('原工作空间', { exact: true }).selectOption(workspace)
  await page.getByLabel('个人资料目录', { exact: true }).fill('000-个人计划')
  await page.getByRole('button', { name: '确认连接', exact: true }).click()
  await page
    .locator('.personal-diary-home')
    .getByRole('button')
    .filter({ hasText: filename })
    .waitFor()
  await page.getByRole('button', { name: '计划', exact: true }).click()
  await page
    .locator('.personal-diary-home')
    .getByRole('button')
    .filter({ hasText: '一日生活计划.md' })
    .waitFor()
  await page.getByRole('button', { name: '定时整理', exact: true }).click()
  await page.getByLabel('每日简报', { exact: true }).check()
  await page.getByLabel('每周计划和总结', { exact: true }).check()
  await page.getByRole('button', { name: '保存任务关联', exact: true }).click()
  await page.waitForTimeout(300)
  const after = await page.evaluate(
    (path) => window.cclinkStudio.scheduledTasks.inspect(path),
    workspace,
  )
  assert.deepEqual(
    after.tasks.map((t) => t.definition.id).sort(),
    tasks.map((t) => t.definition.id).sort(),
  )
  assert(after.tasks.every((t) => !t.activation.enabled))
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await page.getByRole('article', { name: '日记正文预览' }).waitFor()
  const layout = await page
    .locator('.workspace-home')
    .evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }))
  assert(layout.scroll <= layout.client + 1, JSON.stringify(layout))
  assert.equal(
    await page
      .locator('#workspace-sidebar')
      .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    0,
  )
  await page.screenshot({ path: join(root, 'personal-home.png') })
  await page
    .locator('.personal-diary-home')
    .getByRole('button')
    .filter({ hasText: '每日简报' })
    .click()
  assert.equal(await page.getByLabel('任务名称', { exact: true }).inputValue(), '每日简报')
  await page.getByRole('button', { name: '我的空间', exact: true }).click()

  await page
    .locator('.personal-diary-home')
    .getByRole('button')
    .filter({ hasText: filename })
    .click()
  await page
    .getByRole('article', { name: '日记正文预览' })
    .getByText('原日记保持不变', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: '继续写原文', exact: true }).click()
  await page.getByText('原日记保持不变', { exact: true }).waitFor()
  for (const [path, content] of originals) assert.equal(await readFile(path, 'utf8'), content)
  await app.close()
  app = null
  page = await launch()
  await page.getByRole('button', { name: '我的空间', exact: true }).click()
  await page
    .locator('.personal-diary-home')
    .getByRole('button')
    .filter({ hasText: filename })
    .waitFor()
  await page
    .locator('.personal-diary-home')
    .getByRole('button')
    .filter({ hasText: '每日简报' })
    .waitFor()
  for (const [path, content] of originals) assert.equal(await readFile(path, 'utf8'), content)
  await page.screenshot({ path: join(root, 'restart-home.png') })
  // Real application creation in a second empty directory; the original source is untouched.
  await mkdir(join(workspace, '空白日记'))
  await page.getByRole('button', { name: '资料接入', exact: true }).click()
  await page.getByLabel('个人资料目录', { exact: true }).fill('空白日记')
  await page.getByRole('button', { name: '确认连接', exact: true }).click()
  await page.getByRole('button', { name: '用“每日简报”准备今天', exact: true }).click()
  await page
    .locator('.personal-diary-home [role="alert"]')
    .filter({ hasText: '未修改或运行原任务' })
    .waitFor()
  const noRuns = await page.evaluate(
    async (path) =>
      (await window.cclinkStudio.scheduledTasks.inspect(path)).tasks.every(
        (task) => !task.latestRun,
      ),
    workspace,
  )
  assert.equal(noRuns, true)
  await page.getByRole('button', { name: '创建今日空白模板', exact: true }).click()
  await page
    .getByText('已新建今日空白模板；尚未运行 AI 整理，未知事实保持空白。', { exact: true })
    .waitFor()
  const createdPath = join(workspace, '空白日记', String(now.getFullYear()), month, filename)
  const createdBytes = await readFile(createdPath, 'utf8')
  assert(createdBytes.includes('## 今日待做'))
  const again = await page.evaluate(() =>
    window.cclinkStudio.workspaceState.getFixedSpaces().then((spaces) =>
      window.cclinkStudio.workspaceState.diaryDocument({
        action: 'prepare',
        workspacePath: spaces.personal.workspacePath,
      }),
    ),
  )
  assert.equal(again.created, false)
  assert.equal(await readFile(createdPath, 'utf8'), createdBytes)
  await page.screenshot({ path: join(root, 'prepared-today.png') })
  await page.getByRole('button', { name: '资料接入', exact: true }).click()
  await page.getByLabel('个人资料目录', { exact: true }).fill('000-个人计划')
  await page.getByRole('button', { name: '确认连接', exact: true }).click()

  // Real local bare remote and real Git processes; no user's server or credentials are used.
  const seed = join(home, 'git-seed')
  const remote = join(home, 'remote.git')
  await mkdir(seed)
  const git = async (cwd, args) =>
    (
      await exec('git', ['-c', 'credential.helper=', ...args], {
        cwd,
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      })
    ).stdout.trim()
  await git(seed, ['init', '--initial-branch=main'])
  await git(seed, ['config', 'user.name', 'Diary Acceptance'])
  await git(seed, ['config', 'user.email', 'diary@example.invalid'])
  await mkdir(join(seed, directory), { recursive: true })
  await writeFile(join(seed, directory, filename), '# 远程日记\n远程初版正文\n')
  await mkdir(join(seed, '.cclink-studio/shared/scheduled-tasks'), { recursive: true })
  const def = tasks[1].definition
  const shared = Object.fromEntries(
    [
      'schemaVersion',
      'id',
      'revision',
      'title',
      'instruction',
      'schedule',
      'resources',
      'outputPolicy',
      'createdAt',
      'updatedAt',
    ].map((key) => [key, def[key]]),
  )
  await writeFile(
    join(seed, '.cclink-studio/shared/scheduled-tasks', def.id + '.json'),
    JSON.stringify(shared),
  )
  await git(seed, ['add', '.'])
  await git(seed, ['commit', '-m', 'Initial diary'])
  await git(home, ['init', '--bare', '--initial-branch=main', remote])
  await git(seed, ['remote', 'add', 'origin', remote])
  await git(seed, ['push', '-u', 'origin', 'main'])
  await page.getByRole('button', { name: 'Git', exact: true }).click()
  await page.getByLabel('仓库地址', { exact: true }).fill(remote)
  await page.getByLabel('Git 分支', { exact: true }).fill('missing-branch')
  await page.getByRole('button', { name: '从 Git 拉取到新目录', exact: true }).click()
  await page.locator('.diary-git [role="alert"]').filter({ hasText: '拉取失败' }).waitFor()
  const retained = await page.evaluate(
    async () =>
      (
        await window.cclinkStudio.workspaceState.get(
          (await window.cclinkStudio.workspaceState.getFixedSpaces()).personal.workspacePath,
        )
      ).sections.personalDiarySource.workspacePath,
  )
  assert.equal(retained, workspace)
  await page.getByLabel('Git 分支', { exact: true }).fill('main')
  await page.getByRole('button', { name: '从 Git 拉取到新目录', exact: true }).click()
  await page.getByRole('heading', { name: '新副本已拉取，尚未替换资料来源' }).waitFor()
  await page.getByLabel('确认副本切换', { exact: true }).check()
  await page.getByRole('button', { name: '确认改用此副本', exact: true }).click()
  await page.getByText('远程初版正文', { exact: true }).waitFor()
  const getSource = () =>
    page.evaluate(
      async () =>
        (
          await window.cclinkStudio.workspaceState.get(
            (await window.cclinkStudio.workspaceState.getFixedSpaces()).personal.workspacePath,
          )
        ).sections.personalDiarySource,
    )
  const firstCopy = (await getSource()).workspacePath
  assert.notEqual(firstCopy, workspace)
  const sharedTasks = await page.evaluate(
    (path) => window.cclinkStudio.scheduledTasks.inspect(path),
    firstCopy,
  )
  assert(sharedTasks.success)
  assert.equal(sharedTasks.tasks.length, 1)
  assert.equal(sharedTasks.tasks[0].definition.id, def.id)
  assert.equal(sharedTasks.tasks[0].activation.enabled, false)
  await page.screenshot({ path: join(root, 'git-cloned.png') })
  await writeFile(join(seed, directory, filename), '# 远程日记\n远程更新后的正文\n')
  await writeFile(join(seed, directory, '新增计划.md'), '# 远程新增计划\n')
  await git(seed, ['add', '.'])
  await git(seed, ['commit', '-m', 'Update diary'])
  await git(seed, ['push'])
  await page.getByRole('button', { name: 'Git', exact: true }).click()
  await page.getByRole('button', { name: '检查远程更新', exact: true }).click()
  await page.getByRole('button', { name: '将已审阅更新拉取为新副本', exact: true }).waitFor()
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (b) => b.textContent === '将已审阅更新拉取为新副本' && !b.disabled,
    ),
  )
  assert.equal(
    await readFile(join(firstCopy, directory, filename), 'utf8'),
    '# 远程日记\n远程初版正文\n',
  )
  await page.screenshot({ path: join(root, 'git-review.png') })
  const localOnly = join(firstCopy, '尚未上传.md')
  await writeFile(localOnly, '不要丢失')
  await page.getByRole('button', { name: '检查远程更新', exact: true }).click()
  await page.getByText('?? 尚未上传.md', { exact: false }).waitFor()
  assert(
    await page.getByRole('button', { name: '将已审阅更新拉取为新副本', exact: true }).isDisabled(),
  )
  // Exercise the main-process boundary too: renderer enablement is not the protection boundary.
  const blocked = await page.evaluate(async (path) => {
    const preview = await window.cclinkStudio.git.transfer({
      action: 'inspect',
      workspacePath: path,
    })
    if (!preview.success) throw Error(preview.error.message)
    return window.cclinkStudio.git.transfer({
      action: 'update-copy',
      workspacePath: path,
      expectedHead: preview.snapshot.head,
      expectedTarget: preview.snapshot.target,
    })
  }, firstCopy)
  assert.equal(blocked.success, false)
  assert.match(blocked.error.message, /未提交/)
  await rm(localOnly) // only our newly created isolated test file
  await page.getByRole('button', { name: '检查远程更新', exact: true }).click()
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (b) => b.textContent === '将已审阅更新拉取为新副本' && !b.disabled,
    ),
  )
  await page.getByRole('button', { name: '将已审阅更新拉取为新副本', exact: true }).click()
  await page.getByRole('heading', { name: '新副本已拉取，尚未替换资料来源' }).waitFor()
  await page.getByLabel('确认副本切换', { exact: true }).check()
  await page.getByRole('button', { name: '确认改用此副本', exact: true }).click()
  await page.getByText('远程更新后的正文', { exact: true }).waitFor()
  const secondCopy = (await getSource()).workspacePath
  assert.notEqual(secondCopy, firstCopy)
  assert.equal(
    await readFile(join(firstCopy, directory, filename), 'utf8'),
    '# 远程日记\n远程初版正文\n',
  )
  for (const [path, content] of originals) assert.equal(await readFile(path, 'utf8'), content)
  await page.screenshot({ path: join(root, 'git-updated.png') })
  await app.close()
  app = null
  page = await launch()
  await page.getByRole('button', { name: '我的空间', exact: true }).click()
  await page.getByText('远程更新后的正文', { exact: true }).waitFor()
  assert.equal((await getSource()).workspacePath, secondCopy)
  const result = {
    root,
    passed: [
      'new diary project and display name saved through UI',
      'existing destination rejected without overwriting settings',
      'first-run offline diary source available',
      'connect original files',
      'plans visible',
      'original body visible in homepage preview',
      'personal sidebar navigation',
      'same two task IDs',
      'original task settings opens',
      'activation unchanged',
      'original editor opens',
      'restart restores connection',
      'all original Markdown and task definition bytes unchanged',
      'prepare today creates blank template once',
      'mismatched original daily task is not rewritten or run',
      'failed clone retains original connection and data',
      'real Git clone and confirmed source mapping',
      'shared task retains ID and is not enabled',
      'fetch shows updates without changing original worktree',
      'dirty worktree blocks updates in UI and main process',
      'reviewed update creates separate copy and preserves previous original',
      'updated body and source survive app restart',
    ],
    scope:
      'isolated real Electron and actual local Git remote; simulated user data; no external model or hosted Git credentials',
  }
  await writeFile(join(root, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  if (app) {
    const page = await app.firstWindow()
    console.log(await page.locator('body').innerText())
    await page.screenshot({ path: join(root, 'failure.png') })
    console.log('ROOT', root)
  }
  throw error
} finally {
  if (app) await app.close()
}
