#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

process.env.CCLINK_STUDIO_SMOKE_RUN_DIR ??= '/tmp/cclink-local-tts-acceptance'
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= '39891'
const { rootDir, runDir, logFile, rendererOrigin } = createSmokeRuntime(import.meta.url)
const workspace = join(rootDir, '.cache', `local-tts-acceptance-workspace-${Date.now()}`),
  otherWorkspace = join(rootDir, '.cache', 'local-tts-acceptance-other-workspace'),
  userData = join(runDir, 'user-data')
for (const path of [runDir, workspace, otherWorkspace, userData])
  await mkdir(path, { recursive: true })
execFileSync('git', ['init', '--initial-branch=main', workspace], { stdio: 'ignore' })
const md =
  '# 本地朗读验收\n\n这是当前文档的第一段，用来验证中文朗读以及播放控制。\n\n第二段包含 English 和数字 2026，测试中英文混读。\n\n```js\nsecret_code_omit()\n```\n\n最后一段用于验证自然播完。'
await writeFile(join(workspace, '朗读验收.md'), md)
await writeFile(
  join(userData, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: Object.fromEntries(
      [workspace, otherWorkspace].map((path, i) => [
        String(i),
        {
          workspaceKey: path,
          workspacePath: path,
          ownerKey: null,
          updatedAt: Date.now(),
          storage: 'fallback',
          projectId: null,
        },
      ]),
    ),
  }),
)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace, otherWorkspace],
    componentSetupPageSeenVersion: 2,
    markdownAutoSave: false,
  }),
)
const web = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(
    '<!doctype html><title>网页朗读验收</title><nav><p>导航内容不应朗读</p></nav><main><article><h1>网页正文朗读</h1><p>这是网页正文第一段，我们使用真实浏览器验证本地语音播放。</p><p>第二段介绍离线语音功能，文本只在本机处理。</p><ul><li>父列表正文<ul><li>子列表正文</li></ul></li></ul><p>正常正文<span aria-hidden="true">隐藏提示不应朗读</span><button>按钮文字不应朗读</button></p><p><span>Hello</span> <strong>world</strong></p><pre>网页代码不应朗读</pre></article></main><footer><p>页脚不应朗读</p></footer>',
  )
})
await new Promise((r) => web.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${web.address().port}`
const checks = [],
  errors = []
let child, browser, page
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, label, timeout = 45000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await sleep(200)
  }
  throw new Error(`Timeout ${label}`)
}
const snap = () => page.evaluate(() => window.cclinkStudio.localTts.getSnapshot())
const phase = async (p) =>
  waitFor(
    async () => {
      const s = await snap()
      if (s.phase === 'failed') throw new Error(JSON.stringify(s.error))
      return s.phase === p && s
    },
    p,
    90000,
  )
const check = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
const shot = (name) => page.screenshot({ path: join(runDir, `${name}.png`) })
async function readFromStatus(selection = false) {
  const trigger = page.getByLabel('展开本地朗读播放器')
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await page
    .getByRole('button', {
      name: selection ? '朗读选中内容' : '朗读当前内容',
      exact: true,
    })
    .click()
  if (await page.getByLabel('收起朗读播放器').isVisible())
    await page.getByLabel('收起朗读播放器').click()
}
async function openWorkspace(path) {
  await page.evaluate(async (path) => {
    await window.cclinkStudio.workspaceState.listLocalWorkspaces(null)
    const { openWorkspaceRef } =
      await import('/src/features/workspace-open/workspace-open-controller.ts')
    await openWorkspaceRef({ kind: 'local', path })
  }, path)
}
try {
  const fd = openSync(logFile, 'w')
  child = spawn('bash', ['scripts/dev.sh'], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
      CCLINK_STUDIO_RENDERER_PORT: process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT,
    },
    detached: true,
    stdio: ['ignore', fd, fd],
  })
  closeSync(fd)
  const port = await waitFor(
    async () => {
      const log = await readFile(logFile, 'utf8').catch(() => '')
      return (
        log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1] ||
        log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)?.[1]
      )
    },
    'CDP',
    90000,
  )
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = await waitFor(
    () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().startsWith(rendererOrigin + '/')),
    'renderer',
  )
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.waitForSelector('.main-window')
  await waitFor(
    () =>
      page.evaluate(async () => {
        const { useFsStore } = await import('/src/stores/fs-store.ts')
        return !useFsStore.getState().loading && !useFsStore.getState().switchingPath
      }),
    'initial workspace',
  )
  await openWorkspace(workspace)
  await page.evaluate(async () => {
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    useUIStore.getState().setAgentPanelMode('hidden')
    useUIStore.getState().showPanel('files')
  })
  await page.locator('.file-tree-item.file').filter({ hasText: '朗读验收.md' }).click()
  await page.locator('.tiptap[contenteditable=true]').waitFor()
  assert.equal(await page.locator('.editor-toolbar .tts-source-button').count(), 0)
  await readFromStatus()
  let first = await snap()
  if (first.resource?.health !== 'healthy') {
    assert.equal(first.phase, 'needs-model')
    if ((await page.getByLabel('展开本地朗读播放器').getAttribute('aria-expanded')) !== 'true')
      await page.getByLabel('展开本地朗读播放器').click()
    await page.getByRole('button', { name: '下载并安装', exact: true }).click()
    await shot('01-model-install')
    let last = ''
    await waitFor(
      async () => {
        const s = await snap()
        if (s.resource?.phase === 'failed') throw new Error(JSON.stringify(s.resource.failure))
        const p = s.resource?.phase + ':' + s.resource?.progress?.percent
        if (p !== last) {
          console.log('RESOURCE', p)
          last = p
        }
        return s.resource?.health === 'healthy'
      },
      'real model download/hash/extract',
      600000,
    )
    await page.getByRole('button', { name: '播放', exact: true }).click()
    check('first install through player, archive and every model file verified')
  } else check('existing model integrity checked at startup')
  await phase('playing')
  await shot('02-md-playing')
  check('MD bottom player → real utilityProcess synthesis → HTMLAudio playing event')
  assert(!(await snap()).segments.join('').includes('secret_code_omit'))
  if (await page.getByLabel('收起朗读播放器').isVisible())
    await page.getByLabel('收起朗读播放器').click()
  await page.getByLabel('暂停朗读', { exact: true }).click()
  await phase('paused')
  check('pause confirmed by actual audio transport')
  await page.getByLabel('展开本地朗读播放器').click()
  await page.getByLabel('朗读语速', { exact: true }).selectOption('1.5')
  assert.equal((await snap()).rate, 1.5)
  await page.getByLabel('朗读音量', { exact: true }).fill('0.5')
  await page.getByLabel('收起朗读播放器').click()
  await page.getByLabel('继续朗读', { exact: true }).click()
  await phase('playing')
  await page.getByLabel('下一段', { exact: true }).click()
  await phase('playing')
  check('resume, rate, volume and paragraph seek')
  await page.getByLabel('停止朗读', { exact: true }).click()
  await phase('stopped')
  await page
    .locator('.tiptap[contenteditable=true]')
    .fill('未保存内容也可以朗读。这句话没有写入磁盘。')
  await readFromStatus()
  await phase('playing')
  assert((await snap()).segments.join('').includes('未保存内容'))
  assert.equal(await readFile(join(workspace, '朗读验收.md'), 'utf8'), md)
  check('unsaved Markdown snapshot read without saving')
  await page.locator('.tiptap[contenteditable=true]').click()
  await page.locator('.tiptap[contenteditable=true]').press('Meta+a')
  await readFromStatus(true)
  await phase('playing')
  assert.equal((await snap()).source.selection, true)
  check('bottom player preserves and reads actual Markdown selection')

  const oldSession = (await snap()).sessionId
  await page.evaluate(async (url) => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    useTabStore
      .getState()
      .openTab({ type: 'browser', title: '网页朗读验收', icon: '🌐', initialUrl: url })
  }, url)
  await page.getByLabel('浏览器地址', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('朗读正文', { exact: true }).count(), 0)
  const webPage = await waitFor(
    () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().startsWith(url)),
    'real native browser view',
  )
  await webPage.waitForSelector('article p')
  assert.equal((await snap()).sessionId, oldSession)
  check('switching tabs retains current speech session')
  await readFromStatus()
  await waitFor(async () => (await snap()).source?.kind === 'browser', 'web source')
  await phase('playing')
  const webSnap = await snap()
  assert.notEqual(webSnap.sessionId, oldSession)
  assert(webSnap.segments.join('').includes('网页正文'))
  assert(webSnap.segments.join('').includes('Hello world'))
  assert.equal(
    webSnap.segments.join('').split('子列表正文').length - 1,
    1,
    'nested list must be read once',
  )
  for (const excluded of ['导航内容', '页脚', '网页代码', '隐藏提示', '按钮文字'])
    assert(!webSnap.segments.join('').includes(excluded))
  await page.getByLabel('展开本地朗读播放器').click()
  await page.getByRole('dialog', { name: '本地朗读播放器' }).waitFor()
  await shot('03-web-player')
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await phase('paused')
  await page.getByLabel('收起朗读播放器').click()
  check('native webpage body filtered; player popup remains operable over browser')
  await webPage
    .locator('article p')
    .nth(1)
    .evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
    })
  await readFromStatus(true)
  await phase('playing')
  assert.equal((await snap()).source.selection, true)
  assert((await snap()).segments.join('').startsWith('第二段'))
  check('bottom player preserves and reads native browser selection')
  await page.getByLabel('暂停朗读', { exact: true }).click()
  await phase('paused')

  await page.getByLabel('继续朗读', { exact: true }).click()
  await phase('playing')
  await openWorkspace(otherWorkspace)
  await phase('paused')
  check('workspace change pauses actual playback')
  await openWorkspace(workspace)
  await page.evaluate(async () => {
    const { useAgentStore } = await import('/src/stores/agent-store.ts')
    const { useWorkspaceStore } = await import('/src/stores/workspace-store.ts')
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    const a = useAgentStore.getState()
    const id = a.createConversation({
      id: 'tts-acceptance-message',
      runtime: {
        location: 'local',
        transport: 'local',
        workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
      },
      activate: true,
    })
    a.addUserMessage('这是对话中的可见正文。只朗读这一条消息。', id)
    const state = useAgentStore.getState()
    const messages = [
      {
        id: 'tts-assistant',
        role: 'assistant',
        rawText: '这是助手的可见正文。只朗读这一条消息。',
        timestamp: Date.now(),
        content: [
          { type: 'thinking', thinking: '内部思考不应朗读' },
          { type: 'text', text: '这是助手的可见正文。只朗读这一条消息。' },
        ],
      },
    ]
    useAgentStore.setState({
      conversations: { ...state.conversations, [id]: { ...state.conversations[id], messages } },
      messages,
    })

    useUIStore.getState().setAgentPanelMode('right')
  })
  await page.locator('.tts-message-action .tts-source-button').last().waitFor()
  await page.locator('.tts-message-action .tts-source-button').last().click()
  await phase('playing')
  assert.equal((await snap()).source.kind, 'message')
  assert(!(await snap()).segments.join('').includes('内部思考'))
  await page.getByLabel('展开本地朗读播放器').click()
  await shot('04-message-player')
  check('message button → same bottom player → actual audio')
  await page.getByLabel('收起朗读播放器').click()
  await page.evaluate(async () => {
    const { useAgentStore } = await import('/src/stores/agent-store.ts')
    const state = useAgentStore.getState()
    const conversations = { ...state.conversations }
    delete conversations['tts-acceptance-message']
    const button = document.querySelector('.tts-message-action .tts-source-button')
    // Remove the fixture's backing record in the same event turn as clicking its
    // still-rendered button: speech must use the displayed text, not local lookup.
    useAgentStore.setState({ conversations })
    button.click()
  })
  await phase('playing')
  assert((await snap()).segments.join('').includes('助手的可见正文'))
  assert(!(await snap()).segments.join('').includes('内部思考'))
  check('rendered message still reads its text when local conversation data is gone')
  await page.getByLabel('展开本地朗读播放器').click()

  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await phase('paused')
  for (const width of [1440, 1024, 760]) {
    await page.setViewportSize({ width, height: 940 })
    const layout = await page.evaluate(() => {
      const bounds = (s) => {
        const r = document.querySelector(s).getBoundingClientRect()
        return { left: r.left, right: r.right, width: r.width }
      }
      return {
        clock: bounds('.status-bar-center'),
        git: bounds('.git-status-root'),
        player: bounds('.tts-status-root'),
        left: bounds('.status-bar-left'),
        items: Array.from(document.querySelector('.status-bar-left').children).map((e) => ({
          className: e.className,
          right: e.getBoundingClientRect().right,
        })),
      }
    })
    console.log('LAYOUT', width, JSON.stringify(layout))
    assert(layout.player.left >= layout.git.right - 1)
    assert(
      layout.items.every((i) => i.right <= layout.clock.left + 1),
      'left bar must not overlap clock',
    )
    await shot(`layout-${width}`)
  }
  check('player remains right of Git and left of clock at 1440/1024/760px')
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await phase('playing')

  await page.getByLabel('朗读音色', { exact: true }).selectOption('58')
  await phase('playing')
  assert.equal((await snap()).voice, 58)
  check('voice switching cancels and regenerates current paragraph')
  await phase('ended')
  check('natural audio end reaches completed state')
  await page.context().setOffline(true)
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await phase('playing')
  check('new synthesis and playback succeed with browser network offline')
  await page.context().setOffline(false)
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await phase('stopped')
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await phase('playing')
  await page.reload()
  await page.waitForSelector('.main-window')
  await phase('stopped')
  check('renderer reload stops synthesis and never auto resumes')
  await shot('05-final-status')
  assert.deepEqual(errors, [])
  await writeFile(
    join(runDir, 'acceptance.json'),
    JSON.stringify(
      { checks, errors, model: (await snap()).resource, runAt: new Date().toISOString() },
      null,
      2,
    ),
  )
  console.log('EVIDENCE', runDir)
} catch (error) {
  console.error(error)
  if (page) {
    console.error('SNAPSHOT', JSON.stringify(await snap().catch(() => null)))
    await shot('failure').catch(() => {})
  }
  process.exitCode = 1
} finally {
  await browser?.close()
  web.close()
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
    await sleep(700)
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }
}
