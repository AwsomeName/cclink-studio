// Real Electron + real Git, two isolated app homes standing in for two Macs (ADR 0026).
// Mac A sets up sync for a company project from its home card; Mac B downloads it from
// 「从 GitHub 下载项目」; edits then flow both ways. GitHub's API is answered by a stub in each
// main process and Git traffic for the stub repository is redirected to a local bare repository,
// so no network and no real account are used. Simulated data only.
//   pnpm exec electron-vite build --outDir .cache/diary-build && node scripts/project-sync-smoke.mjs
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, truncate, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { makeHome, makeRoot } from './diary-acceptance-lib.mjs'

const exec = promisify(execFile)
const shots = resolve('docs/design/project-sync-2026-11-24/acceptance')
await mkdir(shots, { recursive: true })
const root = await makeRoot('.cclink-project-sync-')
const bare = join(root, 'woniu-company.git')
await exec('git', ['init', '--bare', '--initial-branch=main', bare])
const REPO_URL = 'https://github.com/tester/woniu-company.git'
const git = async (args) =>
  (await exec('git', ['-c', 'core.quotepath=false', '--git-dir', bare, ...args])).stdout.trim()

async function companyProject(home, name) {
  const path = join(home, name)
  await mkdir(join(path, '.cclink-studio'), { recursive: true })
  await writeFile(
    join(path, '.cclink-studio', 'workspace-settings.json'),
    JSON.stringify({ version: 1, name: '蜗牛眼镜', type: 'company' }),
  )
  return path
}

async function openAt(session, path) {
  const settings = JSON.parse(await readFile(join(session.profile, 'settings.json'), 'utf8'))
  await writeFile(
    join(session.profile, 'settings.json'),
    JSON.stringify({ ...settings, lastWorkspacePath: path, recentWorkspacePaths: [path] }),
  )
  await writeFile(
    join(session.profile, 'workspace-state.json'),
    JSON.stringify({
      version: 2,
      workspaces: {},
      localWorkspaces: {
        smoke: {
          workspaceKey: path,
          workspacePath: path,
          ownerKey: null,
          updatedAt: Date.now(),
          storage: 'fallback',
          projectId: null,
        },
      },
    }),
  )
}

/** GitHub stub + Git redirect inside one app's main process, then a saved account. */
async function connectGitHub(session) {
  await session.app.evaluate(
    ({ app }, { bare, url }) => {
      const json = (status, body) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
      const repo = {
        name: 'woniu-company',
        full_name: 'tester/woniu-company',
        clone_url: url,
        private: true,
        permissions: { push: true },
        pushed_at: new Date().toISOString(),
      }
      globalThis.__repoPrivate = true
      const realFetch = globalThis.fetch
      globalThis.fetch = async (input, init) => {
        const u = String(input)
        if (!u.startsWith('https://api.github.com')) return realFetch(input, init)
        const path = u.slice('https://api.github.com'.length)
        const method = init?.method ?? 'GET'
        if (path === '/user') return json(200, { login: 'tester' })
        if (path === '/repos/tester/woniu-company')
          return json(200, { ...repo, private: globalThis.__repoPrivate })
        if (path.startsWith('/repos/')) return json(404, { message: 'Not Found' })
        if (path === '/user/repos' && method === 'POST') return json(201, repo)
        if (path.startsWith('/user/repos?')) return json(200, [repo])
        return json(404, { message: 'Not Found' })
      }
      const childProcess = process.mainModule.require('node:child_process')
      const realExecFile = childProcess.execFile
      childProcess.execFile = (file, args, ...rest) =>
        realExecFile(
          file,
          Array.isArray(args) ? args.map((a) => (a === url ? bare : a)) : args,
          ...rest,
        )
      void app
    },
    { bare, url: REPO_URL },
  )
  const saved = await session.page.evaluate(() =>
    window.cclinkStudio.gitBackup.saveAccount({ username: 'tester', token: 'test-token' }),
  )
  assert(saved.success, JSON.stringify(saved))
}

