// Real Electron + real git with a local bare remote: machine A shares a diary project; machine B
// clones into a chosen empty folder, reviews and switches; then a reviewed update is applied as a
// new copy. Simulated data only; nothing is pushed anywhere except the local bare test remote.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, confirmExisting, shots } from './diary-acceptance-lib.mjs'

const exec = promisify(execFile)
const git = async (cwd, args) =>
  (
    await exec(
      'git',
      [
        '-c',
        'credential.helper=',
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        ...args,
      ],
      {
        cwd,
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      },
    )
  ).stdout.trim()
const TZ = 'Asia/Shanghai'
const D = '000-个人计划'
const root = await makeRoot('.cclink-machines-')
const result = {}
async function gotoGit(page) {
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '项目首页', exact: true })
    .first()
    .click()
  await page.getByRole('button', { name: '项目设置' }).first().click()
  await page.getByRole('button', { name: 'Git 配置与更新' }).click()
  await page.getByLabel('仓库地址', { exact: true }).waitFor()
}

// Machine A: the existing diary project with shared task definitions and an attachment.
const a = await makeHome(root, 'machine-a')
const projectA = join(a.home, 'woniu-forward-模拟')
await writeDiary(projectA, D, '2026/11/1117_周二.md', '# 周二\n![图](1117_周二.assets/板子.png)\n')
await mkdir(join(projectA, D, '2026/11/1117_周二.assets'), { recursive: true })
await writeFile(join(projectA, D, '2026/11/1117_周二.assets/板子.png'), 'PNG-SIMULATED')
await writeDiary(projectA, D, '2026/周计划/第47周.md', '# 第47周\n')
// The simulated network remote lives in A's home; B's home is the parent, so both can reach it.
const remote = join(a.home, 'remote.git')
await git(root, ['init', '--bare', '--initial-branch=main', remote])
let taskIds = []
try {
  const page = await a.launch()
  page.on('dialog', (d) => void d.accept())
  await confirmExisting(a, projectA)
  for (const [title, schedule, outputPolicy] of [
    [
      '每日简报',
      { kind: 'daily', time: '07:30', timezone: TZ },
      {
        directory: `${D}/{year}/{month}`,
        fileNameTemplate: '{monthDay}_{weekday}.md',
        mode: 'create-only',
      },
    ],
    [
      '每周复盘',
      { kind: 'weekly', time: '21:00', weekdays: [0], timezone: TZ },
      {
        directory: `${D}/{year}/周计划`,
        fileNameTemplate: '{date}-周复盘.md',
        mode: 'create-only',
      },
    ],
  ])
    taskIds.push(
      await page.evaluate(
        async (i) => {
          const r = await window.cclinkStudio.scheduledTasks.save(i)
          if (!r.success) throw Error(JSON.stringify(r.error))
          return r.task.definition.id
        },
        {
          workspacePath: projectA,
          title,
          instruction: `${title}：依次写指定章节。`,
          schedule,
          resources: [{ kind: 'workspace' }, { kind: 'directory', path: D }],
          outputPolicy,
          definitionSource: 'shared',
          enable: false,
        },
      ),
    )
  // Machine A keeps its own activation for the daily task; that must not travel.
  await page.evaluate(
    ({ p, id }) =>
      window.cclinkStudio.scheduledTasks.setEnabled({
        workspacePath: p,
        taskId: id,
        enabled: true,
      }),
    { p: projectA, id: taskIds[0] },
  )
  await a.close()
  await git(projectA, ['init', '--initial-branch=main'])
  await git(projectA, ['add', D, '.cclink-studio/workspace-settings.json', '.cclink-studio/shared'])
  await git(projectA, ['commit', '-m', '模拟日记初版'])
  await git(projectA, ['remote', 'add', 'origin', remote])
  await git(projectA, ['push', '-u', 'origin', 'main'])
  result.sharedFiles = (await git(projectA, ['ls-files'])).split('\n')
  // An existing matching repository pre-fills its origin and branch on the Git page.
  const page2 = await a.launch()
  await page2.locator(`.project-strip-item[data-project-path="${projectA}"]`).click()
  await page2.locator('.personal-diary-home h2').filter({ hasText: '今天' }).waitFor()
  await gotoGit(page2)
  for (
    let i = 0;
    i < 30 && (await page2.getByLabel('仓库地址', { exact: true }).inputValue()) !== remote;
    i++
  )
    await page2.waitForTimeout(200)
  assert.equal(await page2.getByLabel('仓库地址', { exact: true }).inputValue(), remote)
  assert.equal(await page2.getByLabel('Git 分支').inputValue(), 'main')
  await page2.screenshot({ path: join(shots, 'git-existing-origin.png') })
  await a.close()
} catch (e) {
  await a.fail(e)
}

