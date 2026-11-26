#!/usr/bin/env node
// Markdown A1-A9 acceptance (docs/features/markdown-editor-review-and-stabilization-plan.md).
// Real Electron, isolated home/profile/workspace, simulated documents; no model or account.
// Agent steps are driven at the boundary the Agent tools use: A4 writes the file on disk exactly
// as editor_write does (FileService.writeFile), A5 sends the same editor:saveRequest IPC that
// editor_save sends. Each item records PASS / FAIL / PARTIAL / NOT-COVERED with evidence instead
// of stopping at the first failure.
//
//   pnpm exec electron-vite build --outDir .cache/diary-build
//   node scripts/markdown-a1-a9-acceptance.mjs [evidenceDir]
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const build = resolve(repository, process.env.DIARY_BUILD ?? '.cache/diary-build')
const evidence = resolve(process.argv[2] ?? '/tmp/cclink-markdown-a1-a9-evidence')
const root = await realpath(await mkdtemp(join(homedir(), '.cclink-markdown-a1-a9-')))
const home = join(root, 'home')
const workspace = join(home, 'workspace')
const profile = join(root, 'profile')
await Promise.all([home, workspace, profile, evidence].map((p) => mkdir(p, { recursive: true })))

const results = []
function record(id, status, summary, details = {}) {
  results.push({ id, status, summary, ...details })
  console.log(`${status.padEnd(12)} ${id} ${summary}`)
  for (const [key, value] of Object.entries(details))
    console.log(`             ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

// ---------- fixtures ----------
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

const A1_SOURCE = [
  '# 标题一',
  '',
  '普通段落：这里有 **粗体**、*斜体*、~~删除线~~ 和 `行内代码`。',
  '',
  '嵌套段落：**粗体里有 *斜体* 和 `代码`**。',
  '',
  '副标题用 Setext 写法',
  '------------------',
  '',
  '* 星号列表一',
  '* 星号列表二',
  '  续行带缩进',
  '',
  '非规范写法：__下划线粗体__ 与 _下划线斜体_。',
  '',
  '- 列表项一',
  '- 列表项二',
  '  - 子项',
  '',
  '1. 有序一',
  '2. 有序二',
  '',
  '| 列A | 列B |',
  '| --- | :-: |',
  '| a1 | b1 |',
  '',
  '[链接文字](https://example.com "链接标题")',
  '',
  '![示意图](./pic.png)',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '要修改的段落：原文。',
  '',
].join('\n')
const A2_SOURCE = [
  '---',
  'title: 范围外语法',
  'tags: [a, b]',
  '---',
  '',
  '# 范围外',
  '',
  '正文带脚注[^1]。',
  '',
  '<div class="note">原始 HTML 块</div>',
  '',
  ':::tip',
  '指令块内容',
  ':::',
  '',
  '要修改的普通文本：原文。',
  '',
  '[^1]: 脚注内容。',
  '',
].join('\n')

await writeFile(join(workspace, 'pic.png'), png(8, 8, false))
await writeFile(join(workspace, 'a1.md'), A1_SOURCE)
await writeFile(join(workspace, 'a2.md'), A2_SOURCE)
await writeFile(join(workspace, 'a3.md'), 'A3 原文\n')
await writeFile(join(workspace, 'a4.md'), 'A4 原文\n')
await writeFile(join(workspace, 'a5-a.md'), 'A5 文档A\n')
await writeFile(join(workspace, 'a5-b.md'), 'A5 文档B\n')
await writeFile(join(workspace, 'a5-c.md'), 'A5 文档C 未打开\n')
await writeFile(join(workspace, 'a6.txt'), '# 不是标题\n- 不是列表\n1. 不是有序\n> 不是引用\n')
await writeFile(join(workspace, 'a6.json'), '{\n  "a": [1, 2],\n  "b": "# x"\n}\n')
await writeFile(join(workspace, 'a6.ts'), '// - item\nexport const a = <T,>(x: T) => x\n')
await writeFile(join(workspace, 'a6.py'), '# comment\n- 1\ndef f():\n    return 1\n')
await writeFile(join(workspace, 'a6.html'), '<h1>HTML 标题</h1>\n<p>段落</p>\n')
for (const name of [
  'a7.md',
  'a7-close.md',
  'a7-double.md',
  'a7-move.md',
  'a7-watch.md',
  'a7-reopen.md',
])
  await writeFile(join(workspace, name), `${name} 原文\n`)
const IMAGE_COUNT = 8
for (let i = 0; i < IMAGE_COUNT; i++)
  await writeFile(join(workspace, `big-${i}.png`), png(1600, 1200, true))
await writeFile(
  join(workspace, 'a8.md'),
  [
    '# 大图',
    '',
    ...Array.from({ length: IMAGE_COUNT }, (_, i) => `![大图${i}](./big-${i}.png)\n`),
  ].join('\n'),
)
const MANY_COUNT = 14
for (let i = 0; i < MANY_COUNT; i++)
  await writeFile(join(workspace, `mid-${i}.png`), png(800, 600, true))
await writeFile(
  join(workspace, 'a8-many.md'),
  [
    '# 多图',
    '',
    ...Array.from({ length: MANY_COUNT }, (_, i) => `![中图${i}](./mid-${i}.png)\n`),
  ].join('\n'),
)
await mkdir(join(workspace, 'notes'))
await writeFile(join(workspace, 'notes', 'notes.md'), '原有内容，不得被截断。\n')

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

// ---------- app helpers ----------
let app
let page
const disk = (name) => readFile(join(workspace, name), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(check, label, timeout = 10_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check().catch(() => false)) return true
    await sleep(100)
  }
  throw new Error(`Timed out: ${label}`)
}
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
  await page.setViewportSize?.({ width: 1500, height: 950 })
  // A fresh profile opens the My Space first-use wizard; this run is about a plain project.
  const wizard = page.getByRole('dialog', { name: '设置我的空间' })
  if (await wizard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await wizard.getByRole('button', { name: '关闭首次使用' }).click()
    await wizard.waitFor({ state: 'detached' }).catch(() => {})
  }
  if (
    !(await page
      .locator('.file-tree-name')
      .getByText('a1.md', { exact: true })
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
async function revealTree() {
  if (
    !(await page
      .locator('.file-tree-name')
      .first()
      .isVisible()
      .catch(() => false))
  )
    await page.getByRole('button', { name: '文件', exact: true }).first().click()
  await page.locator('.file-tree-name').first().waitFor()
}
async function openFile(name) {
  const tab = page.locator('.tab-title').getByText(name, { exact: true })
  if (await tab.count()) await tab.first().click()
  else {
    await revealTree()
    await page.locator('.file-tree-name').getByText(name, { exact: true }).click()
  }
  await sleep(600)
}
const editor = () => page.locator('.tiptap[contenteditable="true"]')
const tabFor = (name) =>
  page.locator('.tab').filter({ has: page.locator('.tab-title', { hasText: name }) })
async function closeTab(name) {
  await tabFor(name).first().hover()
  await tabFor(name).first().locator('.tab-close, [aria-label*="关闭"]').first().click()
}
async function stubMessageBox(response) {
  await app.evaluate(({ dialog }, value) => {
    globalThis.__prompts = []
    dialog.showMessageBox = async (...args) => {
      const options = args.length > 1 ? args[1] : args[0]
      globalThis.__prompts.push({ message: options.message, buttons: options.buttons })
      return { response: value, checkboxChecked: false }
    }
  }, response)
}
const prompts = () => app.evaluate(() => globalThis.__prompts ?? [])
async function typeAtEnd(text) {
  await editor().locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}
/** Changed lines as a unified diff body (- before / + after), via the system diff. */
async function lineDiff(before, after) {
  const a = join(root, 'diff-before')
  const b = join(root, 'diff-after')
  await writeFile(a, before)
  await writeFile(b, after)
  const out = spawnSync('diff', ['-U0', a, b], { encoding: 'utf8' }).stdout
  return out.split('\n').filter((line) => /^[-+](?![-+]{2} )/.test(line))
}

// ONLY=A4,A8 runs a subset while iterating on a fix.
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

  // ---------- A1 ----------
  await step('A1', async () => {
    await openFile('a1.md')
    await editor().waitFor()
    await sleep(800)
    const savedLabel = await page
      .locator('.toolbar-save-state')
      .innerText()
      .catch(() => '')
    const dirtyDot = await tabFor('a1.md').locator('.tab-dirty-dot').count()
    const diskAfterOpen = await disk('a1.md')
    await shot('A1-opened')
    await editor().locator('p', { hasText: '要修改的段落' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('已新增一句。')
    await page.keyboard.press('Meta+s')
    await waitFor(async () => (await disk('a1.md')).includes('已新增一句'), 'A1 save')
    const saved = await disk('a1.md')
    await closeTab('a1.md')
    await sleep(400)
    await openFile('a1.md')
    await editor().waitFor()
    const reopened = await editor().innerText()
    await shot('A1-reopened')
    const diff = await lineDiff(A1_SOURCE, saved)
    const untouched = diff.filter((line) => !line.includes('要修改的段落'))
    const openOk = savedLabel.includes('已保存') && dirtyDot === 0 && diskAfterOpen === A1_SOURCE
    const editOk = reopened.includes('已新增一句')
    const inlineKept = [
      '**粗体**',
      '*斜体*',
      '~~删除线~~',
      '`行内代码`',
      '**粗体里有 *斜体* 和 `代码`**',
    ].every((mark) => saved.includes(mark))
    const status =
      openOk && editOk && untouched.length === 0
        ? 'PASS'
        : openOk && editOk && inlineKept
          ? 'PARTIAL'
          : 'FAIL'
    record(
      'A1',
      status,
      untouched.length === 0
        ? '打开即已保存；只改一段后其余行逐字不变'
        : '打开即已保存、修改可保存可重开，但首次保存改写了未触碰的部分',
      {
        saveState: savedLabel,
        dirtyDotAfterOpen: dirtyDot,
        diskUnchangedOnOpen: diskAfterOpen === A1_SOURCE,
        inlineMarksKept: inlineKept,
        untouchedLinesRewritten: untouched,
      },
    )
  })

  // ---------- A2 ----------
  await step('A2', async () => {
    await openFile('a2.md')
    await sleep(1000)
    const blocked = await page
      .locator('.markdown-parse-blocked')
      .isVisible()
      .catch(() => false)
    const protectedView = await page.locator('.tiptap-editor.protected').count()
    const sourceToggle = page.getByRole('button', { name: '切到源码' })
    const hasToggle = await sourceToggle.isVisible().catch(() => false)
    const diskUnchangedOnOpen = (await disk('a2.md')) === A2_SOURCE
    await shot('A2-opened')
    let edited = null
    if (hasToggle) {
      await sourceToggle.click()
      const area = page.locator('.source-text-area')
      await area.waitFor()
      const value = await area.inputValue()
      const at = value.indexOf('原文。')
      await area.evaluate((el, pos) => {
        el.focus()
        el.setSelectionRange(pos, pos)
      }, at)
      await page.keyboard.type('改过')
      await page.keyboard.press('Meta+s')
      await waitFor(async () => (await disk('a2.md')).includes('改过'), 'A2 source save')
      edited = await lineDiff(A2_SOURCE, await disk('a2.md'))
      await shot('A2-source-saved')
    }
    const treeUsable = await page
      .locator('.file-tree-name')
      .getByText('a3.md', { exact: true })
      .isVisible()
      .catch(() => false)
    const verbatim =
      edited && edited.length === 2 && edited.every((line) => line.includes('要修改的普通文本'))
    const status = diskUnchangedOnOpen && hasToggle && verbatim ? 'PASS' : 'FAIL'
    record('A2', status, '范围外语法：不改写原文；可显式切源码编辑并逐字保留', {
      blockedNotice: blocked,
      protectedPreview: protectedView > 0,
      sourceToggleVisible: hasToggle,
      diskUnchangedOnOpen,
      changedLinesAfterSourceEdit: edited,
      fileTreeStillUsable: treeUsable,
    })
  })

  // ---------- A3 ----------
  await step('A3', async () => {
    await openFile('a3.md')
    await editor().waitFor()
    await typeAtEnd('本地草稿')
    await writeFile(join(workspace, 'a3.md'), 'A3 外部版本\n')
    const conflict = await page
      .locator('.markdown-conflict-banner')
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    await shot('A3-conflict')
    await stubMessageBox(0) // 保存
    await closeTab('a3.md')
    await sleep(1500)
    const tabOpen = (await tabFor('a3.md').count()) > 0
    const draftKept =
      tabOpen &&
      (
        await editor()
          .innerText()
          .catch(() => '')
      ).includes('本地草稿')
    const diskStill = await disk('a3.md')
    const asked = await prompts()
    await shot('A3-after-close-save')
    let overwriteOk = null
    if (tabOpen) {
      await page
        .locator('.markdown-conflict-banner')
        .getByRole('button', { name: '覆盖' })
        .click()
        .catch(() => {})
      await sleep(1200)
      overwriteOk = (await disk('a3.md')).includes('本地草稿')
    }
    const ok = conflict && tabOpen && draftKept && diskStill === 'A3 外部版本\n' && overwriteOk
    record(
      'A3',
      ok ? 'PASS' : 'FAIL',
      '外部冲突后“保存并关闭”：Tab 与草稿保留，冲突解决后才能落盘',
      {
        conflictBanner: conflict,
        closePrompts: asked,
        tabStillOpenAfterSave: tabOpen,
        draftKept,
        diskAfterCloseAttempt: diskStill,
        explicitOverwriteWritesDraft: overwriteOk,
        notCovered: '另存为、合并以及“任一路径失败后”的恢复未逐一覆盖',
      },
    )
  })

  // ---------- A4 ----------
  // editor_write/append/insert first ask the renderer for the document's session state
  // (editor:sessionStateRequest) and refuse while the user has unsaved edits; that decision is
  // covered by src/main/mcp/modules/editor/index.test.ts. The real app must answer truthfully and
  // show a permitted write live.
  async function sessionState(filePath) {
    const id = `a4-${Math.random().toString(36).slice(2)}`
    await app.evaluate(
      ({ ipcMain, BrowserWindow }, { id, filePath }) => {
        globalThis.__sessionStates ??= {}
        const handlers = ipcMain._invokeHandlers
        globalThis.__originalSessionState ??= handlers.get('editor:sessionStateResult')
        handlers.set('editor:sessionStateResult', (event, requestId, state) => {
          globalThis.__sessionStates[requestId] = state
          return globalThis.__originalSessionState(event, requestId, state)
        })
        BrowserWindow.getAllWindows()
          .find((w) => !w.isDestroyed())
          .webContents.send('editor:sessionStateRequest', { id, filePath })
      },
      { id, filePath },
    )
    let state = null
    await waitFor(
      async () => {
        state = await app.evaluate((_electron, id) => globalThis.__sessionStates?.[id] ?? null, id)
        return state !== null
      },
      'session state answer',
      3000,
    ).catch(() => {})
    return state
  }

  await step('A4', async () => {
    const path = join(workspace, 'a4.md')
    await openFile('a4.md')
    await editor().waitFor()
    await typeAtEnd('用户未保存')
    const whileDirty = await sessionState(path)
    await page.keyboard.press('Meta+s')
    await waitFor(async () => (await disk('a4.md')).includes('用户未保存'), 'A4 save')
    await sleep(300)
    const whenClean = await sessionState(path)
    const unopened = await sessionState(join(workspace, 'a5-c.md'))
    // A permitted Agent write (clean document) lands through the versioned save and shows live.
    await writeFile(path, 'A4 Agent 写入\n')
    const live = await waitFor(
      async () => (await editor().innerText()).includes('A4 Agent 写入'),
      'live reload',
      5000,
    ).catch(() => false)
    await shot('A4-agent-write-clean')
    const ok =
      whileDirty?.open === true &&
      whileDirty?.dirty === true &&
      whenClean?.open === true &&
      whenClean?.dirty === false &&
      unopened?.open === false &&
      live
    record(
      'A4',
      ok ? 'PASS' : 'FAIL',
      '有未保存修改时会话如实上报（Agent 写入据此被拒绝，不碰磁盘）；干净文档的写入实时显示',
      {
        sessionWhileDirty: whileDirty,
        sessionWhenClean: whenClean,
        sessionForUnopenedFile: unopened,
        cleanWriteShowsLive: live,
        mainProcessRefusal:
          '单测 src/main/mcp/modules/editor/index.test.ts：dirty / conflict → EDITOR_SESSION_DIRTY，且不调用保存',
      },
    )
  })

  // ---------- A5 ----------
  await step('A5', async () => {
    await openFile('a5-b.md')
    await editor().waitFor()
    await typeAtEnd('B 的未保存草稿')
    await openFile('a5-a.md')
    await editor().waitFor()
    await typeAtEnd('A 的未保存草稿')
    await app.evaluate(({ ipcMain }) => {
      globalThis.__saveResults = []
      ipcMain.removeHandler('editor:saveResult')
      ipcMain.handle('editor:saveResult', (_event, id, success, error) => {
        globalThis.__saveResults.push({ id, success, error, at: Date.now() })
      })
    })
    const request = async (id, filePath) => {
      const sentAt = await app.evaluate(
        ({ BrowserWindow }, req) => {
          const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
          win.webContents.send('editor:saveRequest', req)
          return Date.now()
        },
        { id, filePath },
      )
      await sleep(4000)
      const found = (await app.evaluate(() => globalThis.__saveResults)).find((r) => r.id === id)
      return found ? { ...found, latencyMs: found.at - sentAt } : null
    }
    const b = await request('a5-open-b', join(workspace, 'a5-b.md'))
    const diskB = await disk('a5-b.md')
    const diskA = await disk('a5-a.md')
    const c = await request('a5-unopened-c', join(workspace, 'a5-c.md'))
    const diskC = await disk('a5-c.md')
    await shot('A5-after-requests')
    // Autosave (default on) may already have written each draft to its own file; what matters is
    // that no request moves one document's text into another.
    const noCrossWrite =
      !diskB.includes('A 的') && !diskC.includes('A 的') && !diskA.includes('B 的')
    const savedByRequestB = Boolean(b && b.success === true)
    const fastErrorForC = Boolean(c && c.success === false && c.latencyMs < 1000)
    const status = !noCrossWrite || !fastErrorForC ? 'FAIL' : savedByRequestB ? 'PASS' : 'PARTIAL'
    record(
      'A5',
      status,
      savedByRequestB
        ? '保存请求精确命中目标（含后台 Tab）、不串写；无会话立即报错'
        : '保存请求不串写、无会话立即报错；已打开但非当前的 B 未被请求保存',
      {
        openButInactiveB: { response: b, diskB },
        unopenedC: { response: c ?? '4 秒内无响应（主进程会等到 30 秒超时）', diskC },
        noCrossWrite,
      },
    )
  })

  // ---------- A6 ----------
  await step('A6', async () => {
    const outcome = {}
    for (const name of ['a6.txt', 'a6.json', 'a6.ts', 'a6.py', 'a6.html']) {
      await openFile(name)
      await sleep(800)
      if (name === 'a6.html') await shot('A6-html')
      const active = page.locator('.tab.active .tab-title')
      outcome[name] = {
        tab: await active.innerText().catch(() => ''),
        sourceEditor: await page
          .locator('.source-text-area')
          .isVisible()
          .catch(() => false),
        markdownEditor: await editor()
          .isVisible()
          .catch(() => false),
        tabType: await page.evaluate(
          () => document.querySelector('.tab.active')?.getAttribute('data-tab-type') ?? null,
        ),
        openAsOptions: await page
          .locator('select option, .markdown-mode-toggle')
          .allInnerTexts()
          .catch(() => []),
      }
    }
    await openFile('a6.txt')
    const before = await disk('a6.txt')
    const area = page.locator('.source-text-area')
    let txtPreserved = null
    if (await area.isVisible().catch(() => false)) {
      await area.evaluate((el) => {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      })
      await page.keyboard.type('追加行\n')
      await page.keyboard.press('Meta+s')
      await waitFor(async () => (await disk('a6.txt')).includes('追加行'), 'A6 txt save')
      txtPreserved = (await disk('a6.txt')) === before + '追加行\n'
    }
    await shot('A6-routing')
    const codeOk = ['a6.txt', 'a6.json', 'a6.ts', 'a6.py'].every(
      (n) => outcome[n].sourceEditor && !outcome[n].markdownEditor,
    )
    record(
      'A6',
      codeOk && txtPreserved ? 'PASS' : 'FAIL',
      '非 Markdown 进入源码编辑，内容逐字不变',
      {
        routing: outcome,
        txtEditPreservedVerbatim: txtPreserved,
      },
    )
  })

  // ---------- A7 ----------
  /**
   * Hold a main-process IPC handler for `ms` so the test can act while a save or read is in flight.
   * Wraps Electron's own invoke handler; the app code is unchanged.
   */
  async function delayIpc(channel, ms) {
    await app.evaluate(
      ({ ipcMain }, { channel, ms }) => {
        const handlers = ipcMain._invokeHandlers
        globalThis.__originalIpc ??= {}
        globalThis.__originalIpc[channel] ??= handlers.get(channel)
        const original = globalThis.__originalIpc[channel]
        handlers.set(channel, async (...args) => {
          await new Promise((resolve) => setTimeout(resolve, ms))
          return original(...args)
        })
      },
      { channel, ms },
    )
  }
  async function restoreIpc(channel) {
    await app.evaluate(({ ipcMain }, channel) => {
      const original = globalThis.__originalIpc?.[channel]
      if (original) ipcMain._invokeHandlers.set(channel, original)
    }, channel)
  }
  const tabOpen = async (name) => (await tabFor(name).count()) > 0

  await step('A7', async () => {
    const outcome = {}
    // A7.1/A7.2 two quick saves: ordered, no false external conflict.
    await openFile('a7.md')
    await editor().waitFor()
    await typeAtEnd('第一段输入')
    await page.keyboard.press('Meta+s')
    await page.keyboard.press('Meta+s')
    await sleep(2000)
    outcome.doubleSave = {
      falseConflict: await page
        .locator('.markdown-conflict-banner')
        .isVisible()
        .catch(() => false),
      diskHasInput: (await disk('a7.md')).includes('第一段输入'),
    }

    // A7.3 save & close, then keep typing while the save is still on its way to disk.
    await delayIpc('fs:saveTextDocument', 2500)
    await openFile('a7-close.md')
    await editor().waitFor()
    await typeAtEnd('关闭前')
    await stubMessageBox(0)
    await closeTab('a7-close.md')
    await sleep(300)
    await typeAtEnd('保存途中继续输入')
    await sleep(3500)
    const stillOpen = await tabOpen('a7-close.md')
    await restoreIpc('fs:saveTextDocument')
    if (stillOpen) {
      await openFile('a7-close.md')
      await page.keyboard.press('Meta+s')
    }
    await sleep(2000)
    const closeDisk = await disk('a7-close.md')
    outcome.saveCloseWhileTyping = {
      tabKeptOpen: stillOpen,
      finalDiskHasBoth: closeDisk.includes('关闭前') && closeDisk.includes('保存途中继续输入'),
    }
    await shot('A7-3-save-close-typing')

    // A7.4 two "save & close" in a row: one ordered result, newest text last.
    await delayIpc('fs:saveTextDocument', 1500)
    await openFile('a7-double.md')
    await editor().waitFor()
    await typeAtEnd('双关闭')
    await stubMessageBox(0)
    await closeTab('a7-double.md')
    await closeTab('a7-double.md').catch(() => {})
    await sleep(4000)
    await restoreIpc('fs:saveTextDocument')
    outcome.doubleSaveClose = {
      closed: !(await tabOpen('a7-double.md')),
      diskHasDraft: (await disk('a7-double.md')).includes('双关闭'),
      prompts: (await prompts()).length,
    }

    // A7.7 rename the file while "save & close" waits on disk.
    await delayIpc('fs:saveTextDocument', 3000)
    await openFile('a7-move.md')
    await editor().waitFor()
    await typeAtEnd('迁移草稿')
    await stubMessageBox(0)
    await closeTab('a7-move.md')
    await sleep(300)
    await revealTree()
    await page
      .locator('.file-tree-name')
      .getByText('a7-move.md', { exact: true })
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
    const renameInput = page.getByRole('menu').locator('input').first()
    await renameInput.waitFor()
    await renameInput.fill('a7-moved.md')
    await renameInput.press('Enter')
    await sleep(4500)
    await restoreIpc('fs:saveTextDocument')
    const movedTabOpen = await tabOpen('a7-moved.md')
    let movedSaved = false
    if (movedTabOpen) {
      await openFile('a7-moved.md')
      await page.keyboard.press('Meta+s')
      movedSaved = await waitFor(
        async () => (await disk('a7-moved.md')).includes('迁移草稿'),
        'save at new path',
        6000,
      ).catch(() => false)
    } else {
      movedSaved =
        existsSync(join(workspace, 'a7-moved.md')) &&
        (await disk('a7-moved.md')).includes('迁移草稿')
    }
    outcome.renameDuringSave = {
      tabFollowsNewPath: movedTabOpen,
      oldPathRecreated: existsSync(join(workspace, 'a7-move.md')),
      draftAtNewPath: movedSaved,
    }
    await shot('A7-7-rename-during-save')

    // A7.6 an external change is being read from disk while the user keeps typing.
    await openFile('a7-watch.md')
    await editor().waitFor()
    await delayIpc('fs:readTextDocument', 2000)
    await writeFile(join(workspace, 'a7-watch.md'), '外部改动\n')
    await sleep(400)
    await typeAtEnd('读取途中输入')
    await sleep(4000)
    await restoreIpc('fs:readTextDocument')
    outcome.watcherReadRace = {
      draftKept: (await editor().innerText()).includes('读取途中输入'),
      conflictShown: await page
        .locator('.markdown-conflict-banner')
        .isVisible()
        .catch(() => false),
      diskIsExternal: (await disk('a7-watch.md')) === '外部改动\n',
    }
    await page
      .locator('.markdown-conflict-banner')
      .getByRole('button', { name: '重新载入' })
      .click()
      .catch(() => {})
    await shot('A7-6-watch-race')

    // A7.5 close and reopen while the old save is still in flight.
    await delayIpc('fs:saveTextDocument', 2500)
    await openFile('a7-reopen.md')
    await editor().waitFor()
    await typeAtEnd('旧会话')
    await page.keyboard.press('Meta+s')
    await sleep(200)
    await stubMessageBox(1) // 不保存 — the save already in flight carries the text
    await closeTab('a7-reopen.md')
    await sleep(300)
    await openFile('a7-reopen.md')
    await editor().waitFor()
    await sleep(3500)
    await restoreIpc('fs:saveTextDocument')
    await sleep(1500)
    outcome.reopenDuringSave = {
      reopenedClean: (await tabFor('a7-reopen.md').locator('.tab-dirty-dot').count()) === 0,
      noFalseConflict: !(await page
        .locator('.markdown-conflict-banner')
        .isVisible()
        .catch(() => false)),
      viewMatchesDisk: (await editor().innerText()).trim() === (await disk('a7-reopen.md')).trim(),
    }
    await shot('A7-5-reopen-during-save')

    const ok =
      !outcome.doubleSave.falseConflict &&
      outcome.doubleSave.diskHasInput &&
      outcome.saveCloseWhileTyping.tabKeptOpen &&
      outcome.saveCloseWhileTyping.finalDiskHasBoth &&
      outcome.doubleSaveClose.closed &&
      outcome.doubleSaveClose.diskHasDraft &&
      !outcome.renameDuringSave.oldPathRecreated &&
      outcome.renameDuringSave.draftAtNewPath &&
      outcome.watcherReadRace.draftKept &&
      outcome.watcherReadRace.conflictShown &&
      outcome.reopenDuringSave.noFalseConflict &&
      outcome.reopenDuringSave.viewMatchesDisk
    record(
      'A7',
      ok ? 'PASS' : 'FAIL',
      '保存、关闭、重命名、文件监听交错时不丢草稿、不乱序',
      outcome,
    )
  })

  // ---------- A8 ----------
  /** Open `name` and watch the renderer for 6 s: stalls, when the editor appeared, images loaded. */
  async function measureOpen(name) {
    await page.evaluate(() => {
      const t0 = performance.now()
      const marks = { stalls: [] }
      window.__open = marks
      let last = t0
      const sample = () => {
        const now = performance.now()
        if (now - last > 200) marks.stalls.push([Math.round(last - t0), Math.round(now - last)])
        last = now
        if (
          marks.editorMs === undefined &&
          document.querySelector('.tiptap[contenteditable="true"]')
        )
          marks.editorMs = Math.round(now - t0)
        if (now - t0 < 6000) setTimeout(sample, 50)
      }
      setTimeout(sample, 50)
    })
    const started = Date.now()
    await openFile(name)
    await editor().waitFor({ timeout: 30_000 })
    const playwrightSawEditorMs = Date.now() - started
    await sleep(Math.max(0, 6500 - playwrightSawEditorMs))
    const marks = await page.evaluate(() => window.__open)
    const images = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.tiptap .markdown-image-node')]
      const loaded = nodes.filter((n) => n.querySelector('img')?.src.startsWith('data:'))
      return {
        total: nodes.length,
        loaded: loaded.length,
        dataUrlMB: +(
          loaded.reduce((sum, n) => sum + n.querySelector('img').src.length, 0) / 1e6
        ).toFixed(1),
        oversizePlaceholders: document.querySelectorAll('[data-image-state="oversize"]').length,
      }
    })
    const worstStallMs = Math.max(0, ...marks.stalls.map(([, gap]) => gap))
    return { playwrightSawEditorMs, rendererEditorMs: marks.editorMs, worstStallMs, images }
  }

  await step('A8', async () => {
    const baselineStart = Date.now()
    await openFile('a6.json')
    await openFile('a1.md')
    await editor().waitFor()
    const baselineMs = Date.now() - baselineStart

    const big = await measureOpen('a8.md')
    const notice = await page
      .locator('[data-image-state="oversize"]')
      .first()
      .innerText()
      .catch(() => '')
    await shot('A8-big-images')
    // The user can still choose to load one oversized picture.
    let manualLoad = false
    const loadButton = page.getByRole('button', { name: '加载此图片' }).first()
    if (await loadButton.isVisible().catch(() => false)) {
      await loadButton.click()
      manualLoad = await waitFor(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll('.tiptap .markdown-image-node img')].some(
              (img) => img.src.startsWith('data:') && img.complete && img.naturalWidth > 0,
            ),
          ),
        'manual image load',
        15_000,
      ).catch(() => false)
    }

    const many = await measureOpen('a8-many.md')
    await shot('A8-many-images-top')
    // Scrolling down loads the rest progressively.
    await page.locator('.tiptap-editor').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    const afterScroll = await waitFor(
      () =>
        page.evaluate(() =>
          [...document.querySelectorAll('.tiptap .markdown-image-node')]
            .slice(-2)
            .every((n) => n.querySelector('img')?.src.startsWith('data:')),
        ),
      'images near the bottom',
      15_000,
    ).catch(() => false)
    await shot('A8-many-images-bottom')

    const responsive =
      big.playwrightSawEditorMs < 4000 &&
      big.worstStallMs < 500 &&
      many.playwrightSawEditorMs < 4000 &&
      many.worstStallMs < 500
    const budgeted =
      big.images.oversizePlaceholders > 0 &&
      big.images.loaded === 0 &&
      many.images.loaded < many.images.total
    const ok = responsive && budgeted && Boolean(notice) && manualLoad && afterScroll
    record('A8', ok ? 'PASS' : 'FAIL', '大图按预算与可见性加载，超限显示降级提示且可手动加载', {
      bigImages: `${IMAGE_COUNT} 张 1600×1200 噪声 PNG，每张约 ${((1600 * 1200 * 4) / 1e6).toFixed(1)}MB`,
      manyImages: `${MANY_COUNT} 张 800×600 噪声 PNG，每张约 ${((800 * 600 * 4) / 1e6).toFixed(1)}MB`,
      baselineSmallDocOpenMs: baselineMs,
      big,
      many,
      oversizeNotice: notice,
      manualLoadWorks: manualLoad,
      bottomImagesLoadAfterScroll: afterScroll,
    })
  })

  // ---------- A9 ----------
  await step('A9', async () => {
    await revealTree()
    const folder = page.locator('.file-tree-name').getByText('notes', { exact: true })
    await folder.click({ button: 'right' })
    await page.getByRole('menuitem', { name: '新建文件', exact: true }).click()
    const input = page.locator('.file-tree-rename-input')
    await input.waitFor()
    await input.fill('notes.md')
    await input.press('Enter')
    await sleep(1200)
    const notice = await page
      .getByText(/已存在同名/)
      .first()
      .innerText()
      .catch(() => '')
    const content = await readFile(join(workspace, 'notes', 'notes.md'), 'utf8')
    const extraTabs = await page
      .locator('.tab-title')
      .getByText('notes.md', { exact: true })
      .count()
    await shot('A9-same-name')
    const ok = content === '原有内容，不得被截断。\n' && extraTabs === 0 && Boolean(notice)
    record('A9', ok ? 'PASS' : 'FAIL', '同名新建：原文件不变、不开错误 Tab，并提示已存在', {
      originalUnchanged: content === '原有内容，不得被截断。\n',
      newTabsOpened: extraTabs,
      notice,
    })
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
