// Real Electron + real git with a local bare remote: machine A imports an old diary project into
// My Space and syncs it to My Space's own Git address; machine B enters the same address in first
// use and gets the diaries back, then a later update. Simulated data only; the only remote is a
// bare repository inside the test folder.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
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
const spaceA = join(a.home, 'CCLink Studio', '我的空间')
const S = '个人计划'
const sync = (page, path) =>
  page.evaluate(
    (p) => window.cclinkStudio.git.transfer({ action: 'diary-sync', workspacePath: p }),
    path,
  )
try {
  const page = await a.launch()
  page.on('dialog', (d) => void d.accept())
  assert.equal(await firstUse(a, { importFrom: projectA, url: remote }), spaceA)
  await page.evaluate(
    async (i) => {
      const r = await window.cclinkStudio.scheduledTasks.save(i)
      if (!r.success) throw Error(JSON.stringify(r.error))
    },
    {
      workspacePath: spaceA,
      title: '整理参考资料',
      instruction: '整理资料目录。',
      schedule: { kind: 'daily', time: '22:00', timezone: TZ },
      resources: [{ kind: 'workspace' }, { kind: 'directory', path: S }],
      outputPolicy: {
        directory: `${S}/资料`,
        fileNameTemplate: '{date}-整理.md',
        mode: 'create-only',
      },
      definitionSource: 'shared',
      enable: true,
    },
  )
  const listed = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), spaceA)
  result.machineATasks = listed.tasks.map((t) => [t.definition.title, t.activation.enabled])
  for (let i = 0; i < 20; i++) {
    const r = await sync(page, spaceA)
    if (r.success && !r.snapshot.localChanges) break
    await page.waitForTimeout(1000)
  }
  // The old project is untouched and not a repository of My Space.
  assert.equal(await lstat(join(projectA, '.git')).catch(() => null), null)
  result.remoteLog = await git(remote, ['log', '--oneline', 'main'])
  await a.close()
} catch (e) {
  await a.fail(e)
}

// Machine B: first use with the same Git address; nothing is chosen but the address.
// B's home is the parent of A's, so the simulated remote counts as a local source in B's home.
const b = await makeHome(root, 'machine-b', { appHome: root })
const spaceB = join(root, 'CCLink Studio', '我的空间')
try {
  const page = await b.launch()
  page.on('dialog', (d) => void d.accept())
  assert.equal(
    await firstUse(b, { url: remote, shot: join(shots, 'v3-machine-b-first.png') }),
    spaceB,
  )
  assert.equal(
    await readFile(join(spaceB, S, '2026/11/1117_周二.assets/板子.png'), 'utf8'),
    'PNG-SIMULATED',
  )
  const tasks = await page.evaluate((p) => window.cclinkStudio.scheduledTasks.list(p), spaceB)
  result.machineBTasks = tasks.tasks.map((t) => [t.definition.title, t.activation.enabled])
  assert.deepEqual(Object.fromEntries(result.machineBTasks), {
    每日起草: true,
    周度计划: true,
    月度计划: false,
    年度计划: false,
    整理参考资料: false,
  })
  await nav(page, '日记')
  await page.getByLabel('日记日历').getByRole('gridcell', { name: '2026-11-17 有日记' }).click()
  await page.getByRole('article', { name: '当天日记' }).waitFor()
  await page.screenshot({ path: join(shots, 'v3-machine-b-diary.png') })

  // Another device publishes; B syncs in place.
  const seed = join(root, 'seed')
  await git(root, ['clone', remote, seed])
  await writeDiary(seed, S, '2026/11/1121_周六.md', '# 周六\n来自 A 的更新\n')
  await git(seed, ['add', S])
  await git(seed, ['commit', '-m', '新增周六'])
  await git(seed, ['push'])
  const p = page
  // Automatic sync runs only while Studio is in the foreground; a test window may not get
  // focus, so call the same diary-sync operation the status bar and sync page trigger.
  const synced = await sync(p, spaceB)
  assert(synced.success, JSON.stringify(synced))
  assert.equal(
    await readFile(join(spaceB, S, '2026/11/1121_周六.md'), 'utf8'),
    '# 周六\n来自 A 的更新\n',
  )
  await p.screenshot({ path: join(shots, 'v3-machine-b-pulled.png') })
  console.log('PASS machines', JSON.stringify(result))
} catch (e) {
  console.log('PARTIAL', JSON.stringify(result))
  await b.fail(e)
} finally {
  await b.close()
}
