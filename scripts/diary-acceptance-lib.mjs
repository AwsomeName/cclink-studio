// Shared helpers for real-Electron diary acceptance runs (isolated home/profile, simulated data).
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

export const shots = resolve('docs/design/personal-diary-space-2026-11-17/acceptance')

export async function makeRoot(prefix) {
  const root = await realpath(await mkdtemp(join(homedir(), prefix)))
  console.log('Acceptance artifacts:', root)
  return root
}

export async function makeHome(root, scenario, { appHome } = {}) {
  const home = join(root, scenario)
  const profile = join(home, 'profile')
  await mkdir(profile, { recursive: true })
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({
      componentSetupPageSeenVersion: 2,
      claudeRuntimeSource: 'system',
      permissionMode: 'auto',
    }),
  )
  const launcher = join(home, 'launch.cjs')
  await writeFile(
    launcher,
    `const {app}=require('electron'); app.setPath('home',${JSON.stringify(appHome ?? home)});app.setPath('documents',${JSON.stringify(appHome ?? home)});app.setAppPath(${JSON.stringify(resolve('.'))});require(${JSON.stringify(resolve(process.env.DIARY_BUILD ? process.env.DIARY_BUILD + '/main/index.js' : '.cache/diary-build/main/index.js'))});`,
  )
  const session = { home, profile, app: null, page: null }
  session.launch = async (extraEnv = {}) => {
    session.app = await _electron.launch({
      executablePath: electronPath,
      args: [launcher],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        ELECTRON_RENDERER_URL: '',
        CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        ...extraEnv,
      },
      timeout: 30000,
    })
    session.page = await session.app.firstWindow()
    session.page.setDefaultTimeout(15000)
    await session.page.waitForSelector('.main-window')
    return session.page
  }
  session.close = async () => {
    if (session.app) await session.app.close()
    session.app = null
  }
  session.pickDirectory = async (path) =>
    session.app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
    }, path)
  session.fixedRoot = () =>
    session.page.evaluate(
      async () =>
        (await window.cclinkStudio.workspaceState.getFixedSpaces()).personal?.workspacePath ?? null,
    )
  session.fail = async (e) => {
    if (session.app) {
      const p = await session.app.firstWindow()
      console.log((await p.locator('body').innerText()).slice(0, 4000))
      await p.screenshot({ path: join(home, 'failure.png') })
      await session.close()
    }
    throw e
  }
  return session
}

export async function writeDiary(projectRoot, diaryDir, rel, body) {
  const file = join(projectRoot, diaryDir, rel)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, body)
  return file
}

/**
 * Completes the one-page first use. My Space always uses its fixed folder; `importFrom`
 * copies a history folder in, `url` sets its own Git address. Returns the My Space root.
 * `dailyTime` defaults late so confirming does not start an immediate AI draft.
 */
export async function firstUse(s, { importFrom, url, dailyTime = '23:59', shot } = {}) {
  const page = s.page
  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  if (!(await wizard.isVisible().catch(() => false)))
    await page.getByRole('button', { name: '我的空间', exact: true }).first().click()
  await wizard.getByRole('button', { name: '开始使用' }).waitFor()
  if (importFrom) {
    await wizard.getByRole('radio', { name: /从历史目录导入/ }).check()
    await s.pickDirectory(importFrom)
    await wizard.getByRole('button', { name: '选择文件夹…' }).click()
    await wizard.getByLabel('导入核对').waitFor()
  }
  if (url) await wizard.getByLabel('Git 项目地址').fill(url)
  await wizard.getByLabel('每日起草时间').fill(dailyTime)
  if (shot) await page.screenshot({ path: shot })
  await wizard.getByRole('button', { name: '开始使用' }).click()
  await wizard.waitFor({ state: 'detached', timeout: 30000 })
  await page.locator('.personal-diary-home').first().waitFor()
  return s.fixedRoot()
}

/** My Space's diary folder inside its fixed root. */
export const SPACE_DIARY = '个人计划'
