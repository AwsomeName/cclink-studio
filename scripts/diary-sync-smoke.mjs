import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { makeRoot, makeHome } from './diary-acceptance-lib.mjs'
const root = await makeRoot('.cclink-sync-test-')
const user = await makeHome(root, 'studio')
const remote = join(user.home, 'shared.git'),
  peer = join(root, 'peer')
function git(cwd, ...args) {
  return execFileSync(
    'git',
    [
      '-c',
      'core.quotepath=false',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@localhost',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    },
  ).trim()
}
git(root, 'init', '--bare', '--initial-branch=main', remote)
const page = await user.launch()
async function until(test) {
  const end = Date.now() + 40000
  while (Date.now() < end) {
    if (await test()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw Error('Timed out: ' + test)
}
try {
  const space = await page.evaluate(() =>
    window.cclinkStudio.workspaceState.initializePersonalSpace(null),
  )
  const path = space.personal.workspacePath
  await user.close()
  await user.launch()
  const p = user.page
  await p.getByRole('button', { name: '我的空间', exact: true }).first().click()
  await p.locator('.status-bar .diary-sync').click()
  const panel = p.getByRole('region', { name: '我的空间同步' })
  const D = (await p.evaluate((path) => window.cclinkStudio.workspaceState.getSettings(path), path))
    .settings.diary.directory
  const file = D + '/周三.md'
  await mkdir(join(path, D), { recursive: true })
  await writeFile(join(path, file), '复测时间：上午九点\n')
  await panel.getByLabel('Git 项目地址').fill(remote)
  await panel.getByRole('button', { name: '保存并同步' }).click()
  const done = () =>
    p.locator('.status-bar .diary-sync').filter({ hasText: '已同步' }).waitFor({ timeout: 40000 })
  await done()
  git(root, 'clone', remote, peer)
  assert.equal(await readFile(join(peer, file), 'utf8'), '复测时间：上午九点\n')
  async function publish(text) {
    await writeFile(join(peer, file), text)
    git(peer, 'add', '--', file)
    git(peer, 'commit', '-m', '另一台设备编辑')
    git(peer, 'push')
  }
  const second = join(user.home, '其他项目')
  await mkdir(second)
  await user.pickDirectory(second)
  await p
    .getByRole('button', { name: /新建.打开/ })
    .first()
    .click()
  await p.getByRole('button', { name: /打开已有项目/ }).click()
  await p.locator('.status-bar .diary-sync').waitFor({ state: 'detached' })
  await publish('复测时间：上午十点\n')
  async function activate() {
    const w = await user.app.browserWindow(p)
    await w.evaluate((w) => w.hide())
    await until(async () => !(await p.evaluate(() => window.cclinkStudio.window.isForeground())))
    await w.evaluate((w) => {
      w.show()
      w.focus()
    })
    await w.dispose()
    await until(() => p.evaluate(() => window.cclinkStudio.window.isForeground()))
  }
  await p.getByRole('button', { name: '我的空间', exact: true }).first().click()
  await p.locator('.status-bar .diary-sync').click()
  await until(async () => (await readFile(join(path, file), 'utf8')) === '复测时间：上午十点\n')
  await done()
  // Advance renderer time across the hour, keeping Git, remote and BrowserWindow real.
  const at = new Date()
  at.setHours(at.getHours() + 1, 59, 30, 0)
  await p.clock.install({ time: at })
  await activate()
  await done()
  await writeFile(join(path, D, '整点.md'), '整点上传')
  await p.locator('.status-bar .diary-sync').filter({ hasText: '有待同步的改动' }).waitFor()
  assert(!git(remote, 'ls-tree', '-r', '--name-only', 'main').includes('整点.md'))
  await p.clock.fastForward(31000)
  await until(() => git(remote, 'ls-tree', '-r', '--name-only', 'main').includes('整点.md'))
  await done()
  git(peer, 'pull', '--ff-only')
  await writeFile(join(path, file), '复测时间：中午十二点\n')
  await publish('复测时间：下午两点\n')
  await activate()
  await panel.getByLabel('告诉 AI 怎么处理').waitFor()
  assert.equal(await readFile(join(path, file), 'utf8'), '复测时间：中午十二点\n')
  await p.screenshot({ path: join(root, 'conflict.png') })
  await panel
    .getByLabel('告诉 AI 怎么处理')
    .fill(process.env.DIARY_LIVE_AI ? '复测安排在下午，按下午两点的那一份。' : '采用另一份的写法')
  await panel.getByRole('button', { name: '继续同步' }).click()
  await p
    .locator('.status-bar .diary-sync')
    .filter({ hasText: '已同步' })
    .waitFor({ timeout: 110000 })
  assert.equal(await readFile(join(path, file), 'utf8'), '复测时间：下午两点\n')
  assert.equal(git(path, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'))
  await p.screenshot({ path: join(root, 'synced.png') })
  const w = await user.app.browserWindow(p)
  await w.evaluate((w) => w.hide())
  await until(async () => !(await p.evaluate(() => window.cclinkStudio.window.isForeground())))
  const previous = git(remote, 'rev-parse', 'main')
  await writeFile(join(path, D, '离开后.md'), '下次进入才上传')
  await p.clock.fastForward(3600000)
  assert.equal(previous, git(remote, 'rev-parse', 'main'))
  await user.close()
  const again = await user.launch()
  await again.getByRole('button', { name: '我的空间', exact: true }).first().click()
  await until(() => previous !== git(remote, 'rev-parse', 'main'))
  assert.equal(git(remote, 'show', 'main:' + D + '/离开后.md'), '下次进入才上传')
  console.log(
    'PASS: connect, upload, real foreground entry, clock-hour upload, conflict, feedback, verified equal HEAD',
    root,
  )
} catch (error) {
  await user.fail(error)
} finally {
  await user.close()
}
