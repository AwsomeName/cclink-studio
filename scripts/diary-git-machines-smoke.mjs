// Real Electron + real git with a local bare remote: machine A shares a diary project; machine B
// sets up My Space by cloning into a chosen empty folder inside first use, then pulls a reviewed
// update in place. Simulated data only; nothing is pushed anywhere but the local test remote.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse, shots } from './diary-acceptance-lib.mjs'

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
      { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } },
    )
  ).stdout.trim()
const TZ = 'Asia/Shanghai'
const D = '000-个人计划'
const root = await makeRoot('.cclink-machines-')
const result = {}
const nav = (page, name) =>
  page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name, exact: true })
    .first()
    .click()

// Machine A: an existing diary project; first use creates the two built-in tasks, plus one more
// shared task that another device must enable by itself.
const a = await makeHome(root, 'machine-a')
const projectA = join(a.home, 'woniu-forward-模拟')
await writeDiary(projectA, D, '2026/11/1117_周二.md', '# 周二\n![图](1117_周二.assets/板子.png)\n')
await mkdir(join(projectA, D, '2026/11/1117_周二.assets'), { recursive: true })
await writeFile(join(projectA, D, '2026/11/1117_周二.assets/板子.png'), 'PNG-SIMULATED')
await writeDiary(projectA, D, '2026/周计划/第47周.md', '# 第47周\n')
// The simulated network remote lives in A's home; B's home is the parent, so both reach it.
const remote = join(a.home, 'remote.git')
await git(root, ['init', '--bare', '--initial-branch=main', remote])
try {
  const page = await a.launch()
  page.on('dialog', (d) => void d.accept())
  await firstUse(a, { directory: projectA })
  await page.evaluate(
    async (i) => {
      const r = await window.cclinkStudio.scheduledTasks.save(i)
      if (!r.success) throw Error(JSON.stringify(r.error))
    },
    {
      workspacePath: projectA,
      title: '整理参考资料',
      instruction: '整理资料目录。',
      schedule: { kind: 'daily', time: '22:00', timezone: TZ },
      resources: [{ kind: 'workspace' }, { kind: 'directory', path: D }],
      outputPolicy: {
        directory: `${D}/资料`,
        fileNameTemplate: '{date}-整理.md',
        mode: 'create-only',
      },
      definitionSource: 'shared',
      enable: true,
    },
  )
  const listed = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), projectA)
  result.machineATasks = listed.tasks.map((t) => [t.definition.title, t.activation.enabled])
  await a.close()
  await git(projectA, ['init', '--initial-branch=main'])
  await git(projectA, ['add', D, '.cclink-studio/workspace-settings.json', '.cclink-studio/shared'])
  await git(projectA, ['commit', '-m', '模拟日记初版'])
  await git(projectA, ['remote', 'add', 'origin', remote])
  await git(projectA, ['push', '-u', 'origin', 'main'])
} catch (e) {
  await a.fail(e)
}

