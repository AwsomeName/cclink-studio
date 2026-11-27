#!/usr/bin/env node
// Markdown table (Feishu-style) acceptance, following the steps in
// docs/design/markdown-table-feishu-2026-11-25/mockup.html. Real Electron with an isolated
// home/profile/workspace and a simulated document; no model or account needed.
//
//   pnpm exec electron-vite build --outDir .cache/diary-build
//   node scripts/markdown-table-acceptance.mjs [evidenceDir]
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const build = resolve(repository, process.env.DIARY_BUILD ?? '.cache/diary-build')
const evidence = resolve(process.argv[2] ?? '/tmp/cclink-markdown-table-evidence')
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-markdown-table-')))
const home = join(root, 'home')
const workspace = join(home, 'workspace')
const profile = join(root, 'profile')
await Promise.all([home, workspace, profile, evidence].map((p) => mkdir(p, { recursive: true })))

const results = []
function record(id, status, summary, details = {}) {
  results.push({ id, status, summary, ...details })
  console.log(`${status.padEnd(8)} ${id} ${summary}`)
  for (const [key, value] of Object.entries(details))
    console.log(`         ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

const SOURCE = [
  '# 眼镜项目',
  '',
  '前言段落，保持不变。',
  '',
  '| 事项 | 进展记录 | 计划 |',
  '| --- | --- | --- |',
  '| 统一账号 | 统一云端与登录已开始推进。 | 本周理顺方案。 |',
  '| 硬件—喇叭 | 已购买新喇叭。 | 继续选型比较。 |',
  '| 外壳 | 已核对本版结构。 | 等喇叭后继续。 |',
  '',
  '结尾段落，保持不变。',
  '',
].join('\n')
await writeFile(join(workspace, 'table.md'), SOURCE)
// T10: an AI-drafted table whose cells break lines with <br>, and inline code inside bold/link.
const BREAKS_SOURCE = [
  '# 眼镜项目',
  '',
  '| 事项 | 进展记录 |',
  '| --- | --- |',
  '| 外壳 | 还有一些问题：喇叭集成<br>光机外侧修角<br/>螺丝内沉 |',
  '| 统一账号 | 已开始推进。 |',
  '',
  '验证 **`npm test`** 与 [`日志`](https://example.com) 都通过。',
  '',
].join('\n')
await writeFile(join(workspace, 'breaks.md'), BREAKS_SOURCE)

await writeFile(
  join(profile, 'settings.json'),
  JSON.stringify({
    componentSetupPageSeenVersion: 2,
    startupWorkspaceTarget: 'resume',
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
    claudeRuntimeSource: 'system',
  }),
)
await writeFile(
  join(profile, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: {
      [workspace]: {
        workspaceKey: workspace,
        workspacePath: workspace,
        ownerKey: null,
        updatedAt: Date.now(),
        storage: 'fallback',
        projectId: null,
      },
    },
  }),
)
const launcher = join(root, 'launch.cjs')
await writeFile(
  launcher,
  `const {app}=require('electron');app.setPath('home',${JSON.stringify(home)});app.setPath('documents',${JSON.stringify(home)});app.setAppPath(${JSON.stringify(repository)});require(${JSON.stringify(join(build, 'main/index.js'))});`,
)

let app
let page
const disk = () => readFile(join(workspace, 'table.md'), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  await page.waitForSelector('.main-window')
  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  if (await wizard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await wizard.getByRole('button', { name: '关闭首次使用' }).click()
    await wizard.waitFor({ state: 'detached' }).catch(() => {})
  }
  if (
    !(await page
      .locator('.file-tree-name')
      .getByText('table.md', { exact: true })
      .isVisible()
      .catch(() => false))
  ) {
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
}
async function shot(name) {
  await page.screenshot({ path: join(evidence, `${name}.png`) }).catch(() => {})
}
async function openTable() {
  if (
    !(await page
      .locator('.file-tree-name')
      .first()
      .isVisible()
      .catch(() => false))
  )
    await page.getByRole('button', { name: '文件', exact: true }).first().click()
  await page.locator('.file-tree-name').getByText('table.md', { exact: true }).click()
  await page.locator('.tiptap[contenteditable="true"] table').waitFor()
  await sleep(500)
}
const editor = () => page.locator('.tiptap[contenteditable="true"]')
const table = () => editor().locator('table').first()
const rows = () => table().locator('tr')
async function box(locator) {
  const value = await locator.boundingBox()
  if (!value) throw new Error('element not visible')
  return value
}
async function grid() {
  return table().evaluate((element) =>
    Array.from(element.rows).map((row) =>
      Array.from(row.cells).map((cell) => cell.textContent.trim()),
    ),
  )
}
async function save() {
  await page.keyboard.press('Meta+s')
  await sleep(900)
}
async function hoverCell(row, column) {
  const cell = await box(rows().nth(row).locator('td, th').nth(column))
  await page.mouse.move(cell.x + 20, cell.y + cell.height / 2)
  await sleep(150)
}
/** Lines outside the table block, to prove nothing else was rewritten. */
function outsideTable(text) {
  return text.split('\n').filter((line) => !line.startsWith('|'))
}
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
async function step(id, fn) {
  if (only && !only.has(id)) return
  try {
    await fn()
  } catch (error) {
    await shot(`${id}-error`)
    record(id, 'ERROR', '脚本步骤异常，结论未得出', { error: String(error?.message ?? error) })
  }
}

try {
  await launch()
  await openTable()
  await page.keyboard.press('Escape')

  // ① Handles appear only where the pointer is, inside the table's own bands; the text next to
  // the table is never covered and stays clickable; typing hides them until the mouse moves.
  await step('T1', async () => {
    const controls = () => page.locator('.markdown-table-controls')
    await page.mouse.move(5, 5)
    await sleep(150)
    const hiddenBefore = await controls().count()
    await hoverCell(2, 1)
    const columnGrips = await page.getByRole('button', { name: /^选择第 \d+ 列$/ }).count()
    const hoveredColumnGrip = await page.getByRole('button', { name: '选择第 2 列' }).isVisible()
    const rowGrip = await page.getByRole('button', { name: '选择第 2 行' }).isVisible()
    const appendWhileInCell = await page.getByRole('button', { name: /^新增一(行|列)$/ }).count()
    await shot('T1-hover-cell')
    const tableBox = await box(table())
    await page.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height + 10)
    await sleep(150)
    const appendRow = await page.getByRole('button', { name: '新增一行' }).isVisible()
    await shot('T1-near-bottom')
    await page.mouse.move(tableBox.x + tableBox.width + 8, tableBox.y + tableBox.height / 2)
    await sleep(150)
    const appendColumn = await page.getByRole('button', { name: '新增一列' }).isVisible()
    // Every handle stays inside the bands, clear of the paragraphs above and below.
    const before = await box(editor().getByText('前言段落，保持不变。'))
    const after = await box(editor().getByText('结尾段落，保持不变。'))
    await hoverCell(1, 0)
    await page.mouse.move(tableBox.x + tableBox.width / 2, tableBox.y + tableBox.height + 10)
    await sleep(150)
    const handleBoxes = await controls()
      .locator('button')
      .evaluateAll((buttons) =>
        buttons.map((b) => {
          const r = b.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom }
        }),
      )
    const clearOfText = handleBoxes.every(
      (b) => b.top >= before.y + before.height && b.bottom <= after.y,
    )
    // Over the paragraph just above the table nothing appears, and a click lands in the text.
    await page.mouse.move(before.x + 30, before.y + before.height / 2)
    await sleep(150)
    const hiddenOverText = (await controls().count()) === 0
    await page.mouse.click(before.x + 30, before.y + before.height / 2)
    const caretInText = await page.evaluate(
      () => window.getSelection()?.anchorNode?.parentElement?.textContent ?? '',
    )
    // Typing in a cell hides everything; moving the mouse brings the handles back.
    await hoverCell(1, 1)
    await page.mouse.click(
      (await box(rows().nth(1).locator('td').nth(1))).x + 30,
      (await box(rows().nth(1))).y + 12,
    )
    await page.keyboard.type('x')
    await sleep(150)
    const hiddenWhileTyping = (await controls().count()) === 0
    const cell = await box(rows().nth(1).locator('td').nth(1))
    await page.mouse.move(cell.x + 60, cell.y + cell.height / 2)
    await sleep(150)
    const backAfterMove = (await controls().count()) === 1
    await page.keyboard.press('Backspace')
    await page.mouse.move(5, 5)
    await sleep(200)
    const hiddenAfter = await controls().count()
    const ok =
      hiddenBefore === 0 &&
      columnGrips === 1 &&
      hoveredColumnGrip &&
      rowGrip &&
      appendWhileInCell === 0 &&
      appendRow &&
      appendColumn &&
      clearOfText &&
      hiddenOverText &&
      caretInText.includes('前言段落') &&
      hiddenWhileTyping &&
      backAfterMove &&
      hiddenAfter === 0
    record('T1', ok ? 'PASS' : 'FAIL', '控件只在表格留白内、按位置出现，不遮挡上下文，输入时让位', {
      columnGrips,
      rowGrip,
      appendWhileInCell,
      appendRow,
      appendColumn,
      clearOfText,
      hiddenOverText,
      caretInText,
      hiddenWhileTyping,
      backAfterMove,
      hiddenBefore,
      hiddenAfter,
    })
  })

  // ② "+" between rows / columns and the append bars insert; the file stays a GFM table.
  await step('T2', async () => {
    const before = await grid()
    const tableBox = await box(table())
    const row1 = await box(rows().nth(1))
    await page.mouse.move(tableBox.x - 10, row1.y + row1.height)
    await sleep(150)
    const plusRow = page.getByRole('button', { name: '在此处插入一行' })
    const plusRowVisible = await plusRow.isVisible()
    await shot('T2-row-plus')
    await plusRow.click()
    await sleep(200)
    const afterRowInsert = await grid()
    const grown = await box(table())
    await page.mouse.move(grown.x + grown.width / 2, grown.y + grown.height + 10)
    await sleep(150)
    await page.getByRole('button', { name: '新增一行' }).click()
    await sleep(200)
    const afterAppend = await grid()
    const firstCell = await box(rows().nth(0).locator('th').nth(0))
    await page.mouse.move(firstCell.x + firstCell.width, tableBox.y - 6)
    await sleep(150)
    const plusColumn = page.getByRole('button', { name: '在此处插入一列' })
    const plusColumnVisible = await plusColumn.isVisible()
    await shot('T2-column-plus')
    await plusColumn.click()
    await sleep(200)
    const afterColumn = await grid()
    await save()
    const saved = await disk()
    const tableLines = saved.split('\n').filter((line) => line.startsWith('|'))
    const ok =
      plusRowVisible &&
      plusColumnVisible &&
      afterRowInsert.length === before.length + 1 &&
      afterRowInsert[2].every((cell) => cell === '') &&
      afterRowInsert[1][0] === '统一账号' &&
      afterAppend.length === before.length + 2 &&
      afterColumn[0].length === 4 &&
      afterColumn[0][1] === '' &&
      tableLines.length === afterColumn.length + 1 &&
      /^\| -{3,} \|/.test(tableLines[1]) &&
      tableLines.every((line) => line.split('|').length === 6)
    record('T2', ok ? 'PASS' : 'FAIL', '“+”插入行列、新增一行，保存为标准表格', {
      plusRowVisible,
      plusColumnVisible,
      rows: [before.length, afterRowInsert.length, afterAppend.length],
      columns: afterColumn[0].length,
      savedTable: tableLines,
    })
  })

  // Reset to the fixture for the remaining steps.
  await writeFile(join(workspace, 'table.md'), SOURCE)
  await sleep(1500)
  const reload = page.getByRole('button', { name: '重新载入' })
  if (await reload.isVisible().catch(() => false)) await reload.click()
  await sleep(800)

  // ③ Column grip → menu → 居中 writes `:---:`, and it survives reopening.
  await step('T3', async () => {
    const start = await grid()
    await hoverCell(1, 2)
    await page.getByRole('button', { name: '选择第 3 列' }).click()
    await sleep(200)
    const menuItems = await page
      .locator('.context-menu-item')
      .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')))
    await shot('T3-column-menu')
    await page.getByRole('menuitemcheckbox', { name: '居中' }).click()
    await sleep(200)
    await save()
    const saved = await disk()
    const delimiter = saved.split('\n').find((line) => /^\| *:?-/.test(line)) ?? ''
    const cells = delimiter
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    // Reopen: close the tab and open the file again.
    await page.keyboard.press('Meta+w')
    await sleep(500)
    await openTable()
    const centered = await rows()
      .nth(1)
      .locator('td')
      .nth(2)
      .evaluate((cell) => getComputedStyle(cell).textAlign)
    const ok =
      start.length === 4 &&
      /^:-{3,}:$/.test(cells[2] ?? '') &&
      /^-{3,}$/.test(cells[0] ?? '') &&
      centered === 'center' &&
      menuItems.includes('居中') &&
      menuItems.includes('删除列')
    record('T3', ok ? 'PASS' : 'FAIL', '列手柄菜单设为居中，写入 :---: 且重开仍居中', {
      menuItems,
      delimiter,
      centeredAfterReopen: centered,
    })
  })

  // ④ Drag a body row to the first data position; ⌘Z undoes; nothing goes above the header.
  await step('T4', async () => {
    const before = await grid()
    await hoverCell(2, 0)
    const grip = await box(page.getByRole('button', { name: '选择第 2 行' }))
    const row1 = await box(rows().nth(1))
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2, row1.y + 8, { steps: 8 })
    await sleep(100)
    const dropLine = await page.locator('.markdown-table-drop-line').isVisible()
    await shot('T4-dragging')
    await page.mouse.up()
    await sleep(250)
    const moved = await grid()
    await page.keyboard.press('Meta+z')
    await sleep(250)
    const undone = await grid()
    // Try to drag the last row above the header.
    await hoverCell(3, 0)
    const grip3 = await box(page.getByRole('button', { name: '选择第 3 行' }))
    const header = await box(rows().nth(0))
    await page.mouse.move(grip3.x + grip3.width / 2, grip3.y + grip3.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip3.x + grip3.width / 2, header.y - 15, { steps: 8 })
    await page.mouse.up()
    await sleep(250)
    const aboveHeader = await grid()
    const ok =
      dropLine &&
      moved[1][0] === '硬件—喇叭' &&
      moved[2][0] === '统一账号' &&
      moved[0][0] === '事项' &&
      JSON.stringify(undone) === JSON.stringify(before) &&
      aboveHeader[0][0] === '事项'
    record('T4', ok ? 'PASS' : 'FAIL', '拖动行手柄调整顺序，⌘Z 撤回，不能拖到表头之上', {
      dropLine,
      moved: moved.map((row) => row[0]),
      undone: undone.map((row) => row[0]),
      afterHeaderAttempt: aboveHeader.map((row) => row[0]),
    })
    if (JSON.stringify(aboveHeader) !== JSON.stringify(before)) {
      await page.keyboard.press('Meta+z')
      await sleep(200)
    }
  })

  // ⑤ Select 2×2 cells → float bar → 复制 gives a grid; ⌫ only clears those cells.
  await step('T5', async () => {
    const before = await grid()
    const a = await box(rows().nth(1).locator('td').nth(0))
    const b = await box(rows().nth(2).locator('td').nth(1))
    await page.mouse.move(a.x + 10, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 10 })
    await page.mouse.up()
    await sleep(200)
    const selected = await editor().locator('.selectedCell').count()
    const bar = page.locator('.markdown-selection-toolbar')
    const barButtons = await bar
      .locator('button')
      .allInnerTexts()
      .catch(() => [])
    await shot('T5-range')
    await bar.getByRole('button', { name: '复制', exact: true }).click()
    await sleep(200)
    const clipboard = await app.evaluate(({ clipboard }) => ({
      text: clipboard.readText(),
      html: clipboard.readHTML(),
    }))
    await page.keyboard.press('Backspace')
    await sleep(200)
    const after = await grid()
    const cleared =
      after[1][0] === '' && after[1][1] === '' && after[2][0] === '' && after[2][1] === ''
    const ok =
      selected === 4 &&
      ['复制', '剪切', '清空内容'].every((label) => barButtons.includes(label)) &&
      clipboard.text === '统一账号\t统一云端与登录已开始推进。\n硬件—喇叭\t已购买新喇叭。' &&
      /<table/i.test(clipboard.html) &&
      cleared &&
      after.length === before.length &&
      after[1][2] === before[1][2]
    record('T5', ok ? 'PASS' : 'FAIL', '框选 2×2 复制为表格，⌫ 只清空这 4 格', {
      selected,
      barButtons,
      clipboardText: clipboard.text,
      clipboardHasTable: /<table/i.test(clipboard.html),
      after,
    })
    await page.keyboard.press('Meta+z')
    await sleep(200)
  })

  // ⑥ Header-row grip: 删除行 and 上移 are greyed out with the reason.
  await step('T6', async () => {
    await hoverCell(0, 0)
    await page.getByRole('button', { name: '选择表头行' }).click()
    await sleep(200)
    const items = await page.locator('.context-menu-item').evaluateAll((elements) =>
      elements.map((element) => ({
        label: element.getAttribute('aria-label'),
        disabled: element.hasAttribute('disabled'),
      })),
    )
    await shot('T6-header-menu')
    await page.keyboard.press('Escape')
    await sleep(200)
    const menuOpenAfterEscape = await page.locator('.context-menu-item').count()
    const find = (prefix) => items.find((item) => item.label?.startsWith(prefix))
    const ok =
      find('删除行')?.disabled === true &&
      /Markdown 表格必须有表头/.test(find('删除行')?.label ?? '') &&
      find('上移')?.disabled === true &&
      find('删除表格')?.disabled === false
    record('T6', ok ? 'PASS' : 'FAIL', '表头行的删除行、上移置灰并说明原因', {
      items,
      menuOpenAfterEscape,
    })
  })

  // Keyboard: Enter goes to the cell below, and grows the table from the last row.
  await step('T7', async () => {
    const before = await grid()
    const cell = await box(rows().nth(2).locator('td').nth(1))
    await page.mouse.click(cell.x + cell.width - 6, cell.y + cell.height / 2)
    await page.keyboard.press('End')
    const where = () =>
      page.evaluate(() => {
        const node = document.getSelection()?.anchorNode
        const cell = (node instanceof Element ? node : node?.parentElement)?.closest('td, th')
        const row = cell?.parentElement
        return {
          active: document.activeElement?.className,
          row: row ? Array.from(row.parentElement.children).indexOf(row) : null,
          column: cell ? Array.from(row.children).indexOf(cell) : null,
        }
      })
    const trace = [await where()]
    await page.keyboard.press('Enter')
    trace.push(await where())
    await page.keyboard.type('甲')
    await page.keyboard.press('Enter')
    await page.keyboard.type('乙')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('丙')
    await sleep(200)
    const after = await grid()
    const ok =
      after[3][1] === `${before[3][1]}甲` &&
      after.length === before.length + 1 &&
      after[4][1] === '乙' &&
      after[2][1].includes('丙') &&
      after[2][1].replace('丙', '') === before[2][1]
    record('T7', ok ? 'PASS' : 'FAIL', 'Enter 跳到下方单元格、末行 Enter 新增一行、↑ 跨格', {
      column: after.map((row) => row[1]),
      trace,
    })
  })

  // Fidelity: after all the edits above, text outside the table is unchanged byte for byte.
  await step('T8', async () => {
    await save()
    const saved = await disk()
    const ok = JSON.stringify(outsideTable(saved)) === JSON.stringify(outsideTable(SOURCE))
    record('T8', ok ? 'PASS' : 'FAIL', '表格以外内容逐字不变', {
      outsideBefore: outsideTable(SOURCE),
      outsideAfter: outsideTable(saved),
      saved,
    })
  })

  // ⑨ Dragging a column border resizes it; the width is remembered on this machine across a
  // restart and never written to the file or marked as an unsaved change (design D1, revised).
  await step('T9', async () => {
    await save()
    await sleep(1500)
    const diskBefore = await disk()
    const header = rows().first().locator('th, td')
    const first = await box(header.nth(0))
    const before = first.width
    const borderX = first.x + first.width - 1
    const y = first.y + first.height / 2
    await page.mouse.move(borderX - 30, y)
    await page.mouse.move(borderX, y, { steps: 4 })
    await sleep(200)
    const cursorReady = await editor().evaluate((el) => el.classList.contains('resize-cursor'))
    await page.mouse.down()
    await page.mouse.move(borderX + 140, y, { steps: 10 })
    await page.mouse.up()
    await sleep(600)
    const after = (await box(header.nth(0))).width
    const dirty = await page.locator('.tab.active .tab-dirty-dot').count()
    await sleep(2500)
    const diskAfter = await disk()
    await shot('T9-resized')
    await app.close()
    app = null
    await launch()
    await openTable()
    const reopened = (await box(rows().first().locator('th, td').nth(0))).width
    await shot('T9-reopened')
    const ok =
      after > before + 80 &&
      dirty === 0 &&
      diskAfter === diskBefore &&
      Math.abs(reopened - after) <= 12
    record('T9', ok ? 'PASS' : 'FAIL', '拖动列边框调整列宽，重启后仍在，文件不变且不算未保存修改', {
      cursorReady,
      widthBefore: Math.round(before),
      widthAfterDrag: Math.round(after),
      widthAfterRestart: Math.round(reopened),
      markedDirty: dirty > 0,
      fileUnchanged: diskAfter === diskBefore,
    })
  })

  await step('T10', async () => {
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))
    await page.locator('.file-tree-name').getByText('breaks.md', { exact: true }).click()
    const breaksTable = editor().locator('table').first()
    await breaksTable.waitFor()
    await sleep(500)
    const literalBlocks = await editor().locator('.markdown-literal-block').count()
    const lineBreaks = await breaksTable.locator('br.markdown-cell-break').count()
    await shot('T10-opened')
    // Option+Enter at the end of the 已开始推进 cell adds a line inside the cell.
    const cell = breaksTable.locator('td', { hasText: '已开始推进' })
    const cellBox = await box(cell)
    await page.mouse.click(cellBox.x + cellBox.width - 8, cellBox.y + cellBox.height / 2)
    await page.keyboard.press('End')
    await page.keyboard.press('Alt+Enter')
    await page.keyboard.type('周末完成')
    // Edit inside the bold inline code paragraph (it used to throw on every keystroke).
    const code = editor().locator('p', { hasText: '都通过' })
    const codeBox = await box(code)
    await page.mouse.click(codeBox.x + codeBox.width - 4, codeBox.y + codeBox.height / 2)
    await page.keyboard.press('End')
    await page.keyboard.type('已核对')
    await save()
    const saved = await readFile(join(workspace, 'breaks.md'), 'utf8')
    await shot('T10-saved')
    const ok =
      literalBlocks === 0 &&
      lineBreaks === 2 &&
      errors.length === 0 &&
      saved.includes('喇叭集成<br>光机外侧修角<br/>螺丝内沉') &&
      saved.includes('已开始推进。<br>周末完成') &&
      saved.includes('**`npm test`**') &&
      saved.includes('[`日志`](https://example.com)') &&
      saved.includes('都通过。已核对')
    record(
      'T10',
      ok ? 'PASS' : 'FAIL',
      '含 <br> 的表格按表格显示，Option+Enter 在格内换行；粗体包代码的段落可编辑',
      { literalBlocks, lineBreaks, pageErrors: errors, saved },
    )
  })
} finally {
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify({ results, verifiedAt: new Date().toISOString() }, null, 2),
  )
  if (app) await app.close().catch(() => {})
  if (existsSync(root)) await rm(root, { recursive: true, force: true })
  console.log('Evidence:', evidence)
}