// Machine B: first use, Git checked, clone into a chosen empty folder, review, switch.
const b = await makeHome(root, 'machine-b', { appHome: root })
const chosen = join(b.home, '资料', '我的空间')
await mkdir(chosen, { recursive: true })
try {
  const page = await b.launch()
  page.on('dialog', (d) => void d.accept())
  await page.getByRole('button', { name: '我的空间', exact: true }).first().click()
  await page.getByRole('heading', { name: '确认本地项目目录' }).waitFor()
  await page.getByLabel('确认目录后配置 Git 同步').check()
  await page.getByRole('button', { name: '确认并进入项目' }).click()
  await page.getByLabel('仓库地址', { exact: true }).fill(remote)
  await page.getByLabel('Git 分支').fill('main')
  await b.pickDirectory(chosen)
  await page.getByRole('button', { name: '选择空目录…' }).click()
  await page.getByText('本地目的地：' + chosen).waitFor()
  await page.screenshot({ path: join(shots, 'git-clone-destination.png') })
  await page.getByRole('button', { name: '拉取到所选空目录' }).click()
  await page.getByRole('heading', { name: '新副本已拉取，尚未替换资料来源' }).waitFor()
  await page.getByText('目录：' + chosen).waitFor()
  await page.getByText('核对副本目录与任务输出').click()
  await page.getByText(/每日简报 · 读取/).waitFor()
  await page.getByLabel('确认副本切换').check()
  await page.screenshot({ path: join(shots, 'git-clone-review.png') })
  await page.getByRole('button', { name: '确认改用此副本' }).click()
  await page.locator('.personal-diary-home h2').filter({ hasText: '今天' }).waitFor()
  assert.equal(await b.fixedRoot(), chosen)
  assert.equal(
    await readFile(join(chosen, D, '2026/11/1117_周二.assets/板子.png'), 'utf8'),
    'PNG-SIMULATED',
  )
  // The empty default folder's tab is closed; the folder itself stays on disk.
  const shell = join(root, 'CCLink Studio', '我的空间')
  assert.equal(await page.locator(`.project-strip-item[data-project-path="${shell}"]`).count(), 0)
  assert((await readdir(shell)).includes('.cclink-studio'))
  const tasks = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), chosen)
  assert(tasks.success, JSON.stringify(tasks.error))
  result.machineBTasks = tasks.tasks.map((t) => ({
    id: t.definition.id,
    title: t.definition.title,
    enabled: t.activation.enabled,
  }))
  assert.deepEqual(new Set(tasks.tasks.map((t) => t.definition.id)), new Set(taskIds))
  assert(tasks.tasks.every((t) => !t.activation.enabled))
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '定时整理', exact: true })
    .first()
    .click()
  await page
    .locator('.workspace-home-record')
    .filter({ hasText: '每日简报' })
    .getByText('此设备未启用')
    .waitFor()
  await page.screenshot({ path: join(shots, 'git-machine-b-tasks.png') })
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '日记', exact: true })
    .first()
    .click()
  await page.locator('.workspace-home-record').filter({ hasText: '1117_周二.md' }).click()
  await page.getByRole('article', { name: '日记正文预览' }).waitFor()
  await page.screenshot({ path: join(shots, 'git-machine-b-diary.png') })
  await b.close()
  await b.launch()
  await b.page.locator(`.project-strip-item[data-project-path="${chosen}"]`).click()
  await b.page.locator('.personal-diary-home h2').filter({ hasText: '今天' }).waitFor()
  assert.equal(await b.fixedRoot(), chosen)

  // Safe update: machine A publishes a new diary; B reviews, is blocked by local changes,
  // then applies the reviewed version as a new copy and confirms the switch.
  await writeDiary(projectA, D, '2026/11/1121_周六.md', '# 周六\n来自 A 的更新\n')
  await git(projectA, ['add', D])
  await git(projectA, ['commit', '-m', '新增周六'])
  await git(projectA, ['push'])
  const p = b.page
  await gotoGit(p)
  await p.getByRole('button', { name: '检查远程更新', exact: true }).click()
  await p.getByText(/A\s+000-个人计划\/2026\/11\/1121_周六.md/).waitFor()
  const localOnly = join(chosen, '本机草稿.md')
  await writeFile(localOnly, '未提交')
  await p.getByRole('button', { name: '检查远程更新', exact: true }).click()
  await p.getByText('?? 本机草稿.md', { exact: false }).waitFor()
  assert(
    await p.getByRole('button', { name: '将已审阅更新拉取为新副本', exact: true }).isDisabled(),
  )
  await p.screenshot({ path: join(shots, 'git-update-blocked.png') })
  await rm(localOnly)
  await p.getByRole('button', { name: '检查远程更新', exact: true }).click()
  await p.getByText('工作目录干净').waitFor()
  await p.screenshot({ path: join(shots, 'git-update-review.png') })
  await p.getByRole('button', { name: '将已审阅更新拉取为新副本', exact: true }).click()
  await p.getByRole('heading', { name: '新副本已拉取，尚未替换资料来源' }).waitFor()
  await p.getByText('核对副本目录与任务输出').click()
  await p.getByText(/每日简报 · 读取/).waitFor()
  await p.getByLabel('确认副本切换').check()
  await p.getByRole('button', { name: '确认改用此副本' }).click()
  await p.locator('.personal-diary-home h2').filter({ hasText: '今天' }).waitFor()
  const updated = await b.fixedRoot()
  assert.notEqual(updated, chosen)
  assert.equal(
    await readFile(join(updated, D, '2026/11/1121_周六.md'), 'utf8'),
    '# 周六\n来自 A 的更新\n',
  )
  assert.deepEqual((await readdir(join(chosen, D, '2026/11'))).sort(), [
    '1117_周二.assets',
    '1117_周二.md',
  ])
  await p.screenshot({ path: join(shots, 'git-update-switched.png') })
  result.update = { previous: chosen, updated }
  console.log('PASS machines', JSON.stringify(result, null, 2))
} catch (e) {
  console.log('PARTIAL', JSON.stringify(result, null, 2))
  await b.fail(e)
} finally {
  await b.close()
}
