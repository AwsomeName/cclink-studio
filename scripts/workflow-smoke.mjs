#!/usr/bin/env node
import { readFile, rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const keepRunning = process.argv.includes('--keep-running')
const results = []
let startedBySmoke = false
let workspaceDir = null
let originalWorkspaceSettings = null
let pageRef = null
const workspaceDirsToCleanup = new Set()

function pass(name, detail = '') {
  results.push({ name, status: 'pass', detail })
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`)
}

function fail(name, error) {
  results.push({ name, status: 'fail', detail: error.message || String(error) })
  console.error(`FAIL ${name} - ${error.message || String(error)}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(timeoutMs = 30_000, previousLog = '') {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const completeLog = await readLog()
    const log =
      previousLog && completeLog.startsWith(previousLog)
        ? completeLog.slice(previousLog.length)
        : completeLog
    const portMatch =
      log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//) ||
      log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)
    if (portMatch) return portMatch[1]
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`CDP port not found in ${logFile}`)
}

async function findRendererPage(browser) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const pages = browser.contexts().flatMap((context) => context.pages())
    const page = pages.find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Renderer page ${rendererOrigin}/ not found`)
}

async function runCheck(name, fn) {
  try {
    const detail = await fn()
    pass(name, detail)
  } catch (error) {
    fail(name, error)
  }
}

async function clickByTitle(page, title) {
  await page.locator(`[title="${title}"]`).first().click()
}

async function ensureSidebarVisible(page) {
  const expandButton = page.locator('[title="展开左侧栏"]').first()
  if ((await expandButton.count()) > 0) {
    await expandButton.click()
    await page.waitForTimeout(350)
  }
}

async function waitForContextActionFocus(page, timeout = 2_000) {
  await page.waitForFunction(
    () => Boolean(document.activeElement?.getAttribute('data-context-action')),
    undefined,
    { timeout },
  )
  return page.evaluate(() => document.activeElement?.getAttribute('data-context-action'))
}

async function assertMarkdownEditorFocus(page, message) {
  const activeElement = await page.evaluate(() => ({
    className: String(document.activeElement?.className ?? ''),
    insideEditor: Boolean(document.activeElement?.closest('.markdown-editor-wrapper .tiptap')),
    tagName: document.activeElement?.tagName ?? '',
  }))
  assert(activeElement.insideEditor, `${message}: ${JSON.stringify(activeElement)}`)
}

async function createTabFromMenu(page, label) {
  await page.locator('.tab-new-button').first().click()
  const menu = page.locator('.tab-create-menu')
  await menu.waitFor({ timeout: 10_000 })
  await menu.locator('button', { hasText: label }).first().click()
}

async function restoreWorkspaceSettings() {
  if (!pageRef || !originalWorkspaceSettings) return
  await pageRef.evaluate((settings) => window.cclinkStudio.settings.set(settings), {
    lastWorkspacePath: originalWorkspaceSettings.lastWorkspacePath,
    recentWorkspacePaths: originalWorkspaceSettings.recentWorkspacePaths,
  })
}

async function closeTemporaryWorkspaces() {
  if (!pageRef) return
  const smokeProjectPaths = await pageRef
    .locator('.project-strip-item')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute('data-project-path'))
        .filter((path) => path?.includes('/.cclink-studio-workflow-smoke-')),
    )

  for (const path of smokeProjectPaths) {
    workspaceDirsToCleanup.add(path)
    const projectItem = pageRef.locator(`.project-strip-item[data-project-path="${path}"]`).first()
    if ((await projectItem.count()) === 0) continue
    await projectItem.click({ button: 'right' })
    const closeAction = pageRef.locator('[data-context-action="project.close"]', {
      hasText: '关闭项目',
    })
    await closeAction.waitFor({ timeout: 10_000 })
    await closeAction.click()
    await pageRef.waitForFunction(
      (projectPath) =>
        !Array.from(document.querySelectorAll('.project-strip-item')).some(
          (element) => element.getAttribute('data-project-path') === projectPath,
        ),
      path,
      { timeout: 15_000 },
    )
  }
}

async function cleanupWorkspaceDir() {
  for (const path of workspaceDirsToCleanup) {
    let lastError = null
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
        const remaining = await stat(path).catch(() => null)
        if (!remaining) break
        lastError = new Error(`temporary workspace was recreated after cleanup attempt ${attempt}`)
      } catch (error) {
        lastError = error
      }
    }
    const remaining = await stat(path).catch(() => null)
    if (remaining) throw lastError ?? new Error(`failed to remove temporary workspace: ${path}`)
  }
}

async function main() {
  const initialLog = await readLog()
  runRestart('restart')
  startedBySmoke = true

  const cdpPort = await waitForCdpPort(30_000, initialLog)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
  const page = await findRendererPage(browser)
  pageRef = page
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.main-window', { timeout: 15_000 })

  let markdownPath = null
  let workspaceName = null

  await runCheck('prepare temporary local workspace', async () => {
    const setup = await page.evaluate(async () => {
      const settings = await window.cclinkStudio.settings.getAll()
      const home = await window.cclinkStudio.fs.getHomePath()
      const workspacePath = `${home}/.cclink-studio-workflow-smoke-${Date.now()}`
      const markdownPath = `${workspacePath}/notes.md`
      await window.cclinkStudio.fs.mkdir(workspacePath)
      await window.cclinkStudio.fs.mkdir(`${workspacePath}/archive`)
      await window.cclinkStudio.fs.writeFile(markdownPath, '# Workflow Smoke\n\ninitial')
      await window.cclinkStudio.fs.writeFile(
        `${workspacePath}/roundtrip.md`,
        [
          '计划',
          '====',
          '',
          '访问 <https://example.com>。',
          '',
          '查看 [内部文档][guide]。',
          '',
          '[guide]: ./资料/说明.md "说明标题"',
          '',
          '- [ ] 待办',
          '',
          '7. 第七项',
          '8. 第八项',
          '',
          '| 左对齐 | 居中 | 右对齐 |',
          '| :--- | :---: | ---: |',
          '| a | b | c |',
          '',
          '第一行保留硬换行。  ',
          '第二行不能丢。',
          '',
          '缩进代码：',
          '',
          '    const indented = true',
          '',
          '    const indentedAgain = true',
          '',
          '```',
          'plain text',
          '```',
          '',
          '第二段缩进代码：',
          '',
          '    return 42',
        ].join('\n'),
      )
      const reportLines = [
        '# Hebbian 学习',
        '',
        '权重更新为 $\\Delta w = \\eta xy$。',
        '',
        '$$',
        'w_{t+1} = w_t + \\eta x_t y_t',
        '$$',
        '',
        '$$',
        '\\Delta w = \\eta \\cdot \\underbrace{x}_{\\text{输入}} \\cdot \\underbrace{y}_{\\text{输出}}',
        '$$',
        '',
        '$$',
        '\\Delta w = \\begin{cases} A^+ e^{-\\Delta t/\\tau} & \\Delta t > 0 \\\\ -A^- e^{\\Delta t/\\tau} & \\Delta t < 0 \\end{cases}',
        '$$',
        '',
        '价格从 $5 增长到 $10，转义金额为 \\$20。',
      ]
      for (let section = 1; section <= 30; section += 1) {
        reportLines.push(
          '',
          '---',
          '',
          `## 路线 ${section}`,
          '',
          `第 ${section} 节讨论 Hebbian 学习、局部可塑性和深层网络训练之间的关系。`.repeat(4),
          '',
          '> 这一节保留论文证据、限制条件和工程实现差异。',
          '',
          '| 方法 | 更新规则 | 特点 |',
          '| --- | --- | --- |',
          `| Oja-${section} | $\\Delta w = \\eta y(x-yw)$ | 稳定局部学习 |`,
          '',
          `1. 核对第 ${section} 节的论文来源`,
          `2. 复现实验并记录第 ${section} 组结果`,
          '',
          `- [ ] 完成第 ${section} 节代码验证`,
        )
      }
      reportLines.push('', '## 报告结尾', '', '大型报告渲染完成。')
      await window.cclinkStudio.fs.writeFile(`${workspacePath}/math.md`, reportLines.join('\n'))
      await window.cclinkStudio.fs.writeFile(
        `${workspacePath}/blocked.md`,
        ['---', 'title: Diagnostic fixture', '---', '', '# Blocked'].join('\n'),
      )
      await window.cclinkStudio.fs.writeFile(`${workspacePath}/todo.txt`, 'todo')
      await window.cclinkStudio.fs.writeFile(
        `${workspacePath}/cclink-accounts.json`,
        JSON.stringify(
          {
            version: 1,
            platforms: [
              {
                id: 'smoke-platform',
                name: 'Smoke Platform',
                url: 'https://example.com',
                account: 'smoke',
                notes: 'Workflow smoke only',
                browserProfile: 'smoke-profile',
              },
            ],
          },
          null,
          2,
        ),
      )
      const recentWorkspacePaths = [
        workspacePath,
        ...settings.recentWorkspacePaths.filter((path) => path !== workspacePath),
      ].slice(0, 8)
      const result = await window.cclinkStudio.settings.set({
        lastWorkspacePath: '',
        recentWorkspacePaths,
      })
      return {
        result,
        workspacePath,
        markdownPath,
        original: {
          lastWorkspacePath: /cclink-studio-(workflow-)?smoke/.test(settings.lastWorkspacePath)
            ? ''
            : settings.lastWorkspacePath,
          recentWorkspacePaths: settings.recentWorkspacePaths.filter(
            (path) => !/cclink-studio-(workflow-)?smoke/.test(path),
          ),
        },
      }
    })
    assert(setup.result.success, setup.result.error || 'failed to persist smoke workspace setting')
    workspaceDir = setup.workspacePath
    workspaceDirsToCleanup.add(workspaceDir)
    markdownPath = setup.markdownPath
    workspaceName = basename(workspaceDir)
    originalWorkspaceSettings = setup.original
    return workspaceName
  })

  await runCheck('recent project opens the local workspace', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.main-window', { timeout: 15_000 })
    await ensureSidebarVisible(page)
    await clickByTitle(page, '历史项目')
    const projectItem = page.locator(`.project-history-item[title="${workspaceDir}"]`).first()
    await projectItem.waitFor({ timeout: 10_000 })
    await projectItem.click()
    await page
      .locator(`.project-strip-item.active[data-project-path="${workspaceDir}"]`)
      .waitFor({ timeout: 20_000 })
    return workspaceName
  })

  await runCheck('file tree opens markdown and editor saves changes', async () => {
    await ensureSidebarVisible(page)
    await clickByTitle(page, '文件')
    const fileItem = page.locator('.file-tree-item.file', { hasText: 'notes.md' }).first()
    await fileItem.waitFor({ timeout: 10_000 })
    await fileItem.evaluate((element) => element.click())
    await page.waitForSelector('.markdown-editor-wrapper', { timeout: 15_000 })
    assert(
      (await page.locator('.toolbar-filepath').count()) === 0,
      'markdown toolbar still exposes the redundant file path',
    )
    const savedState = page.locator('.toolbar-save-state')
    await savedState.waitFor({ state: 'visible', timeout: 10_000 })
    const savedLayout = await savedState.evaluate((element) => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      height: element.getBoundingClientRect().height,
    }))
    assert(savedLayout.whiteSpace === 'nowrap', 'saved state can wrap vertically')
    assert(savedLayout.height <= 28, 'saved state is taller than the toolbar control')
    const editor = page.locator('.tiptap').first()
    await editor.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.type('# Workflow Smoke\n\nsaved through editor')
    const saveAction = page.locator('.toolbar-save-action')
    await saveAction.waitFor({ state: 'visible', timeout: 10_000 })
    const saveLayout = await saveAction.evaluate((element) => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      height: element.getBoundingClientRect().height,
    }))
    assert(saveLayout.whiteSpace === 'nowrap', 'save action can wrap vertically')
    assert(saveLayout.height <= 28, 'save action is taller than the toolbar control')
    await saveAction.click()
    await page.waitForFunction(
      () => document.querySelector('.toolbar-save-state')?.textContent?.includes('已保存'),
      null,
      { timeout: 10_000 },
    )
    const file = await page.evaluate(async (path) => {
      const startedAt = Date.now()
      let result = await window.cclinkStudio.fs.readFile(path)
      while (Date.now() - startedAt < 5000 && !result.content.includes('saved through editor')) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        result = await window.cclinkStudio.fs.readFile(path)
      }
      return result
    }, markdownPath)
    assert(
      file.content.includes('saved through editor'),
      'saved markdown content not found on disk',
    )
    return 'notes.md saved'
  })

  await runCheck('markdown editor shortcuts preserve structure and app layout', async () => {
    await ensureSidebarVisible(page)
    const editor = page.locator('.tiptap').first()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

    await editor.click()
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('shortcut bold')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+B`)
    assert(
      (await editor.locator('strong').innerText()) === 'shortcut bold',
      'formatting shortcut did not apply bold',
    )
    assert((await page.locator('.sidebar').count()) === 1, 'Cmd/Ctrl+B hid the app sidebar')

    await page.keyboard.press(`${modifier}+B`)
    await page.keyboard.press(`${modifier}+I`)
    assert(
      (await editor.locator('em').innerText()) === 'shortcut bold',
      'formatting shortcut did not apply italic',
    )
    await page.keyboard.press(`${modifier}+I`)

    await page.keyboard.press(`${modifier}+Shift+S`)
    assert(
      (await editor.locator('s').innerText()) === 'shortcut bold',
      'strike shortcut did not apply',
    )
    await page.waitForTimeout(150)
    const diskAfterStrike = await page.evaluate(
      async (path) => (await window.cclinkStudio.fs.readFile(path)).content,
      markdownPath,
    )
    assert(
      diskAfterStrike.includes('saved through editor'),
      'Cmd/Ctrl+Shift+S accidentally saved the document',
    )
    await page.keyboard.press(`${modifier}+Shift+X`)
    assert((await editor.locator('s').count()) === 0, 'strike alias did not remove formatting')

    await page.keyboard.press(`${modifier}+E`)
    assert(
      (await editor.locator('code').innerText()) === 'shortcut bold',
      'inline code shortcut did not apply',
    )
    await page.keyboard.press(`${modifier}+E`)

    await page.keyboard.press(`${modifier}+K`)
    const linkEditor = page.getByRole('dialog', { name: '编辑链接' })
    await linkEditor.waitFor({ timeout: 5_000 })
    await linkEditor.getByRole('textbox', { name: '链接地址' }).fill('https://example.com')
    await linkEditor.getByRole('button', { name: '应用' }).click()
    assert(
      (await editor.locator('a').getAttribute('href')) === 'https://example.com',
      'Cmd/Ctrl+K did not apply the link',
    )

    await editor.locator('p, h1, h2, h3').first().click()
    await page.keyboard.press('End')
    await page.keyboard.press(`${modifier}+Alt+Digit3`)
    assert((await editor.locator('h3').count()) === 1, 'heading shortcut did not create H3')
    await page.keyboard.press(`${modifier}+Alt+Digit0`)
    assert((await editor.locator('h3').count()) === 0, 'paragraph shortcut did not clear H3')

    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('quote shortcut')
    await page.keyboard.press(`${modifier}+Alt+Digit0`)
    await editor.locator('p').first().click()
    await page.keyboard.press(`${modifier}+Shift+B`)
    assert((await editor.locator('blockquote').count()) === 1, 'blockquote shortcut did not apply')
    await editor.locator('blockquote p').first().click()
    const selectionInsideBlockquote = await page.evaluate(() => {
      const anchor = window.getSelection()?.anchorNode
      const element = anchor instanceof Element ? anchor : anchor?.parentElement
      return Boolean(element?.closest('blockquote'))
    })
    assert(
      selectionInsideBlockquote,
      `test cursor did not enter blockquote: ${await editor.innerHTML()}`,
    )
    await page.keyboard.press(`${modifier}+Shift+B`)
    assert(
      (await editor.locator('blockquote').count()) === 0,
      `blockquote shortcut did not toggle off: ${await editor.innerHTML()}`,
    )

    await editor.locator('p').first().click()
    const paragraphBeforeTab = (await editor.locator('p').first().textContent()) ?? ''
    const configuredTabSize = await page.evaluate(
      async () => (await window.cclinkStudio.settings.getAll()).editorTabSize,
    )
    await page.keyboard.press('Tab')
    await assertMarkdownEditorFocus(page, 'ordinary paragraph Tab moved focus out of the editor')
    const indentedParagraph = (await editor.locator('p').first().textContent()) ?? ''
    assert(
      indentedParagraph === `${' '.repeat(configuredTabSize)}${paragraphBeforeTab}`,
      `ordinary paragraph Tab did not indent content (expected=${configuredTabSize}, actual=${JSON.stringify(indentedParagraph)})`,
    )
    await page.keyboard.press(`${modifier}+Z`)
    assert(
      (await editor.locator('p').first().textContent()) === paragraphBeforeTab,
      'undo did not revert ordinary paragraph Tab indentation',
    )
    await page.keyboard.press(`${modifier}+Shift+Z`)
    assert(
      (await editor.locator('p').first().textContent()) === indentedParagraph,
      'redo did not restore ordinary paragraph Tab indentation',
    )
    await page.keyboard.press(`${modifier}+S`)
    await page.waitForFunction(
      () => document.querySelector('.toolbar-save-state')?.textContent?.includes('已保存'),
      null,
      { timeout: 10_000 },
    )
    const indentedFile = await page.evaluate(
      async (path) => window.cclinkStudio.fs.readFile(path),
      markdownPath,
    )
    assert(
      indentedFile.content.startsWith(' '.repeat(configuredTabSize)),
      `ordinary paragraph Tab indentation was not saved: ${JSON.stringify(indentedFile.content)}`,
    )
    await editor.locator('p').first().click()
    await page.keyboard.press('Shift+Tab')
    await assertMarkdownEditorFocus(page, 'ordinary paragraph Shift+Tab moved focus out')
    assert(
      (await editor.locator('p').first().textContent()) === paragraphBeforeTab,
      'ordinary paragraph Shift+Tab did not remove indentation',
    )
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('hard break')
    assert(
      (await editor.locator('br:not(.ProseMirror-trailingBreak)').count()) === 1,
      `hard break shortcut did not apply: ${await editor.innerHTML()}`,
    )
    await page.keyboard.type(' undo')
    await page.keyboard.press(`${modifier}+Z`)
    assert(!(await editor.innerText()).includes(' undo'), 'undo shortcut did not revert input')
    await page.keyboard.press(`${modifier}+Shift+Z`)
    assert((await editor.innerText()).includes(' undo'), 'redo shortcut did not restore input')

    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+Shift+8`)
    const listItems = editor.locator('ul > li')
    assert(
      (await listItems.count()) === 2,
      `list shortcut did not create two items: ${await editor.innerHTML()}`,
    )
    await listItems.nth(0).locator('p').click()
    await page.keyboard.press('Tab')
    await assertMarkdownEditorFocus(page, 'non-indentable list Tab moved focus out of the editor')
    assert(
      (await editor.locator('ul ul li').count()) === 0,
      'first list item was unexpectedly nested',
    )
    await listItems.nth(1).locator('p').click()
    await page.waitForTimeout(100)
    const selectionBeforeTab = await page.evaluate(() => ({
      activeClass: document.activeElement?.className,
      anchorText: window.getSelection()?.anchorNode?.textContent,
      anchorOffset: window.getSelection()?.anchorOffset,
    }))
    await page.keyboard.press('Tab')
    assert(
      (await editor.locator('ul ul li').count()) === 1,
      `Tab did not indent the list item: ${JSON.stringify(selectionBeforeTab)} ${await editor.innerHTML()}`,
    )
    await page.keyboard.press('Shift+Tab')
    assert(
      (await editor.locator('ul ul li').count()) === 0,
      'Shift+Tab did not outdent the list item',
    )
    await page.keyboard.press(`${modifier}+BracketRight`)
    assert(
      (await editor.locator('ul ul li').count()) === 1,
      'Cmd/Ctrl+] did not indent the list item',
    )
    await page.keyboard.press(`${modifier}+BracketLeft`)
    assert(
      (await editor.locator('ul ul li').count()) === 0,
      'Cmd/Ctrl+[ did not outdent the list item',
    )

    await page.keyboard.press(`${modifier}+Shift+7`)
    assert(
      (await editor.locator('ol > li').count()) === 2,
      'ordered-list shortcut did not convert the list',
    )

    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('task first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('task second')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+Shift+9`)
    const taskItems = editor.locator('ul[data-type="taskList"] > li')
    assert((await taskItems.count()) === 2, 'task-list shortcut did not convert the list')

    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('const value = 1')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+Alt+C`)
    const code = editor.locator('pre code')
    await code.click()
    await page.keyboard.press('Home')
    await page.waitForTimeout(100)
    await page.keyboard.press('Tab')
    const indentedCode = (await code.textContent()) ?? ''
    assert(
      indentedCode.startsWith(' '.repeat(configuredTabSize)),
      `code block Tab used the wrong width (expected=${configuredTabSize}, actual=${JSON.stringify(indentedCode)})`,
    )
    await page.keyboard.press('Shift+Tab')
    const outdentedCode = (await code.textContent()) ?? ''
    assert(!outdentedCode.startsWith(' '), 'code block Shift+Tab did not remove indentation')
    await page.keyboard.press('Shift+Tab')
    await assertMarkdownEditorFocus(page, 'code block boundary Shift+Tab moved focus out')

    await page.keyboard.press(`${modifier}+Alt+C`)
    await page.getByTitle('插入表格').click()
    const table = editor.locator('table').last()
    assert((await table.locator('tr').count()) === 3, 'table command did not insert three rows')
    await table.locator('th, td').first().locator('p').click()
    await page.keyboard.press('Shift+Tab')
    await assertMarkdownEditorFocus(page, 'first table cell Shift+Tab moved focus out')
    await table.locator('th, td').last().locator('p').click()
    await page.keyboard.type('last cell')
    await page.keyboard.press('Tab')
    assert((await table.locator('tr').count()) === 4, 'table Tab did not append a row')

    await page.keyboard.press(`${modifier}+S`)
    await page.waitForFunction(
      () => document.querySelector('.toolbar-save-state')?.textContent?.includes('已保存'),
      null,
      { timeout: 10_000 },
    )
    return 'format/link/heading/quote/list/code/table/save shortcuts'
  })

  await runCheck('markdown task input and nested numbered headings stay semantic', async () => {
    const editor = page.locator('.tiptap').first()
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

    await editor.click()
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('[]')
    await page.keyboard.press('Space')
    await page.keyboard.type('todo')
    const taskItem = editor.locator('ul[data-type="taskList"] > li').first()
    assert(
      (await taskItem.count()) === 1,
      `[] Space did not create a task: ${await editor.innerHTML()}`,
    )
    assert(
      (await taskItem.getAttribute('data-checked')) === 'false',
      'new task was unexpectedly checked',
    )

    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+Shift+7`)
    const secondOrderedItem = editor.locator('ol > li').nth(1).locator('p')
    await secondOrderedItem.click()
    await page.waitForFunction(
      (element) => {
        const selection = window.getSelection()
        return Boolean(
          selection?.isCollapsed && selection.anchorNode && element.contains(selection.anchorNode),
        )
      },
      await secondOrderedItem.elementHandle(),
    )
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    const nestedOrderedList = editor.locator('ol ol').first()
    assert(
      (await nestedOrderedList.count()) === 1,
      `Tab did not create a nested ordered list: ${await editor.innerHTML()}`,
    )
    assert(
      (await nestedOrderedList.evaluate((element) => getComputedStyle(element).listStyleType)) ===
        'lower-alpha',
      'second ordered-list level did not use lower-alpha markers',
    )
    await page.keyboard.press('Enter')
    await page.keyboard.type('third')
    await page.keyboard.press('Tab')
    const thirdLevelOrderedList = editor.locator('ol ol ol').first()
    assert(
      (await thirdLevelOrderedList.count()) === 1 &&
        (await thirdLevelOrderedList.evaluate(
          (element) => getComputedStyle(element).listStyleType,
        )) === 'lower-roman',
      `third ordered-list level did not use lower-roman markers: ${await editor.innerHTML()}`,
    )

    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('###')
    await page.keyboard.press('Space')
    await page.keyboard.type('1.')
    await page.keyboard.press('Space')
    await page.keyboard.type('编号标题')
    const numberedHeading = editor.locator('ol > li > h3').first()
    assert(
      (await numberedHeading.innerText()) === '编号标题',
      `heading and ordered-list input rules did not compose: ${await editor.innerHTML()}`,
    )

    await page.keyboard.press(`${modifier}+S`)
    await page.waitForFunction(
      () => document.querySelector('.toolbar-save-state')?.textContent?.includes('已保存'),
      null,
      { timeout: 10_000 },
    )
    const saved = await page.evaluate(
      async (path) => (await window.cclinkStudio.fs.readFile(path)).content,
      markdownPath,
    )
    assert(saved.includes('1. ### 编号标题'), `saved Markdown lost the list heading: ${saved}`)
    const notesTab = page.locator('.tab', { hasText: 'notes.md' }).first()
    await notesTab.locator('.tab-close').click()
    await ensureSidebarVisible(page)
    await clickByTitle(page, '文件')
    const notesFile = page.locator('.file-tree-item.file', { hasText: 'notes.md' }).first()
    await notesFile.evaluate((element) => element.click())
    await page.waitForSelector('.markdown-editor-wrapper', { timeout: 15_000 })
    assert(
      (await page.locator('.tiptap ol > li > h3').first().innerText()) === '编号标题',
      'reopened Markdown lost the numbered heading structure',
    )
    return 'task shortcut, three numbered levels, and 1. ### heading save/reopen'
  })

  await runCheck('markdown normalization stays editable after save', async () => {
    await ensureSidebarVisible(page)
    await clickByTitle(page, '文件')
    const fileItem = page.locator('.file-tree-item.file', { hasText: 'roundtrip.md' }).first()
    await fileItem.waitFor({ timeout: 10_000 })
    await fileItem.evaluate((element) => element.click())
    await page.waitForSelector('.markdown-editor-wrapper', { timeout: 15_000 })
    assert(
      (await page.locator('.markdown-parse-blocked').count()) === 0,
      'equivalent Markdown normalization was blocked on open',
    )

    const editor = page.locator('.tiptap').first()
    assert(
      (await editor.locator('pre code').count()) === 3,
      'multiple indented and fenced code blocks were not all rendered',
    )
    assert((await editor.locator('ol').first().getAttribute('start')) === '7', 'ordered start lost')
    assert((await editor.locator('table').count()) === 1, 'aligned table did not render')
    assert((await editor.locator('a[title="说明标题"]').count()) === 1, 'link title did not render')
    assert(
      (await editor.locator('br:not(.ProseMirror-trailingBreak)').count()) >= 1,
      'hard break did not render',
    )
    const heading = editor.locator('h1').first()
    await heading.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' updated')
    await page.locator('.toolbar-save-action').click()
    await page.waitForFunction(
      () => document.querySelector('.toolbar-save-state')?.textContent?.includes('已保存'),
      null,
      { timeout: 10_000 },
    )
    assert(await editor.isVisible(), 'editor was hidden after its own successful save')
    assert(
      (await page.locator('.markdown-parse-blocked').count()) === 0,
      'editor was blocked after its own version hash changed',
    )
    const savedRoundtrip = await page.evaluate(
      async (path) => (await window.cclinkStudio.fs.readFile(path)).content,
      `${workspaceDir}/roundtrip.md`,
    )
    assert(/^7\. 第七项/m.test(savedRoundtrip), 'save changed the ordered-list start')
    assert(
      savedRoundtrip.includes('| :---') &&
        savedRoundtrip.includes(':---:') &&
        savedRoundtrip.includes('---:'),
      'save changed table alignment',
    )
    assert(savedRoundtrip.includes('"说明标题"'), 'save removed the link title')
    assert(
      savedRoundtrip.includes('第一行保留硬换行。  \n第二行不能丢。'),
      'save changed the hard break or nearby text',
    )

    const roundtripTab = page.locator('.tab', { hasText: 'roundtrip.md' }).first()
    await roundtripTab.locator('.tab-close').click()
    await fileItem.evaluate((element) => element.click())
    await page.waitForSelector('.markdown-editor-wrapper', { timeout: 15_000 })
    assert(
      (await page.locator('.markdown-parse-blocked').count()) === 0,
      'saved Markdown was blocked when reopened',
    )
    assert(
      (await page.locator('.tiptap h1').first().textContent())?.includes('updated'),
      'reopened Markdown did not contain the saved change',
    )
    assert(
      (await page.locator('.tiptap pre code').count()) === 3,
      'reopened Markdown lost a normalized code block',
    )
    assert(
      (await page.locator('.tiptap ol').first().getAttribute('start')) === '7' &&
        (await page.locator('.tiptap table').count()) === 1 &&
        (await page.locator('.tiptap a[title="说明标题"]').count()) === 1,
      'reopened Markdown lost an untouched structure',
    )
    return 'single edit preserved list start, table alignment, link title, hard break, and code blocks'
  })

  await runCheck('markdown math degrades to editable text without source loss', async () => {
    await ensureSidebarVisible(page)
    await clickByTitle(page, '文件')
    const fileItem = page.locator('.file-tree-item.file', { hasText: 'math.md' }).first()
    await fileItem.waitFor({ timeout: 10_000 })
    await fileItem.evaluate((element) => element.click())
    await page.waitForSelector('.markdown-editor-wrapper', { timeout: 15_000 })
    assert(
      (await page.locator('.markdown-parse-blocked').count()) === 0,
      'math Markdown was blocked during preflight',
    )
    const protectedPreview = page.locator('.markdown-protected-preview')
    if ((await protectedPreview.count()) > 0) {
      await protectedPreview.getByRole('button', { name: '复制诊断日志' }).click()
      const diagnostic = await page.evaluate(() => navigator.clipboard.readText())
      throw new Error(`math Markdown fell back to a protected preview:\n${diagnostic}`)
    }

    const editor = page.locator('.tiptap').first()
    const editorText = (await editor.textContent()) ?? ''
    assert(
      editorText.includes('\\Delta w = \\eta xy') &&
        editorText.includes('w_{t+1} = w_t + \\eta x_t y_t'),
      'math source was not visible as plain text',
    )
    assert(
      editorText.length > 7_500 && editorText.includes('大型报告渲染完成。'),
      `large Markdown report rendered incompletely (characters=${editorText.length})`,
    )
    const heading = editor.locator('h2').nth(20)
    await heading.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' updated')
    const scrollContainer = page.locator('.tiptap-editor').first()
    await page.waitForTimeout(150)
    const scrollTopBeforeSave = await scrollContainer.evaluate((element) => element.scrollTop)
    assert(scrollTopBeforeSave > 100, 'large Markdown fixture was not scrollable before save')
    await page.locator('.toolbar-save-action').click()
    await page.waitForFunction(
      () => document.querySelector('.toolbar-save-state')?.textContent?.includes('已保存'),
      null,
      { timeout: 10_000 },
    )
    await page.waitForTimeout(100)
    const scrollTopAfterSave = await page
      .locator('.tiptap-editor')
      .first()
      .evaluate((element) => element.scrollTop)
    assert(
      Math.abs(scrollTopAfterSave - scrollTopBeforeSave) <= 2,
      `saving Markdown reset scroll position (before=${scrollTopBeforeSave}, after=${scrollTopAfterSave})`,
    )

    const mathPath = `${workspaceDir}/math.md`
    const diskContent = await page.evaluate(
      async (path) => (await window.cclinkStudio.fs.readFile(path)).content,
      mathPath,
    )
    assert(diskContent.includes('$\\Delta w = \\eta xy$'), 'saved Markdown lost inline math')
    assert(
      diskContent.includes('w_{t+1} = w_t + \\eta x_t y_t'),
      'saved Markdown lost display math',
    )
    assert(
      diskContent.includes('\\underbrace{x}_{\\text{输入}}') &&
        diskContent.includes('A^+ e^{-\\Delta t/\\tau} & \\Delta t > 0'),
      'saved Markdown changed LaTeX punctuation',
    )
    assert(
      diskContent.includes('$5') && diskContent.includes('$10') && diskContent.includes('\\$20'),
      'saved Markdown changed currency or escaped dollar text',
    )

    const mathTab = page.locator('.tab', { hasText: 'math.md' }).first()
    await mathTab.locator('.tab-close').click()
    await fileItem.evaluate((element) => element.click())
    await page.waitForSelector('.markdown-editor-wrapper', { timeout: 15_000 })
    assert(
      (await page.locator('.markdown-parse-blocked').count()) === 0 &&
        (await page.locator('.markdown-protected-preview').count()) === 0,
      'saved math Markdown was blocked when reopened',
    )
    assert(
      ((await page.locator('.tiptap').first().textContent()) ?? '').includes(
        'w_{t+1} = w_t + \\eta x_t y_t',
      ),
      'reopened Markdown did not retain display math',
    )
    return 'inline/display math stayed editable and survived save/reopen as plain text'
  })

  await runCheck('markdown failures expose a fresh copyable diagnostic after reload', async () => {
    await ensureSidebarVisible(page)
    await clickByTitle(page, '文件')
    const fileItem = page.locator('.file-tree-item.file', { hasText: 'blocked.md' }).first()
    await fileItem.waitFor({ timeout: 10_000 })
    await fileItem.evaluate((element) => element.click())

    const blocked = page.locator('.markdown-parse-blocked')
    await blocked.waitFor({ timeout: 10_000 })
    const reload = blocked.getByRole('button', { name: '重新载入磁盘版本' })
    const copy = blocked.getByRole('button', { name: '复制诊断日志' })
    await copy.waitFor({ timeout: 10_000 })

    const recheckLog = page.waitForEvent('console', {
      predicate: (message) => message.text().includes('Markdown 预检查失败'),
      timeout: 10_000,
    })
    await reload.click()
    await recheckLog
    await copy.click()
    const diagnostic = await page.evaluate(() => navigator.clipboard.readText())
    assert(
      diagnostic.includes('"reportType": "cclink-markdown-render-diagnostic"'),
      'copied Markdown diagnostic has the wrong report type',
    )
    assert(
      diagnostic.includes('"trigger": "reload"') && diagnostic.includes('"reloadGeneration": 1'),
      'copied Markdown diagnostic was stale after reload',
    )
    assert(
      diagnostic.includes('"code": "unsupported-frontmatter"'),
      'copied Markdown diagnostic omitted the blocking reason',
    )

    const copyAll = page.locator('.agent-copy-diagnostics-btn')
    await copyAll.waitFor({ timeout: 10_000 })
    await copyAll.click()
    const agentDiagnostic = await page.evaluate(() => navigator.clipboard.readText())
    assert(
      agentDiagnostic.includes('# CCLink Studio 诊断日志'),
      'Agent diagnostic button did not copy the Agent report',
    )
    assert(
      !agentDiagnostic.includes('# CCLink Studio 框架诊断日志'),
      'Agent diagnostic button unexpectedly copied the framework report',
    )

    const copyFramework = page.locator('.framework-diagnostics-status')
    await copyFramework.waitFor({ timeout: 10_000 })
    await copyFramework.click()
    const frameworkDiagnostic = await page.evaluate(() => navigator.clipboard.readText())
    assert(
      frameworkDiagnostic.includes('# CCLink Studio 框架诊断日志'),
      'status bar diagnostic button did not copy the framework report',
    )
    assert(
      frameworkDiagnostic.includes('## Markdown 编辑器') &&
        frameworkDiagnostic.includes('"reportType": "cclink-markdown-render-diagnostic"'),
      'framework report omitted the active Markdown diagnostic',
    )
    assert(
      frameworkDiagnostic.includes('## 界面近期框架日志') &&
        frameworkDiagnostic.includes('## 主进程近期框架日志'),
      'framework report omitted process logs',
    )
    return 'reload generated a fresh report and Agent/framework diagnostics stayed separated'
  })

  await runCheck('browser tab is available from the workbench', async () => {
    await page.locator('.tab-new-browser-button').click()
    await page.waitForSelector('.browser-toolbar .url-input', { timeout: 15_000 })
    const url = await page.evaluate(() => window.cclinkStudio.browser.getCurrentURL('browser'))
    assert(typeof url === 'string', 'browser current URL should be readable')
    return url || 'blank'
  })

  await runCheck('workbench frame context actions bind the intended target', async () => {
    await page.locator('.tab', { hasText: 'notes.md' }).first().click()
    await ensureSidebarVisible(page)
    const fileActivity = page.locator('.activity-bar-icon[title="文件"]').first()
    await fileActivity.click()
    await page.waitForFunction(
      () =>
        document.querySelector('.activity-bar-icon[title="文件"]')?.classList.contains('active'),
      undefined,
      { timeout: 10_000 },
    )
    const activeFileTree = page.locator('.sidebar .file-tree').first()
    await activeFileTree.waitFor({ timeout: 10_000 })

    const openRendererContextMenu = async (target, position) => {
      const point = await target.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }
      })
      await target.dispatchEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        ...(position ?? point),
      })
    }

    const verifyMouseAndKeyboardMenu = async (target, actionId) => {
      await openRendererContextMenu(target)
      await page.locator(`[data-context-action="${actionId}"]`).waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await target.focus()
      await page.keyboard.press('Shift+F10')
      await page.locator(`[data-context-action="${actionId}"]`).waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
    }

    const fileItem = activeFileTree.locator('.file-tree-item.file', { hasText: 'todo.txt' }).first()
    await fileItem.waitFor({ timeout: 10_000 })
    await verifyMouseAndKeyboardMenu(fileItem, 'file.reveal')
    await openRendererContextMenu(fileItem)
    assert(
      (await page.locator('[data-context-action="file.trash"]').count()) === 1,
      'generic file trash action is missing',
    )
    await page.keyboard.press('Escape')
    await openRendererContextMenu(fileItem)
    await page.locator('[data-context-action="file.rename"]').evaluate((element) => element.click())
    const fileRenameInput = page
      .locator('.unified-context-menu input[aria-label="重命名文件或文件夹"]')
      .first()
    await fileRenameInput.waitFor({ timeout: 10_000 })
    assert(
      await fileRenameInput.evaluate((element) => element === document.activeElement),
      'file rename input did not retain focus',
    )
    await fileRenameInput.fill('todo-renamed.txt')
    await fileRenameInput.press('Enter')
    await activeFileTree
      .locator('.file-tree-item.file', { hasText: 'todo-renamed.txt' })
      .first()
      .waitFor({ timeout: 10_000 })
    const fileRenameDiskState = await page.evaluate(async (workspacePath) => {
      let oldExists = true
      try {
        await window.cclinkStudio.fs.stat(`${workspacePath}/todo.txt`)
      } catch {
        oldExists = false
      }
      const renamed = await window.cclinkStudio.fs.stat(`${workspacePath}/todo-renamed.txt`)
      return { oldExists, renamed }
    }, workspaceDir)
    assert(!fileRenameDiskState.oldExists, 'file tree rename left the old path on disk')
    assert(
      fileRenameDiskState.renamed.name === 'todo-renamed.txt',
      'file tree rename did not create the expected disk path',
    )

    const renamedFileItem = activeFileTree
      .locator('.file-tree-item.file', { hasText: 'todo-renamed.txt' })
      .first()
    const archiveItem = activeFileTree
      .locator('.file-tree-item.directory', { hasText: 'archive' })
      .first()
    await openRendererContextMenu(renamedFileItem)
    await page
      .locator('[data-context-action="file.copy-entry"]')
      .evaluate((element) => element.click())
    await archiveItem.focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
    await activeFileTree
      .locator('.file-tree-children .file-tree-item.file', { hasText: 'todo-renamed.txt' })
      .first()
      .waitFor({ timeout: 10_000 })
    await page.evaluate(
      async (path) => window.cclinkStudio.fs.stat(path),
      `${workspaceDir}/archive/todo-renamed.txt`,
    )

    await renamedFileItem.focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C')
    await openRendererContextMenu(archiveItem)
    await page
      .locator('[data-context-action="file.paste-entry"]')
      .evaluate((element) => element.click())
    const duplicateCopy = await page.evaluate(
      async (path) => window.cclinkStudio.fs.stat(path),
      `${workspaceDir}/archive/todo-renamed 副本.txt`,
    )
    assert(
      duplicateCopy.name === 'todo-renamed 副本.txt',
      'file copy did not generate a non-overwriting duplicate name',
    )

    const activity = page.locator('.activity-bar-icon[title="文件"]').first()
    await verifyMouseAndKeyboardMenu(activity, 'activity.open')
    await openRendererContextMenu(activity)
    assert(
      (await page.locator('[data-context-action="activity.sidebar"]').count()) === 1,
      'activity layout action is missing',
    )
    await page.keyboard.press('Escape')

    const sidebar = page.locator('.sidebar').first()
    const sidebarBox = await sidebar.boundingBox()
    assert(sidebarBox, 'sidebar bounds are unavailable')
    await openRendererContextMenu(sidebar, {
      clientX: sidebarBox.x + 4,
      clientY: sidebarBox.y + Math.max(4, sidebarBox.height - 4),
    })
    await page.locator('[data-context-action="sidebar.hide"]').waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await sidebar.focus()
    await page.keyboard.press('Shift+F10')
    await page.locator('[data-context-action="sidebar.hide"]').waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')

    await ensureSidebarVisible(page)
    const layoutHandle = page.locator('[data-layout-area="sidebar"]').first()
    await verifyMouseAndKeyboardMenu(layoutHandle, 'layout.reset-size')

    const workspaceStatus = page.locator('[data-status-item="workspace"]')
    await verifyMouseAndKeyboardMenu(workspaceStatus, 'status.copy')
    await openRendererContextMenu(workspaceStatus)
    assert(
      (await page.locator('[data-context-action="status.diagnostics"]').count()) === 1,
      'workspace diagnostics action is missing',
    )
    await page.keyboard.press('Escape')

    const project = page.locator(`.project-strip-item[data-project-path="${workspaceDir}"]`).first()
    await verifyMouseAndKeyboardMenu(project, 'project.copy-path')
    await openRendererContextMenu(project)
    assert(
      (await page.locator('[data-context-action="project.diagnostics"]').count()) === 1,
      'project diagnostics action is missing',
    )
    await page.keyboard.press('Escape')

    const tab = page.locator('.tab').first()
    await verifyMouseAndKeyboardMenu(tab, 'tab.close-others')
    await openRendererContextMenu(tab)
    await page.locator('[data-context-action="tab.close-right"]').waitFor({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    return 'file/activity/status/project/tab'
  })

  await runCheck(
    'core content context actions bind editor, Terminal, and Agent targets',
    async () => {
      const editorTab = page.locator('.tab', { hasText: 'notes.md' }).first()
      await editorTab.click()
      const editor = page.locator('.tiptap').first()
      await editor.waitFor({ timeout: 10_000 })
      await editor.click({ button: 'right' })
      await page.locator('[data-context-action="editor.paste"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')

      const message = page.locator('.agent-message').first()
      await message.waitFor({ timeout: 10_000 })
      await message.click({ button: 'right' })
      await page.locator('[data-context-action="message.quote"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await message.focus()
      await page.keyboard.press('Shift+F10')
      await page.locator('[data-context-action="message.copy"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')

      await createTabFromMenu(page, 'Terminal')
      const terminal = page.locator('.terminal-pty-shell').first()
      await terminal.waitFor({ timeout: 15_000 })
      await terminal.click({ button: 'right' })
      await page.locator('[data-context-action="terminal.paste"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await terminal.focus()
      await page.keyboard.press('Shift+F10')
      await page.locator('[data-context-action="terminal.clear"]').waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      return 'editor/message/terminal mouse+keyboard'
    },
  )

  await runCheck('domain context actions bind Production and Settings targets', async () => {
    const verifyMouseAndKeyboardMenu = async (target, mouseActionId, keyboardActionId) => {
      await target.click({ button: 'right' })
      await page.locator(`[data-context-action="${mouseActionId}"]`).waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await target.focus()
      await page.keyboard.press('Shift+F10')
      await page.locator(`[data-context-action="${keyboardActionId}"]`).waitFor({ timeout: 10_000 })
      await page.keyboard.press('Escape')
    }

    await ensureSidebarVisible(page)
    await clickByTitle(page, '生产')
    const production = page.locator('[data-context-target="production"]').first()
    await production.waitFor({ timeout: 15_000 })
    await verifyMouseAndKeyboardMenu(production, 'production.scan', 'production.copy-status')
    await production.click({ button: 'right' })
    const disabledProductionAction = page.locator('[data-context-action="production.inspect"]')
    await disabledProductionAction.waitFor()
    assert(await disabledProductionAction.isDisabled(), 'production inspect should be disabled')
    assert(
      Boolean(
        (
          await disabledProductionAction.locator('.context-menu-disabled-reason').textContent()
        )?.trim(),
      ),
      'disabled context action should expose its reason',
    )
    await page.keyboard.press('Escape')

    await clickByTitle(page, '设置')
    const setting = page.locator('[data-context-target="setting"]').first()
    await setting.waitFor({ timeout: 15_000 })
    await verifyMouseAndKeyboardMenu(setting, 'settings.copy-key', 'settings.reset-current')
    await setting.focus()
    await page.keyboard.press('Shift+F10')
    const settingsCopyKeyAction = page.locator('[data-context-action="settings.copy-key"]')
    await settingsCopyKeyAction.waitFor()
    const initialSettingsAction = await waitForContextActionFocus(page)
    assert(
      initialSettingsAction === 'settings.reset-current' ||
        initialSettingsAction === 'settings.copy-key',
      `settings context menu should focus an enabled action (actual=${initialSettingsAction ?? 'none'})`,
    )
    await page.keyboard.press('End')
    assert(
      (await page.evaluate(() => document.activeElement?.getAttribute('data-context-action'))) ===
        'settings.copy-key',
      'End should focus the final enabled settings action',
    )
    await settingsCopyKeyAction.press('Space')
    await page.locator('.unified-context-menu').waitFor({ state: 'hidden' })
    return 'mouse/Shift+F10/Space/disabled reason'
  })

  await runCheck('context menu stays inside a compact viewport', async () => {
    await page.setViewportSize({ width: 900, height: 620 })
    const settingsButton = page.locator('.activity-bar-icon[title="设置"]').first()
    await settingsButton.click({ button: 'right' })
    const menu = page.locator('.unified-context-menu')
    await menu.waitFor({ timeout: 10_000 })
    const bounds = await menu.boundingBox()
    assert(bounds, 'context menu bounds are unavailable')
    assert(bounds.x >= 0 && bounds.y >= 0, 'context menu escaped the top or left viewport edge')
    assert(bounds.x + bounds.width <= 900, 'context menu escaped the right viewport edge')
    assert(bounds.y + bounds.height <= 620, 'context menu escaped the bottom viewport edge')
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1440, height: 920 })
    return `${Math.round(bounds.width)}x${Math.round(bounds.height)}`
  })

  await runCheck('file tab rename updates the disk path, tab, and file tree', async () => {
    const oldPath = markdownPath
    const newName = 'notes-renamed.md'
    const newPath = `${workspaceDir}/${newName}`
    const contentBeforeRename = await page.evaluate(
      async (path) => (await window.cclinkStudio.fs.readFile(path)).content,
      oldPath,
    )
    const editorTab = page.locator('.tab', { hasText: 'notes.md' }).first()
    await editorTab.waitFor({ timeout: 10_000 })
    await editorTab.click({ button: 'right' })
    const renameAction = page.locator('[data-context-action="tab.rename"]')
    await renameAction.waitFor({ timeout: 10_000 })
    assert(
      (await renameAction.textContent())?.includes('重命名文件'),
      'file-backed tab should expose a file rename action',
    )
    await renameAction.click()
    const renameInput = page.locator('.unified-context-menu input').first()
    await renameInput.waitFor({ timeout: 10_000 })
    await renameInput.fill(newName)
    await renameInput.press('Enter')

    const renamedTab = page.locator('.tab', { hasText: newName }).first()
    await renamedTab.waitFor({ timeout: 10_000 })
    await ensureSidebarVisible(page)
    await clickByTitle(page, '文件')
    await page
      .locator('.file-tree-item.file', { hasText: newName })
      .first()
      .waitFor({ timeout: 10_000 })

    const diskState = await page.evaluate(
      async ({ oldFilePath, newFilePath }) => {
        let oldExists = true
        try {
          await window.cclinkStudio.fs.stat(oldFilePath)
        } catch {
          oldExists = false
        }
        const renamed = await window.cclinkStudio.fs.readFile(newFilePath)
        return { oldExists, renamed }
      },
      { oldFilePath: oldPath, newFilePath: newPath },
    )
    assert(!diskState.oldExists, 'old markdown path still exists after tab rename')
    assert(
      diskState.renamed.content === contentBeforeRename,
      'renamed markdown content differs from the pre-rename disk content',
    )
    markdownPath = newPath
    return newName
  })

  await runCheck('terminal can execute a command in the local workspace', async () => {
    const result = await page.evaluate(async (workspacePath) => {
      const sessionId = `workflow-terminal-${Date.now()}`
      const runtime = {
        location: 'local',
        transport: 'local',
        backend: 'local-shell',
        workspaceRef: { kind: 'local', path: workspacePath },
        cwd: workspacePath,
      }
      const events = []
      const off = window.cclinkStudio.terminal.onExecutionEvent((event) => {
        if (event.sessionId === sessionId) events.push(event)
      })
      const started = await window.cclinkStudio.terminal.startPty({
        terminalSessionId: sessionId,
        runtime,
        size: { columns: 80, rows: 24 },
      })
      if (started.success) {
        const startedAt = Date.now()
        while (Date.now() - startedAt < 5000 && !events.some((event) => event.kind === 'started')) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        const promptStartedAt = Date.now()
        while (
          Date.now() - promptStartedAt < 5000 &&
          !events.some((event) => event.kind === 'output')
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        await window.cclinkStudio.terminal.writePty({
          terminalSessionId: sessionId,
          data: 'pwd\rprintf "workflow-smoke-terminal\\n"\rexit\r',
        })
      }
      const startedAt = Date.now()
      while (Date.now() - startedAt < 5000) {
        const output = events
          .filter((event) => event.kind === 'output')
          .map((event) => event.data)
          .join('')
        if (output.includes('workflow-smoke-terminal')) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      await window.cclinkStudio.terminal.terminatePty(sessionId)
      off()
      return { started, events }
    }, workspaceDir)
    assert(result.started.success, result.started.error || 'terminal failed to start')
    const output = result.events
      .filter((event) => event.kind === 'output')
      .map((event) => event.data)
      .join('')
    assert(output.includes('workflow-smoke-terminal'), 'terminal output missing marker')
    assert(output.includes(workspaceDir), `terminal did not run in smoke workspace: ${output}`)
    return `pid=${result.started.processId ?? 'unknown'}`
  })

  await closeTemporaryWorkspaces()
  await restoreWorkspaceSettings()
  await cleanupWorkspaceDir()
  await browser.close()

  const failed = results.filter((result) => result.status === 'fail')
  if (startedBySmoke && !keepRunning) runRestart('stop')
  if (failed.length > 0) {
    console.error(`\nWorkflow smoke failed: ${failed.length}/${results.length}`)
    process.exit(1)
  }
  console.log(`\nWorkflow smoke passed: ${results.length}/${results.length}`)
}

main().catch(async (error) => {
  try {
    await closeTemporaryWorkspaces()
  } catch {
    // best effort project close
  }
  try {
    await restoreWorkspaceSettings()
  } catch {
    // best effort restore
  }
  try {
    await cleanupWorkspaceDir()
  } catch (cleanupError) {
    console.error(`Workflow smoke cleanup failed: ${cleanupError.message || String(cleanupError)}`)
  }
  if (startedBySmoke && !keepRunning) {
    try {
      runRestart('stop')
    } catch {
      // best effort cleanup
    }
  }
  console.error(error)
  process.exit(1)
})
