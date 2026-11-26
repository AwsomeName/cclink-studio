#!/usr/bin/env node
// Markdown image sizing and image attach acceptance
// (docs/design/markdown-image-size-multimodal-2026-11-25/mockup.html).
// Real Electron, isolated home/profile/workspace, simulated documents; no model or account.
//
//   pnpm exec electron-vite build --outDir .cache/diary-build
//   node scripts/markdown-image-acceptance.mjs [evidenceDir]
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const build = resolve(repository, process.env.DIARY_BUILD ?? '.cache/diary-build')
const evidence = resolve(process.argv[2] ?? '/tmp/cclink-markdown-image-evidence')
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-markdown-image-')))
const home = join(root, 'home')
const workspace = join(home, 'workspace')
const profile = join(root, 'profile')
await Promise.all([home, workspace, profile, evidence].map((p) => mkdir(p, { recursive: true })))

function png(width, height, noise) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows = []
  for (let y = 0; y < height; y++)
    rows.push(Buffer.from([0]), noise ? randomBytes(width * 4) : Buffer.alloc(width * 4, 0x80))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: noise ? 0 : 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const results = []
function record(id, ok, summary, details = {}) {
  results.push({ id, status: ok ? 'PASS' : 'FAIL', summary, ...details })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${summary}`)
  for (const [key, value] of Object.entries(details))
    console.log(`     ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}
const sha = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

await mkdir(join(workspace, 'doc.assets'))
await writeFile(join(workspace, 'doc.assets', 'a.png'), png(600, 400, false))
await writeFile(join(workspace, 'doc.assets', 'b.png'), png(500, 300, true))
const SOURCE = [
  '# 选型',
  '',
  '| 事项 | 照片 |',
  '| --- | --- |',
  '| 喇叭 A | ![喇叭A](doc.assets/a.png) |',
  '',
  '上午测了喇叭 A，见图：',
  '',
  '![喇叭B](doc.assets/b.png)',
  '',
  '结论待定。',
  '',
  '| 部件 | 记录 |',
  '| --- | --- |',
  // As an earlier version saved a cell holding text, an image and text (U+001F separators).
  '| 外壳 | 喇叭集成\u001f![修角](doc.assets/b.png)\u001f光机外侧修角 |',
  '',
  '段内配图 ![段内](doc.assets/a.png) 后面的说明文字。',
  '',
].join('\n')
await writeFile(join(workspace, 'doc.md'), SOURCE)
const hashA = await sha(join(workspace, 'doc.assets', 'a.png'))
const hashB = await sha(join(workspace, 'doc.assets', 'b.png'))

await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({
    componentSetupPageSeenVersion: 2,
    startupWorkspaceTarget: 'resume',
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
    claudeRuntimeSource: 'system',
    markdownAutoSave: false,
  }),
)
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron');app.setPath('home',${JSON.stringify(home)});app.setPath('documents',${JSON.stringify(home)});app.setAppPath(${JSON.stringify(repository)});require(${JSON.stringify(join(build, 'main/index.js'))});`,
)

let app
let page
const pageErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const disk = () => readFile(join(workspace, 'doc.md'), 'utf8')
const editor = () => page.locator('.tiptap[contenteditable="true"]')
const shot = (name) => page.screenshot({ path: join(evidence, `${name}.png`) }).catch(() => {})

async function launch() {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [launcher],
    cwd: repository,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: profile,
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
    },
    timeout: 30_000,
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(10_000)
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('[renderer error]', message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => {
    pageErrors.push(String(error).slice(0, 300))
    console.log('[page error]', String(error).slice(0, 300))
  })
  await page.waitForSelector('.main-window')
  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  if (await wizard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await wizard.getByRole('button', { name: '关闭首次使用' }).click()
    await wizard.waitFor({ state: 'detached' }).catch(() => {})
  }
  const tree = page.locator('.file-tree-name').getByText('doc.md', { exact: true })
  if (!(await tree.isVisible().catch(() => false))) {
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, workspace)
    await page
      .getByRole('button', { name: /新建.*打开/ })
      .first()
      .click()
    await page
      .getByRole('button', { name: /打开已有项目/ })
      .first()
      .click()
    await sleep(1500)
  }
  if (!(await tree.isVisible().catch(() => false)))
    await page.getByRole('button', { name: '文件', exact: true }).first().click()
  await tree.click()
  await editor().waitFor()
  await page.locator('.markdown-image-sizer img').first().waitFor()
}
async function relaunch() {
  await app.close()
  await launch()
}

