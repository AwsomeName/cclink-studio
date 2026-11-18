// Real Electron, disposable app profile. Build with electron-vite build --outDir .cache/owner-build.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electron from 'electron'
const root = resolve(import.meta.dirname, '..'),
  dir = await mkdtemp(join(tmpdir(), 'studio-owner-'))
for (const k of ['home', 'documents', 'profile']) await mkdir(join(dir, k))
await writeFile(
  join(dir, 'profile/settings.json'),
  JSON.stringify({ componentSetupPageSeenVersion: 2 }),
)
const launcher = join(dir, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron');app.setPath('home',${JSON.stringify(join(dir, 'home'))});app.setPath('documents',${JSON.stringify(join(dir, 'documents'))});app.setAppPath(${JSON.stringify(root)});require(${JSON.stringify(join(root, '.cache/owner-build/main/index.js'))})`,
)
let app, page
async function launch() {
  app = await _electron.launch({
    executablePath: electron,
    args: [launcher],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: join(dir, 'profile'),
    },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(18000)
  await page.locator('.main-window').waitFor()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1340, 860),
  )
  await page.getByRole('button', { name: /^◈ Owner/ }).click()
}
const click = (t) => page.getByRole('button', { name: t, exact: true }).click()
async function start(title, ai) {
  await click('从已有材料做摘录')
  await page.getByLabel('事务名称').fill(title)
  await page.getByLabel('交办目标').fill('为同事整理两份芯片说明中的架构原文')
  await page.getByPlaceholder('Ibex 流水线说明', { exact: false }).fill('处理器说明\n系统说明')
  await click('创建交办草案')
  await click(ai ? '确认交办 · 由 A 选摘' : '仅在本机汇编摘录')
}
const a = '处理器采用两级流水线。',
  b = '系统芯片集成存储器和外设。'
try {
  await launch()
  if (process.argv.includes('--research')) {
    const snap = async (name) => {
      if (process.env.OWNER_RESEARCH_SHOTS)
        await page.screenshot({ path: join(process.env.OWNER_RESEARCH_SHOTS, name + '.png') })
    }
    await page
      .getByPlaceholder('帮我调研开源芯片项目', { exact: true })
      .fill('帮我调研开源芯片项目')
    await click('发给 Owner')
    const confirm = page.getByRole('button', { name: '确认范围和交付物，开始调研' })
    await confirm.waitFor({ timeout: 120000 })
    await page
      .getByLabel('和 Owner 沟通')
      .fill(
        '这次只比较 lowRISC/ibex 和 lowRISC/opentitan，从第一次读处理器源码的角度，交付中文比较和学习建议。',
      )
    await click('发送给 Owner')
    await confirm.waitFor({ timeout: 120000 })
    assert.match(await page.locator('.own-detail article').innerText(), /lowrisc\/ibex/i)
    assert.equal(await page.locator('.own-detail article summary').count(), 0)
    await snap('research-01-plan')
    console.log('PASS main chat → scope revision → no reads before confirmation')
    await confirm.click()
    const final = await page.waitForFunction(
      () => {
        const state = JSON.parse(localStorage.getItem('studio.owner.affairs.v1'))[0]
        return ['done', 'error'].includes(state.research.phase)
          ? { phase: state.research.phase, issue: state.issue, log: state.research.log }
          : null
      },
      null,
      { timeout: 300000 },
    )
    const value = await final.jsonValue()
    console.log(value)
    assert.equal(value.phase, 'done')
    assert.equal(await page.locator('.own-detail article blockquote').count(), 2)
    await snap('research-02-delivered')
    await click('‹ 我的事务')
    await app.close()
    app = null
    await launch()
    await page.locator('.own-row').first().click()
    assert.equal(await page.locator('.own-detail article blockquote').count(), 2)
    console.log('PASS real agent READ requests → two public sources → verified report → restored')
  } else {
    await start('芯片调研 · 入门资料', false)
    await page.getByRole('textbox', { name: '处理器说明', exact: true }).fill(a)
    await click('保存材料并继续')
    await click('‹ 我的事务')
    assert.match(await page.locator('.own-row').innerText(), /缺：系统说明/)
    await app.close()
    app = null
    await launch()
    await page.locator('.own-row').click()
    assert.equal(
      await page.getByRole('textbox', { name: '处理器说明', exact: true }).inputValue(),
      a,
    )
    await page.getByRole('textbox', { name: '系统说明', exact: true }).fill(b)
    await click('保存材料并继续')
    await page.getByText('摘录简报', { exact: true }).waitFor()
    assert.match(await page.locator('.own-detail pre').innerText(), /系统芯片集成/)
    const dest = join(dir, 'documents', '验收.md')
    await app.evaluate(({ dialog }, dest) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: dest })
    }, dest)
    await click('导出 Markdown')
    await page.getByText('已保存：' + dest, { exact: true }).waitFor()
    assert.match(await readFile(dest, 'utf8'), /两级流水线/)

    console.log('PASS create → confirm → partially supply → restart → finish → export Markdown')
    if (process.argv.includes('--agent')) {
      await click('‹ 我的事务')
      await start('芯片资料 · Agent 摘录', true)
      await page.getByRole('textbox', { name: '处理器说明', exact: true }).fill(a)
      await page.getByRole('textbox', { name: '系统说明', exact: true }).fill(b)
      await click('保存材料并继续')
      await page.waitForFunction(
        () =>
          ['已交付', '需要处理'].includes(document.querySelector('.own-call small')?.textContent),
        null,
        { timeout: 120000 },
      )
      console.log('Agent result:', await page.locator('.own-call').innerText())
      assert.match(await page.locator('.own-call small').innerText(), /已交付/)
      console.log('PASS native Agent result verified')
      await page
        .getByRole('textbox', { name: '询问 Owner' })
        .fill('用一句话说明这份简报引用了几份材料。')
      await click('发送给 Owner')
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('.own-thread div')].some(
            (el) =>
              el.querySelector('b')?.textContent === 'Owner' &&
              el.querySelector('p')?.textContent?.trim(),
          ),
        null,
        { timeout: 95000 },
      )
      await page.getByRole('button', { name: '发送给 Owner', exact: true }).waitFor()
      await page.locator('.own-detail article').evaluate((el) => (el.scrollTop = 0))
      if (process.env.OWNER_SCREENSHOT)
        await page.screenshot({ path: process.env.OWNER_SCREENSHOT })
      console.log('PASS independent main chat replied with the affair context')
    }
  }
} finally {
  await app?.close()
  await rm(dir, { recursive: true, force: true })
}
