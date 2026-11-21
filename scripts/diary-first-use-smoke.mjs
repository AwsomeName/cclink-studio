import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const root = await realpath(await mkdtemp(join(homedir(), '.cclink-first-use-')))
console.log('Acceptance artifacts:', root)
for (const scenario of ['default', 'existing', 'legacy', 'default-git', 'existing-git']) {
  const existing = scenario.startsWith('existing') || scenario === 'legacy'
  const configureGit = scenario.endsWith('-git')
  const home = join(root, scenario)
  const profile = join(home, 'profile')
  await mkdir(profile, { recursive: true })
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({ componentSetupPageSeenVersion: 2, claudeRuntimeSource: 'system' }),
  )
  const directory = join(home, '模拟原项目')
  const month = join(directory, '000-个人计划', '2026', '11')
  await mkdir(month, { recursive: true })
  const file = join(month, '1120_周五.md')
  const body = '# 周五记录\n模拟原文保持原位\n'
  await writeFile(file, body)
  const launcher = join(home, 'launch.cjs')
  await writeFile(
    launcher,
    `const {app}=require('electron'); app.setPath('home',${JSON.stringify(home)});app.setPath('documents',${JSON.stringify(home)});app.setAppPath(${JSON.stringify(resolve('.'))});require(${JSON.stringify(resolve('.cache/diary-build/main/index.js'))});`,
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
    await page.getByRole('button', { name: '我的空间', exact: true }).first().click()
    const setup = page.getByRole('heading', { name: '确认本地项目目录' })
    await setup.waitFor()
    if (existing) {
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, directory)
      await page.getByRole('button', { name: '选择已有目录…' }).click()
      await page.getByText(/最近日记.*1120_周五.md/).waitFor()
      assert.deepEqual(await readdir(directory), ['000-个人计划'])
      if (scenario === 'legacy') {
        await page.evaluate(async (path) => {
          const ws = window.cclinkStudio.workspaceState
          await ws.get(path)
          const { projectId } = (await ws.listLocalWorkspaces()).find(
            (w) => w.workspacePath === path,
          )
          const owner = (await ws.getFixedSpaces()).personal.workspacePath
          const result = await ws.setSection(owner, 'personalDiarySource', {
            version: 1,
            workspacePath: path,
            projectId,
            directory: '000-个人计划',
            timezone: 'America/New_York',
            taskIds: ['9e23bc19-e3ad-48bc-af95-f42930ab934e'],
          })
          if (!result.success) throw Error(result.error)
        }, directory)
        await app.close()
        app = null
        page = await launch()
        await page.getByRole('button', { name: '将原资料目录用作项目目录' }).click()
        await page.getByText(/最近日记.*1120_周五.md/).waitFor()
      }
    }
    if (configureGit) await page.getByLabel('确认目录后配置 Git 同步').check()
    await page.screenshot({ path: join(home, '01-path.png') })
    await page.getByRole('button', { name: '确认并进入项目' }).click()
    if (configureGit) {
      await page.getByLabel('仓库地址', { exact: true }).waitFor()
      await page.screenshot({ path: join(home, 'git-config.png') })
      await page.getByRole('button', { name: '项目首页', exact: true }).first().click()
    }
    await page.locator('.personal-diary-home h2').filter({ hasText: '今天' }).waitFor()
    const getRoot = (p) =>
      p.evaluate(
        async () =>
          (await window.cclinkStudio.workspaceState.getFixedSpaces()).personal.workspacePath,
      )
    const confirmed = await getRoot(page)
    if (existing) assert.equal(confirmed, directory)
    if (scenario === 'legacy') {
      const mapped = await page.evaluate(
        async (path) => (await window.cclinkStudio.workspaceState.getSettings(path)).settings.diary,
        directory,
      )
      assert.deepEqual(mapped, {
        directory: '000-个人计划',
        timezone: 'America/New_York',
        taskIds: ['9e23bc19-e3ad-48bc-af95-f42930ab934e'],
      })
    }
    await page.screenshot({ path: join(home, '02-home.png') })
    await app.close()
    app = null
    page = await launch()
    await page.locator('.personal-diary-home h2').filter({ hasText: '今天' }).waitFor()
    assert.equal(await getRoot(page), confirmed)
    assert.equal(await readFile(file, 'utf8'), body)
    await page.getByRole('button', { name: '文件', exact: true }).first().click()
    await page
      .locator('.file-tree-item')
      .filter({ hasText: existing ? '000-个人计划' : '个人计划' })
      .first()
      .waitFor()
    await page.screenshot({ path: join(home, '03-tree.png') })
    await page.getByRole('button', { name: '新建 Terminal', exact: true }).click()
    const shell = page.locator('.terminal-pty-shell .xterm-helper-textarea')
    const marker = join(home, 'pwd.txt')
    await shell.waitFor()
    await shell.pressSequentially("pwd -P > '" + marker + "'")
    await shell.press('Enter')
    let actual = ''
    for (let i = 0; i < 60 && !actual; i++) {
      actual = (await readFile(marker, 'utf8').catch(() => '')).trim()
      if (!actual) await new Promise((r) => setTimeout(r, 100))
    }
    assert.equal(actual, confirmed)
    console.log('PASS', { scenario, confirmed, terminal: actual })
  } catch (e) {
    if (app) {
      const p = await app.firstWindow()
      console.log((await p.locator('body').innerText()).slice(0, 4000))
      await p.screenshot({ path: join(home, 'failure.png') })
    }
    throw e
  } finally {
    if (app) await app.close()
  }
}
