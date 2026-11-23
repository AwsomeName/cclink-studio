// Real Electron: moved diary project relocation and both-sides review (simulated data only).
import assert from 'node:assert/strict'
import { mkdir, readFile, rename, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRoot, makeHome, writeDiary, confirmExisting, shots } from './diary-acceptance-lib.mjs'
import { lstat } from 'node:fs/promises'

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
    await page.locator('.personal-diary-home h2').first().waitFor()
    assert.equal(await s.fixedRoot(), moved)
    await page.screenshot({ path: join(shots, 'relocate-restored.png') })
    await s.close()
    await s.launch()
    await s.page.locator(`.project-strip-item[data-project-path="${moved}"]`).click()
    await s.page.locator('.personal-diary-home h2').first().waitFor()
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

// 2. The old folder is gone for good: use another diary folder instead (§13 改用其他目录).
{
  const s = await makeHome(root, 'replace')
  const original = join(s.home, '旧位置', '日记')
  const other = join(s.home, '另一个日记')
  await writeDiary(original, '个人计划', '2026/11/1120_周五.md', '# 原\n')
  await writeDiary(other, '个人计划', '2026/11/1119_周四.md', '# 另一个\n')
  try {
    await s.launch()
    await confirmExisting(s, original)
    await s.close()
    await rm(join(s.home, '旧位置'), { recursive: true })
    const page = await s.launch()
    await page.getByRole('heading', { name: '重新定位日记项目' }).waitFor()
    await s.pickDirectory(other)
    await page.getByRole('button', { name: '改用其他目录…' }).click()
    await page.getByText(/最近 · 2026\/11\/1119_周四.md/).waitFor()
    await page.screenshot({ path: join(shots, 'v2-relocate-other.png') })
    await page.getByRole('button', { name: '确认改用此目录' }).click()
    await page.getByRole('heading', { name: '重新定位日记项目' }).waitFor({ state: 'detached' })
    assert.equal(await s.fixedRoot(), other)
    console.log('PASS replace', { other })
  } catch (e) {
    await s.fail(e)
  } finally {
    await s.close()
  }
}

// 3. Upgraded install: an unconfirmed default binding with a legacy external diary link and
// diaries on both sides. The home shows the migration prompt; the user picks one side.
{
  const s = await makeHome(root, 'legacy')
  const owner = join(s.home, '旧默认空间')
  const external = join(s.home, '外部日记')
  const ownerNote = await writeDiary(owner, '个人计划', '2026/11/1118_周三.md', '# 默认目录里的\n')
  await writeDiary(external, '000-个人计划', '2026/11/1120_周五.md', '# 外部\n')
  const t = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  )
  const wd = {
    Mon: '周一',
    Tue: '周二',
    Wed: '周三',
    Thu: '周四',
    Fri: '周五',
    Sat: '周六',
    Sun: '周日',
  }
  const todayName = `${t.month}${t.day}_${wd[t.weekday]}.md`
  await writeDiary(
    external,
    '000-个人计划',
    `${t.year}/${t.month}/${todayName}`,
    '# 今天\n## 今日安排\n外部目录里的今天\n',
  )
  try {
    const page = await s.launch()
    const wizard = page.getByRole('dialog', { name: '设置我的空间' })
    await wizard.waitFor()
    await page.keyboard.press('Escape')
    await wizard.waitFor({ state: 'detached' })
    const openProject = async (path) => {
      await s.pickDirectory(path)
      await page.locator('.app-topbar-open-project').first().click()
      await page.getByRole('button', { name: /打开已有项目/ }).click()
      await page.locator(`.project-strip-item[data-project-path="${path}"].active`).waitFor()
    }
    await openProject(external)
    await openProject(owner)
    await page.locator('.app-topbar-open-project').first().click()
    await page.getByRole('button', { name: '将当前工作空间用作我的空间' }).click()
    await page.waitForTimeout(500)
    assert.equal(await s.fixedRoot(), owner)
    await page.evaluate(
      async ({ owner, external }) => {
        const ws = window.cclinkStudio.workspaceState
        await ws.get(external)
        const { projectId } = (await ws.listLocalWorkspaces()).find(
          (w) => w.workspacePath === external,
        )
        const r = await ws.setSection(owner, 'personalDiarySource', {
          version: 1,
          workspacePath: external,
          projectId,
          directory: '000-个人计划',
          timezone: 'Asia/Shanghai',
          taskIds: [],
        })
        if (!r.success) throw Error(r.error)
      },
      { owner, external },
    )
    await s.close()
    await s.launch()
    await s.page.locator(`.project-strip-item[data-project-path="${owner}"]`).click()
    await s.page.getByText('日记仍在另一个目录').waitFor()
    // Before migrating, the home already shows today's diary from the linked directory.
    const todayEntry = s.page.getByRole('article', { name: '今天的日记' })
    await todayEntry.getByText(todayName).waitFor()
    await todayEntry.getByText('外部目录里的今天').waitFor()
    await s.page.screenshot({ path: join(shots, 'v2-legacy-prompt.png') })
    await s.page.getByRole('button', { name: '将原资料目录用作项目目录' }).click()
    await s.page.getByText('两个位置都有日记').waitFor()
    await s.page.getByRole('radio', { name: /改用原资料目录/ }).check()
    await s.page.screenshot({ path: join(shots, 'legacy-both-sides.png') })
    await s.page.getByRole('button', { name: '确认并进入项目' }).click()
    await s.page.locator('.personal-diary-home h2').first().waitFor()
    for (let i = 0; i < 30 && (await s.fixedRoot()) !== external; i++)
      await s.page.waitForTimeout(200)
    assert.equal(await s.fixedRoot(), external)
    // The adopted directory (already open as a project) is still shown as My Space.
    const tab = s.page.locator(`.project-strip-item[data-project-path="${external}"]`)
    await tab.filter({ hasText: '我的空间' }).waitFor()
    assert.equal(await s.page.locator('.project-strip-item', { hasText: '外部日记' }).count(), 0)
    await s.page.locator('.project-home-breadcrumb', { hasText: '我的空间 / 今天' }).waitFor()
    await s.page.locator('.status-bar-workspace', { hasText: '我的空间' }).waitFor()
    await s.page.getByRole('article', { name: '今天的日记' }).waitFor()
    await s.page.screenshot({ path: join(shots, 'v2-legacy-adopted.png') })
    assert.equal(await readFile(ownerNote, 'utf8'), '# 默认目录里的\n')
    assert(await lstat(join(external, '000-个人计划/2026/11/1120_周五.md')))
    console.log('PASS legacy', { owner, external })
  } catch (e) {
    await s.fail(e)
  } finally {
    await s.close()
  }
}
