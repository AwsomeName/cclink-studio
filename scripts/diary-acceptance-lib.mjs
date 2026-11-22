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
 * Completes the four-step first use. `directory` picks an existing folder (else the default);
 * `dailyTime` defaults late so confirming does not start an immediate AI draft.
 */
export async function firstUse(s, { directory, dailyTime = '23:59', shot } = {}) {
  const page = s.page
  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  if (!(await wizard.isVisible().catch(() => false)))
    await page.getByRole('button', { name: '我的空间', exact: true }).first().click()
  await wizard.getByText('1 选择目录').waitFor()
  if (directory) {
    await s.pickDirectory(directory)
    await wizard.getByRole('button', { name: '选择文件夹…' }).click()
    await wizard.getByText(directory, { exact: true }).waitFor()
  }
  if (shot) await page.screenshot({ path: shot })
  for (let i = 0; i < 2; i++) await wizard.getByRole('button', { name: '下一步' }).click()
  await wizard.getByText(/测试：生成一句话 · 通过/).waitFor({ timeout: 120000 })
  await wizard.getByRole('button', { name: '下一步' }).click()
  await wizard.getByLabel('每日起草时间').fill(dailyTime)
  await wizard.getByRole('button', { name: '确认并开始' }).click()
  await wizard.waitFor({ state: 'detached', timeout: 30000 })
  await page.locator('.personal-diary-home h2').first().waitFor()
}

/** Back-compat name used by older scenarios. */
export const confirmExisting = (s, directory, shot) => firstUse(s, { directory, shot })
