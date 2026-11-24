// Real Electron + real git: with a saved GitHub account, My Space's first use defaults to
// 「在 GitHub 新建私有仓库」, creates it and syncs into it; a same-name public repository is
// refused on the spot. GitHub's API is answered by a stub inside the main process (no network,
// no real account); the "created" repository is a local bare repository. Simulated data only.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { makeRoot, makeHome } from './diary-acceptance-lib.mjs'

const exec = promisify(execFile)
const shots = resolve('docs/design/github-new-repo-2026-11-24/acceptance')
const root = await makeRoot('.cclink-github-create-')
const s = await makeHome(root, 'gh')
// Local Git sources must sit inside the app's home folder.
const bare = join(s.home, 'tester-my-space.git')
await exec('git', ['init', '--bare', '--initial-branch=main', bare])
try {
  const page = await s.launch()
  await s.app.evaluate((_electron, bare) => {
    const json = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    const realFetch = globalThis.fetch
    globalThis.__githubCalls = []
    globalThis.fetch = async (url, init) => {
      const u = String(url)
      if (!u.startsWith('https://api.github.com')) return realFetch(url, init)
      const path = u.slice('https://api.github.com'.length)
      const method = init?.method ?? 'GET'
      globalThis.__githubCalls.push(`${method} ${path}`)
      if (path === '/user') return json(200, { login: 'tester' })
      if (path === '/repos/tester/public-diary')
        return json(200, {
          name: 'public-diary',
          full_name: 'tester/public-diary',
          clone_url: 'https://github.com/tester/public-diary.git',
          private: false,
          permissions: { push: true },
        })
      if (path.startsWith('/repos/')) return json(404, { message: 'Not Found' })
      if (path === '/user/repos' && method === 'POST') {
        const { name, private: priv } = JSON.parse(init.body)
        if (!priv) return json(422, { message: 'must be private' })
        return json(201, { name, full_name: `tester/${name}`, clone_url: bare, private: true })
      }
      return json(404, { message: 'Not Found' })
    }
  }, bare)
  const saved = await page.evaluate(() =>
    window.cclinkStudio.gitBackup.saveAccount({ username: 'tester', token: 'test-token' }),
  )
  assert(saved.success, JSON.stringify(saved))
  // The wizard re-reads the account when the window regains focus.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  if (!(await wizard.isVisible().catch(() => false)))
    await page.getByRole('button', { name: '我的空间', exact: true }).first().click()
  const create = wizard.getByRole('radio', { name: /在 GitHub 新建私有仓库/ })
  await create.waitFor()
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="GitHub 仓库名"]')?.value === 'my-space',
  )
  assert(await create.isChecked(), 'create is the default with a saved account')
  await wizard.getByLabel('每日起草时间').fill('23:59')

  // A same-name public repository is refused and nothing is set up.
  await wizard.getByLabel('GitHub 仓库名').fill('public-diary')
  await wizard.getByRole('button', { name: '开始使用' }).click()
  await wizard.getByRole('alert').filter({ hasText: '已有公开仓库 public-diary' }).waitFor()
  await page.screenshot({ path: join(shots, 'public-repo-refused.png') })
  assert.equal(await s.fixedRoot(), null, 'My Space not created after the refusal')

  await wizard.getByLabel('GitHub 仓库名').fill('my-space')
  await page.screenshot({ path: join(shots, 'first-use-create.png') })
  await wizard.getByRole('button', { name: '开始使用' }).click()
  await wizard.waitFor({ state: 'detached', timeout: 30000 })
  await page.locator('.personal-diary-home').first().waitFor()
  const calls = await s.app.evaluate(() => globalThis.__githubCalls)
  assert(calls.includes('POST /user/repos'), JSON.stringify(calls))
  // The first sync pushed My Space into the new repository.
  let log = ''
  for (let i = 0; i < 60 && !log; i += 1) {
    log = await exec('git', ['--git-dir', bare, 'log', '--oneline', '-1', 'main'])
      .then((r) => r.stdout.trim())
      .catch(() => '')
    if (!log) await page.waitForTimeout(1000)
  }
  assert(log, 'new repository received the first sync')
  // The sync settings page shows the repository, synced.
  await page
    .locator('.workspace-sidebar-shell')
    .getByRole('button', { name: '同步', exact: true })
    .first()
    .click()
  const panel = page.getByRole('region', { name: '我的空间同步' })
  await panel.getByText('tester-my-space.git').waitFor()
  await page.screenshot({ path: join(shots, 'created-and-synced.png') })
  console.log('PASS GitHub private repository created from first use and synced:', log)
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