const A = await makeHome(root, 'mac-a')
const B = await makeHome(root, 'mac-b')
try {
  // Mac A: a company project with ordinary files, a likely secret and a too-large video.
  const projectA = await companyProject(A.home, '蜗牛眼镜')
  await mkdir(join(projectA, '产品资料'), { recursive: true })
  await mkdir(join(projectA, '设计'), { recursive: true })
  await writeFile(join(projectA, '产品资料', '保修政策.md'), '# 保修政策\n\n保修一年。\n')
  await writeFile(join(projectA, '设计', '报价单.xlsx'), Buffer.from([1, 2, 3, 4]))
  await writeFile(join(projectA, '.env'), 'API_TOKEN=secret\n')
  await writeFile(join(projectA, '演示视频.mov'), '')
  await truncate(join(projectA, '演示视频.mov'), 51 * 1024 * 1024)
  await openAt(A, projectA)
  const page = await A.launch()
  await connectGitHub(A)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  await page.getByLabel('公司显示名称').fill('蜗牛眼镜')
  await page.getByRole('button', { name: '开始使用' }).click()
  const created = await page.evaluate(
    (path) =>
      window.cclinkStudio.companyWorkspace.createCase({
        workspaceRef: { kind: 'local', path },
        month: '2026-11',
        kind: 'after-sales',
        customer: '周先生',
        channel: '网店',
        summary: '镜腿松动',
        orderRef: 'XH-1108',
        nextStep: '寄回换件',
        businessId: null,
      }),
    projectA,
  )
  assert(created.success !== false, JSON.stringify(created).slice(0, 300))
  const card = page.locator('section[aria-label="同步"]').first()
  await card.getByRole('button', { name: '设置同步' }).click()
  const dialog = page.getByRole('dialog', { name: '项目同步' })
  await dialog.getByText('第一次会上传什么').waitFor()
  await dialog.getByText('演示视频.mov').waitFor()
  await dialog.getByText('.env').first().waitFor()
  await dialog.getByRole('radio', { name: /在 GitHub 新建私有仓库/ }).check()
  await page.waitForFunction(
    () => document.querySelector('input[aria-label="GitHub 仓库名"]')?.value,
  )
  await dialog.getByLabel('GitHub 仓库名').fill('woniu-company')
  await page.screenshot({ path: join(shots, 'a-setup.png') })
  await dialog.getByRole('button', { name: '保存并同步' }).click()
  await dialog.getByText('同步位置').waitFor({ timeout: 60000 })
  await page.waitForFunction(() =>
    document.querySelector('.project-sync-status')?.textContent?.includes('已同步'),
  )
  await page.screenshot({ path: join(shots, 'a-synced.png') })
  const uploaded = (await git(['ls-tree', '-r', '--name-only', 'main'])).split('\n').sort()
  const files = uploaded.filter((p) => !p.startsWith('.cclink-studio/shared/company/'))
  assert.deepEqual(files, [
    '.cclink-studio/workspace-settings.json',
    '产品资料/保修政策.md',
    '设计/报价单.xlsx',
  ])
  const caseFiles = uploaded.filter((p) => p.includes('/records/company/customer_cases/'))
  assert.equal(caseFiles.length, 1, uploaded.join('\n'))
  assert(!uploaded.some((p) => p.endsWith('.sqlite')), 'no database file uploaded')
  console.log('PASS Mac A: set up from the home card; uploaded 3 files + the customer case only')
  await dialog.getByRole('button', { name: '关闭' }).click()

  // Mac B: download from 「从 GitHub 下载项目」 and open it.
  const pageB = await B.launch()
  await connectGitHub(B)
  await pageB.getByRole('button', { name: '关闭首次使用' }).click()
  await pageB.getByRole('button', { name: '新建或打开项目' }).click()
  await pageB.getByRole('button', { name: /从 GitHub 下载项目/ }).click()
  const download = pageB.getByRole('region', { name: '从 GitHub 下载项目' })
  await download.getByRole('radio', { name: /woniu-company/ }).check()
  await B.pickDirectory(B.home)
  await download.getByRole('button', { name: '选择保存位置' }).click()
  await download.getByLabel('项目文件夹名').fill('蜗牛眼镜')
  await pageB.screenshot({ path: join(shots, 'b-download.png') })
  await download.getByRole('button', { name: '下载并打开' }).click()
  const projectB = join(B.home, '蜗牛眼镜')
  await pageB.waitForFunction(
    () => document.querySelector('.project-sync-status')?.textContent?.includes('已同步'),
    undefined,
    { timeout: 60000 },
  )
  assert.equal(
    await readFile(join(projectB, '产品资料', '保修政策.md'), 'utf8'),
    '# 保修政策\n\n保修一年。\n',
  )
  await pageB.screenshot({ path: join(shots, 'b-downloaded.png') })
  console.log('PASS Mac B: downloaded the private repository and opened it as a synced project')
  // The company records were read in on B's first round; enabling the view shows them.
  await pageB.getByLabel('公司显示名称').fill('蜗牛眼镜')
  await pageB.getByRole('button', { name: '开始使用' }).click()
  await pageB.getByText('回复 1 个售后问题').first().waitFor({ timeout: 60000 })
  await pageB.screenshot({ path: join(shots, 'b-company-records.png') })
  console.log('PASS Mac B: the customer case from Mac A is on the company home')

  // B edits → A receives on 立即同步; A edits → B receives.
  await writeFile(join(projectB, '产品资料', '售后记录.md'), '张先生：镜腿松动，已寄配件。\n')
  await pageB.getByRole('button', { name: /同步：/ }).click()
  const dialogB = pageB.getByRole('dialog', { name: '项目同步' })
  await dialogB.getByRole('button', { name: '立即同步' }).click()
  await pageB.waitForFunction(() =>
    document.querySelector('.project-sync-dialog')?.textContent?.includes('上传 1 个'),
  )
  await dialogB.getByRole('button', { name: '关闭' }).click()
  await page.locator('section[aria-label="同步"]').getByRole('button', { name: '立即同步' }).click()
  await page.waitForFunction(() =>
    document.querySelector('section[aria-label="同步"]')?.textContent?.includes('收到 1 个文件'),
  )
  assert.match(await readFile(join(projectA, '产品资料', '售后记录.md'), 'utf8'), /镜腿松动/)
  console.log('PASS edits flow from Mac B to Mac A')

  // The repository turning public pauses both directions until it is private again.
  await A.app.evaluate(() => {
    globalThis.__repoPrivate = false
  })
  await writeFile(join(projectA, '产品资料', '保修政策.md'), '# 保修政策\n\n保修两年。\n')
  await page.locator('section[aria-label="同步"]').getByRole('button', { name: '立即同步' }).click()
  await page.getByRole('button', { name: /同步：同步暂停/ }).waitFor()
  await page.getByRole('button', { name: /同步：/ }).click()
  await dialog.getByText('仓库不是私有的，同步已暂停').waitFor()
  await page.screenshot({ path: join(shots, 'a-public-paused.png') })
  assert.doesNotMatch(await git(['show', 'main:产品资料/保修政策.md']), /两年/)
  await A.app.evaluate(() => {
    globalThis.__repoPrivate = true
  })
  await dialog.getByRole('button', { name: '已改回私有，重新检查' }).click()
  await page.waitForFunction(
    () => document.querySelector('.project-sync-status')?.textContent?.includes('已同步'),
    undefined,
    { timeout: 60000 },
  )
  assert.match(await git(['show', 'main:产品资料/保修政策.md']), /两年/)
  console.log('PASS public repository pauses uploads; resumes once private again')

  await B.close()
  await A.close()
  console.log('PASS project sync smoke')
} catch (e) {
  await B.fail(e).catch(() => {})
  await A.fail(e)
}
