// Real Electron: My Space always uses its own fixed folder. An install whose old binding pointed
// My Space at another project's folder goes back to first use; that project's diaries are only
// copied in, and the project itself (name, type, files) stays exactly as it was. Simulated data.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, firstUse, shots } from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-import-history-')
const s = await makeHome(root, 'import')
const project = join(s.home, 'woniu-forward')
const fixedDir = join(s.home, 'CCLink Studio', '我的空间')
await writeDiary(project, '000-个人计划', '2026/11/1120_周五.md', '# 周五\n原项目里的日记\n')
await writeDiary(project, '000-个人计划', '2026/周计划/第47周.md', '# 第47周\n')
await writeFile(join(project, 'README.md'), '# 原项目\n')
try {
  let page = await s.launch()
  // Studio knows the project as an ordinary project of its own.
  await s.pickDirectory(project)
  await page.getByRole('dialog', { name: '设置我的空间' }).getByLabel('关闭首次使用').click()
  await page.locator('.app-topbar-open-project').first().click()
  await page.getByRole('button', { name: /打开已有项目/ }).click()
  await page.locator(`.project-strip-item[data-project-path="${project}"].active`).waitFor()
  const { projectId } = JSON.parse(
    await readFile(join(project, '.cclink-studio', 'project.json'), 'utf8'),
  )
  const settingsFile = join(project, '.cclink-studio', 'workspace-settings.json')
  const settingsBefore = await readFile(settingsFile, 'utf8').catch(() => null)
  await s.close()

  // Simulate an older version that had bound My Space straight to this project's folder.
  const stateFile = join(s.profile, 'workspace-state.json')
  const state = JSON.parse(await readFile(stateFile, 'utf8'))
  state.fixedSpaces = {
    version: 1,
    company: null,
    legacyDefaultPath: '',
    ...state.fixedSpaces,
    personal: { workspacePath: project, projectId, diaryRootConfirmed: true },
  }
  await writeFile(stateFile, JSON.stringify(state, null, 2))

  page = await s.launch()
  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  await wizard.getByRole('button', { name: '开始使用' }).waitFor()
  await wizard.getByText(fixedDir).waitFor()
  await wizard.getByText('从上次使用的目录选择').waitFor()
  const space = await firstUse(s, {
    importFrom: project,
    shot: join(shots, 'v3-first-import.png'),
  })
  assert.equal(space, fixedDir)
  assert.equal(
    await readFile(join(fixedDir, '个人计划', '2026/11/1120_周五.md'), 'utf8'),
    '# 周五\n原项目里的日记\n',
  )
  assert.equal(
    await readFile(join(fixedDir, '个人计划', '2026/周计划/第47周.md'), 'utf8'),
    '# 第47周\n',
  )
  // The project is untouched: same settings bytes, same files, still its own tab.
  assert.equal(await readFile(settingsFile, 'utf8').catch(() => null), settingsBefore)
  assert.equal(await readFile(join(project, 'README.md'), 'utf8'), '# 原项目\n')
  const strip = page.locator('.project-strip')
  await strip.getByRole('button', { name: '我的空间', exact: true }).first().waitFor()
  assert.equal(
    await page.locator(`.project-strip-item[data-project-path="${fixedDir}"]`).count(),
    1,
  )
  await page.locator('.activity-bar-icon[aria-current="page"]', { hasText: '今天' }).waitFor()
  await page.screenshot({ path: join(shots, 'v3-after-import.png') })

  // Later imports go through 项目设置 › 从历史导入; same-name files are kept, not overwritten.
  const backup = join(s.home, '旧电脑备份')
  await writeDiary(backup, '个人计划', '2026/11/1120_周五.md', '# 另一个版本\n')
  await writeDiary(backup, '个人计划', '2026/10/1031_周五.md', '# 十月\n')
  await page.getByRole('button', { name: '项目设置', exact: true }).first().click()
  await page.getByText('固定').first().waitFor()
  assert.equal(await page.getByRole('button', { name: /更换项目目录|设为默认项目/ }).count(), 0)
  await page.getByRole('button', { name: '从历史导入…' }).click()
  await s.pickDirectory(backup)
  const home = page.locator('.personal-diary-home')
  await home.getByRole('button', { name: '选择文件夹…' }).click()
  await home.getByText(/1 个同名文件/).waitFor()
  await page.screenshot({ path: join(shots, 'v3-import-again.png') })
  await home.getByRole('button', { name: '复制 1 个文件' }).click()
  await home.getByText('已复制 1 个文件，跳过 1 个同名文件').waitFor()
  assert.equal(
    await readFile(join(fixedDir, '个人计划', '2026/11/1120_周五.md'), 'utf8'),
    '# 周五\n原项目里的日记\n',
  )
  assert.equal(
    await readFile(join(fixedDir, '个人计划', '2026/10/1031_周五.md'), 'utf8'),
    '# 十月\n',
  )
  console.log('PASS import history')
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
}