// Machine B: first use clones into a chosen empty folder; nothing else is created.
const b = await makeHome(root, 'machine-b', { appHome: root })
const chosen = join(b.home, '资料', '我的空间')
await mkdir(chosen, { recursive: true })
try {
  const page = await b.launch()
  page.on('dialog', (d) => void d.accept())
  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  await wizard.getByText('1 选择目录').waitFor()
  await wizard.getByRole('button', { name: '下一步' }).click()
  await wizard.getByText('从已有仓库克隆到空目录').click()
  await wizard.getByLabel('仓库地址').fill(remote)
  await wizard.getByLabel('Git 分支').fill('main')
  await b.pickDirectory(chosen)
  await wizard.getByRole('button', { name: '选择空目录…' }).click()
  await wizard.getByText('本地目的地：' + chosen).waitFor()
  await page.screenshot({ path: join(shots, 'v2-machine-b-clone.png') })
  await wizard.getByRole('button', { name: '克隆到所选空目录' }).click()
  await wizard.getByText('使用该目录已有的 Git 仓库').waitFor({ timeout: 60000 })
  await wizard.getByRole('button', { name: '下一步' }).click()
  await wizard.getByText(/测试：生成一句话 · 通过/).waitFor({ timeout: 120000 })
  await wizard.getByRole('button', { name: '下一步' }).click()
  await wizard.getByText(chosen, { exact: true }).waitFor()
  await wizard.getByLabel('每日起草时间').fill('23:59')
  await page.screenshot({ path: join(shots, 'v2-machine-b-confirm.png') })
  await wizard.getByRole('button', { name: '确认并开始' }).click()
  await wizard.waitFor({ state: 'detached', timeout: 30000 })
  assert.equal(await b.fixedRoot(), chosen)
  assert.equal(await lstat(join(root, 'CCLink Studio', '我的空间')).catch(() => null), null)
  assert.equal(
    await readFile(join(chosen, D, '2026/11/1117_周二.assets/板子.png'), 'utf8'),
    'PNG-SIMULATED',
  )
  const tasks = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), chosen)
  result.machineBTasks = tasks.tasks.map((t) => [t.definition.title, t.activation.enabled])
  assert.deepEqual(Object.fromEntries(result.machineBTasks), {
    每日起草: true,
    每周复盘: true,
    整理参考资料: false,
  })
  await nav(page, '定时整理')
  await page
    .getByText(/本机未启用/)
    .first()
    .waitFor()
  await page.screenshot({ path: join(shots, 'v2-machine-b-tasks.png') })
  await nav(page, '日记')
  await page.locator('.diary-day-row').filter({ hasText: '1117_周二.md' }).click()
  await page.getByRole('article', { name: '日记正文预览' }).waitFor()
  await page.screenshot({ path: join(shots, 'v2-machine-b-diary.png') })
  await b.close()
  await b.launch()
  await b.page.locator('.personal-diary-home h2').first().waitFor()
  assert.equal(await b.fixedRoot(), chosen)

  // Machine A publishes; B reviews, is blocked by a local file, then pulls in place.
  await writeDiary(projectA, D, '2026/11/1121_周六.md', '# 周六\n来自 A 的更新\n')
  await git(projectA, ['add', D])
  await git(projectA, ['commit', '-m', '新增周六'])
  await git(projectA, ['push'])
  const p = b.page
  await nav(p, '项目首页')
  await p
    .locator('.diary-sync')
    .getByRole('button', { name: /查看|连接/ })
    .click()
  await p.getByRole('button', { name: '检查远程更新', exact: true }).click()
  await p.getByText(/A\s+000-个人计划\/2026\/11\/1121_周六.md/).waitFor()
  const localOnly = join(chosen, '本机草稿.md')
  await writeFile(localOnly, '未提交')
  await p.getByRole('button', { name: '检查远程更新', exact: true }).click()
  await p.getByText('?? 本机草稿.md', { exact: false }).waitFor()
  assert(await p.getByRole('button', { name: '拉取并更新', exact: true }).isDisabled())
  await p.screenshot({ path: join(shots, 'v2-git-blocked.png') })
  await rm(localOnly)
  await p.getByRole('button', { name: '检查远程更新', exact: true }).click()
  await p.getByText('工作目录干净').waitFor()
  await p.getByRole('button', { name: '拉取并更新', exact: true }).click()
  await p.getByText('本地已是远端最新版本。').waitFor()
  assert.equal(await b.fixedRoot(), chosen)
  assert.equal(
    await readFile(join(chosen, D, '2026/11/1121_周六.md'), 'utf8'),
    '# 周六\n来自 A 的更新\n',
  )
  await p.screenshot({ path: join(shots, 'v2-machine-b-pulled.png') })
  console.log('PASS machines', JSON.stringify(result))
} catch (e) {
  console.log('PARTIAL', JSON.stringify(result))
  await b.fail(e)
} finally {
  await b.close()
}