try {
  await launch()
  const tableImage = page.locator('td .markdown-image-node').first()
  const tableImg = tableImage.locator('img')
  const before = await tableImg.boundingBox()

  // 1) Click selects and shows the handle; drag shrinks; save writes the strict tag.
  await tableImg.click()
  const handle = tableImage.locator('.markdown-image-resize-handle')
  await handle.waitFor()
  const h = await handle.boundingBox()
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x - 60, h.y + h.height / 2, { steps: 6 })
  const badge = await tableImage
    .locator('.markdown-image-width-badge')
    .innerText()
    .catch(() => '')
  await shot('1-dragging')
  await page.mouse.move(h.x - 120, h.y + h.height / 2, { steps: 6 })
  await page.mouse.up()
  await sleep(300)
  const after = await tableImg.boundingBox()
  await page.keyboard.press('Meta+s')
  await sleep(1200)
  const saved = await disk()
  const tag = /<img src="doc\.assets\/a\.png" alt="喇叭A" width="(\d+)">/.exec(saved)
  record(
    'size-save',
    Boolean(tag) && after.width < before.width - 80,
    '单击后拖手柄缩小，保存为 <img … width>',
    {
      widthBefore: Math.round(before.width),
      widthAfter: Math.round(after.width),
      badgeWhileDragging: badge,
      savedRow: saved.split('\n').find((line) => line.includes('喇叭 A')),
    },
  )

  // 2) Reopen: width persists, document still editable (not out-of-scope).
  await relaunch()
  const reopened = await page.locator('td .markdown-image-node img').first().boundingBox()
  const blocked = await page
    .locator('.markdown-parse-blocked')
    .isVisible()
    .catch(() => false)
  record(
    'size-reopen',
    Math.abs(reopened.width - after.width) <= 2 && !blocked,
    '重开后宽度不变，文档仍可所见即所得编辑',
    {
      widthAfterReopen: Math.round(reopened.width),
      parseBlocked: blocked,
    },
  )

  // 3) Double-click opens the original; Esc closes; nothing changes.
  await page.locator('td .markdown-image-node img').first().dblclick()
  const viewer = page.getByRole('dialog', { name: '查看原图' })
  await viewer.waitFor()
  await page.waitForFunction(() =>
    /\d+×\d+/.test(document.querySelector('.markdown-image-viewer-meta')?.textContent ?? ''),
  )
  const meta = await viewer.locator('.markdown-image-viewer-meta').innerText()
  await shot('3-viewer')
  await page.keyboard.press('Escape')
  await viewer.waitFor({ state: 'detached' })
  const dirtyAfterView = await page.locator('.tab.active .tab-dirty-dot').count()
  record(
    'viewer',
    meta.includes('600×400') && dirtyAfterView === 0,
    '双击弹出原图并显示原始尺寸，Esc 关闭且无改动',
    { meta, dirtyAfterView },
  )

  // 4) Drag back to full width writes plain Markdown again; ⌘Z restores the width.
  const img2 = page.locator('td .markdown-image-node').first()
  await img2.locator('img').click()
  const h2 = await img2.locator('.markdown-image-resize-handle').boundingBox()
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2)
  await page.mouse.down()
  await page.mouse.move(h2.x + 900, h2.y + h2.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.press('Meta+s')
  await sleep(1200)
  const reset = await disk()
  const resetOk = reset.includes('| 喇叭 A | ![喇叭A](doc.assets/a.png) |')
  await editor().press('Meta+z')
  await page.keyboard.press('Meta+s')
  await sleep(1200)
  const undone = await disk()
  record(
    'size-reset-undo',
    resetOk && /width="\d+"/.test(undone),
    '拖回铺满写回 ![]()，⌘Z 恢复宽度',
    {
      resetRow: reset.split('\n').find((line) => line.includes('喇叭 A')),
      afterUndoRow: undone.split('\n').find((line) => line.includes('喇叭 A')),
    },
  )

  // 5) Select the paragraph with the second image and send it: the image goes along.
  const para = editor().locator('p', { hasText: '上午测了' })
  const conclusion = editor().locator('p', { hasText: '结论待定' })
  const a = await para.boundingBox()
  const b = await conclusion.boundingBox()
  await page.mouse.move(a.x + 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 10 })
  await page.mouse.up()
  await page
    .locator('.markdown-selection-toolbar')
    .getByRole('button', { name: /添加到会话|发给会话/ })
    .click()
  const strip = page.getByLabel('待发送图片')
  await strip.waitFor({ timeout: 20_000 })
  await page.waitForFunction(() => document.querySelectorAll('.agent-image-attachment').length > 0)
  const chips = await page.locator('.agent-image-attachment').count()
  const toast = await page
    .getByText(/附带 \d+ 张图片/)
    .first()
    .innerText()
    .catch(() => '')
  await shot('5-attached')
  record(
    'attach',
    chips === 1 && toast.includes('附带 1 张图片'),
    '选区含 1 张本地图，发给会话时自动附图',
    { chips, toast },
  )

  // 6) Delete an image that shares a table cell with text (it used to throw on every edit).
  const errorsBefore = pageErrors.length
  const cellImage = page.locator('td .markdown-image-node img').nth(1)
  await cellImage.scrollIntoViewIfNeeded()
  await cellImage.click()
  await page.keyboard.press('Backspace')
  await sleep(400)
  const goneInView = (await page.locator('td .markdown-image-node').count()) === 1
  await page.keyboard.press('Meta+s')
  await sleep(1200)
  const afterDelete = await disk()
  const row = afterDelete.split('\n').find((line) => line.includes('外壳')) ?? ''
  await shot('6-cell-image-deleted')
  record(
    'cell-delete',
    goneInView &&
      pageErrors.length === errorsBefore &&
      !row.includes('修角](') &&
      row.includes('喇叭集成') &&
      row.includes('光机外侧修角') &&
      !afterDelete.includes('\u001f'),
    '表格单元格中与文字同格的图片可删除，保存后不再写入 U+001F',
    { row, newPageErrors: pageErrors.slice(errorsBefore) },
  )

  // 7) An image on a line of text shows inline and can be deleted.
  const inlineErrors = pageErrors.length
  const inlineNode = page.locator('p .markdown-image-node.inline').first()
  await inlineNode.scrollIntoViewIfNeeded()
  const lineText = editor().locator('p', { hasText: '后面的说明文字' })
  const inlineShown =
    (await inlineNode.count()) === 1 &&
    (await lineText.locator('.markdown-image-node').count()) === 1
  await shot('7-inline-image')
  await inlineNode.locator('img').click()
  await page.keyboard.press('Backspace')
  await sleep(400)
  await page.keyboard.press('Meta+s')
  await sleep(1200)
  const afterInline = await disk()
  const line = afterInline.split('\n').find((text) => text.includes('后面的说明文字')) ?? ''
  record(
    'inline-delete',
    inlineShown &&
      pageErrors.length === inlineErrors &&
      !line.includes('![段内]') &&
      line.includes('段内配图') &&
      (await page.locator('p .markdown-image-node.inline').count()) === 0,
    '段落中与文字同行的图片按行内显示，可删除且文字保留',
    { line, newPageErrors: pageErrors.slice(inlineErrors) },
  )

  // 8) Originals untouched.
  const same =
    (await sha(join(workspace, 'doc.assets', 'a.png'))) === hashA &&
    (await sha(join(workspace, 'doc.assets', 'b.png'))) === hashB
  record('originals', same, '所有操作后原图文件哈希不变')
} catch (error) {
  await shot('error')
  console.error('ERROR', error)
  results.push({ id: 'script', status: 'ERROR', error: String(error?.message ?? error) })
} finally {
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify({ results, at: new Date().toISOString() }, null, 2),
  )
  if (app) await app.close().catch(() => {})
  await rm(root, { recursive: true, force: true })
  console.log('Evidence:', evidence)
}
