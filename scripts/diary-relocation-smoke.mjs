// Real Electron: moved diary project relocation and both-sides review (simulated data only).
import assert from 'node:assert/strict'
import { mkdir, readFile, rename, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, confirmExisting, shots } from './diary-acceptance-lib.mjs'

const root = await makeRoot('.cclink-relocate-')

// 1. Move the confirmed folder, recreate the old path with other diaries, relocate by identity.
{
  const s = await makeHome(root, 'relocate')
  const original = join(s.home, 'Desktop', '模拟原项目')
  const note = await writeDiary(original, '000-个人计划', '2026/11/1120_周五.md', '# 周五\n原文\n')
  try {
    await s.launch()
    await confirmExisting(s, original)
    assert.equal(await s.fixedRoot(), original)
    await s.close()
    const moved = join(s.home, '资料盘', '模拟原项目')
    await mkdir(join(s.home, '资料盘'))
    await rename(original, moved)
    const page = await s.launch()
    // Startup goes straight to relocation; no click is needed.
    await page.getByRole('heading', { name: '重新定位日记项目' }).waitFor()
    await page.getByText(original).first().waitFor()
    await page.screenshot({ path: join(shots, 'relocate-missing.png') })
    // Wrong folder is rejected and the binding is unchanged.
    const stranger = join(s.home, '别的文件夹')
    await mkdir(stranger)
    await s.pickDirectory(stranger)
    await page.getByRole('button', { name: '选择项目文件夹' }).click()
    await page.getByRole('alert').filter({ hasText: '身份不一致' }).waitFor()
    assert.equal(await s.fixedRoot(), original)
    // Old path reappears with other diaries before the user picks the moved folder.
    await writeDiary(original, '个人计划', '2026/12/1201_周二.md', '# 另一份\n')
    await s.pickDirectory(moved)
    await page.getByRole('button', { name: /选择项目文件夹|重新选择/ }).click()
    await page.getByText('两个位置都有日记').waitFor()
    const confirm = page.getByRole('button', { name: '确认并恢复连接' })
    assert.equal(await confirm.isDisabled(), true)
    await page.getByLabel('使用移动后的位置（带有原项目身份）').check()
    await page.screenshot({ path: join(shots, 'relocate-both-sides.png') })
    await confirm.click()
    await page.locator('.personal-diary-home h2').filter({ hasText: '今天' }).waitFor()
    assert.equal(await s.fixedRoot(), moved)
    await page.screenshot({ path: join(shots, 'relocate-restored.png') })
    await s.close()
    await s.launch()
    await s.page.locator(`.project-strip-item[data-project-path="${moved}"]`).click()
    await s.page.locator('.personal-diary-home h2').filter({ hasText: '今天' }).waitFor()
    assert.equal(await s.fixedRoot(), moved)
    assert.equal(
      await readFile(join(moved, '000-个人计划/2026/11/1120_周五.md'), 'utf8'),
      '# 周五\n原文\n',
    )
    assert.deepEqual(await readdir(join(original, '个人计划', '2026', '12')), ['1201_周二.md'])
    console.log('PASS relocate', { moved, note })
  } catch (e) {
    await s.fail(e)
  } finally {
    await s.close()
  }
}

// 2. Legacy external link while the default folder also has diaries: user must pick one side.
{
  const s = await makeHome(root, 'compare')
  const external = join(s.home, '模拟原项目')
  await writeDiary(external, '000-个人计划', '2026/11/1120_周五.md', '# 外部\n')
  try {
    const page = await s.launch()
    await page.getByRole('button', { name: '我的空间', exact: true }).first().click()
    await page.getByRole('heading', { name: '确认本地项目目录' }).waitFor()
    const owner = await s.fixedRoot()
    const ownerNote = await writeDiary(
      owner,
      '个人计划',
      '2026/11/1118_周三.md',
      '# 默认目录里的\n',
    )
    await s.pickDirectory(external)
    await page.getByRole('button', { name: '选择已有目录…' }).click()
    await page.getByText('两个位置都有日记').waitFor()
    await page.evaluate(async (path) => {
      const ws = window.cclinkStudio.workspaceState
      await ws.get(path)
      const { projectId } = (await ws.listLocalWorkspaces()).find((w) => w.workspacePath === path)
      const owner = (await ws.getFixedSpaces()).personal.workspacePath
      const r = await ws.setSection(owner, 'personalDiarySource', {
        version: 1,
        workspacePath: path,
        projectId,
        directory: '000-个人计划',
        timezone: 'Asia/Shanghai',
        taskIds: [],
      })
      if (!r.success) throw Error(r.error)
    }, external)
    await s.close()
    await s.launch()
    await s.page.getByRole('button', { name: '我的空间', exact: true }).first().click()
    await s.page.getByRole('button', { name: '将原资料目录用作项目目录' }).click()
    await s.page.getByText('两个位置都有日记').waitFor()
    const confirm = s.page.getByRole('button', { name: '确认并进入项目' })
    assert.equal(await confirm.isDisabled(), true)
    await s.page.getByRole('radio', { name: /改用原资料目录/ }).check()
    await s.page.screenshot({ path: join(shots, 'legacy-both-sides.png') })
    await confirm.click()
    await s.page.locator('.personal-diary-home h2').filter({ hasText: '今天' }).waitFor()
    assert.equal(await s.fixedRoot(), external)
    assert.equal(await readFile(ownerNote, 'utf8'), '# 默认目录里的\n')
    console.log('PASS compare', { owner, external })
  } catch (e) {
    await s.fail(e)
  } finally {
    await s.close()
  }
}
