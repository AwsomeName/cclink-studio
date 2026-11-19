#!/usr/bin/env node
// Run the actual packaged app, without Vite imports or repository module resolution.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const app = resolve(process.argv[2] ?? 'dist/mac-arm64/CCLink Studio 开源版.app')
const runDir = await realpath(await mkdtemp(join(tmpdir(), 'cclink-tts-packaged-')))
const userData = join(runDir, 'profile')
const fixtureRoot = join(homedir(), '.cache', 'cclink-tts-packaged-smoke')
await mkdir(fixtureRoot, { recursive: true })
const workspace = await mkdtemp(join(fixtureRoot, 'workspace-'))
await mkdir(userData, { recursive: true })
const projectId = `tts-packaged-${Date.now()}`
await mkdir(join(workspace, '.cclink-studio'))
await writeFile(
  join(workspace, '.cclink-studio/project.json'),
  JSON.stringify({
    version: 1,
    projectId,
    createdAt: Date.now(),
  }),
)
await writeFile(
  join(workspace, '朗读安装包验收.md'),
  '# 安装包朗读验收\n\n这是独立安装包中的真实中文语音，测试 English 和数字 2026。\n',
)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
    componentSetupPageSeenVersion: 2,
  }),
)
await writeFile(
  join(userData, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    fixedSpaces: {
      version: 1,
      personal: { workspacePath: workspace, projectId },
      company: null,
      legacyDefaultPath: '',
    },
    localWorkspaces: {
      fixture: {
        workspaceKey: workspace,
        workspacePath: workspace,
        ownerKey: null,
        updatedAt: Date.now(),
        storage: 'fallback',
        projectId,
      },
    },
  }),
)
// Optional reuse copies an existing verified install, including its integrity record.
// With no override, exercise the app's real installer instead.
if (process.env.CCLINK_TTS_MODEL_INSTALL) {
  const target = join(userData, 'runtime-components', 'kokoro-tts-model', '1.1-zh')
  await mkdir(target, { recursive: true })
  await cp(resolve(process.env.CCLINK_TTS_MODEL_INSTALL), target, { recursive: true })
}
const log = await open(join(runDir, 'app.log'), 'w', 0o600)
const child = spawn(join(app, 'Contents/MacOS/CCLink Studio 开源版'), [], {
  cwd: runDir,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '',
    NODE_PATH: '',
    CCLINK_STUDIO_PACKAGED_SMOKE: '1',
    CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
  },
  stdio: ['ignore', log.fd, log.fd],
})
const exited = new Promise((r) => child.once('exit', r))
let browser, page
async function waitFor(fn, label, timeout = 90_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, `App exited while waiting for ${label}`)
    const result = await fn()
    if (result) return result
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Timeout: ${label}`)
}
console.log(`Packaged TTS evidence: ${runDir}`)
try {
  const port = await waitFor(async () => {
    const value = await readFile(join(userData, 'DevToolsActivePort'), 'utf8').catch(() => '')
    return value.split('\n')[0]
  }, 'CDP')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page = await waitFor(async () => {
    for (const candidate of browser.contexts().flatMap((c) => c.pages())) {
      if (await candidate.locator('.main-window').count()) return candidate
    }
  }, 'workbench')
  assert(page.url().startsWith('file://'), 'Must exercise bundled renderer, never dev server')
  const snap = () => page.evaluate(() => window.cclinkStudio.localTts.getSnapshot())
  // Select only the registered temporary fixture; never the machine's real default space.
  await page.locator(`.project-strip-item[data-project-path=${JSON.stringify(workspace)}]`).click()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.locator('.file-tree-item.file').filter({ hasText: '朗读安装包验收.md' }).click()
  await page.locator('.tiptap[contenteditable=true]').waitFor()
  // The previous release exposed the document button; current UX uses the bottom player.
  const oldButton = page.locator('.editor-toolbar .tts-source-button').first()
  if (await oldButton.count()) await oldButton.click()
  else {
    await page.getByLabel('展开本地朗读播放器').click()
    await page.getByRole('button', { name: '朗读当前内容', exact: true }).click()
  }
  if ((await snap()).resource?.health !== 'healthy') {
    if (!(await page.getByRole('button', { name: '下载并安装', exact: true }).isVisible()))
      await page.getByLabel('展开本地朗读播放器').click()
    await page.getByRole('button', { name: '下载并安装', exact: true }).click()
    await waitFor(
      async () => {
        const s = await snap()
        assert.notEqual(s.resource?.phase, 'failed', JSON.stringify(s.resource?.failure))
        return s.resource?.health === 'healthy'
      },
      'model installation',
      600_000,
    )
    await page.getByRole('button', { name: '播放', exact: true }).click()
  }
  const playing = await waitFor(async () => {
    const s = await snap()
    assert.notEqual(s.phase, 'failed', JSON.stringify(s.error))
    return s.phase === 'playing' && s
  }, 'real HTMLAudio playing event')
  assert.equal(playing.resource.health, 'healthy')
  const clip = await page.evaluate(
    (key) => window.cclinkStudio.localTts.audio(key),
    playing.audioKey,
  )
  const wav = Buffer.from(clip.base64, 'base64')
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert(clip.duration > 0 && wav.length > 44)
  assert(
    wav.subarray(44).some((byte) => byte !== 0),
    'Synthesized PCM must not be silent',
  )
  await writeFile(join(runDir, 'speech.wav'), wav)
  await page.screenshot({ path: join(runDir, 'playing.png') })
  await waitFor(async () => {
    const s = await snap()
    assert.notEqual(s.phase, 'failed', JSON.stringify(s.error))
    return s.phase === 'ended'
  }, 'natural playback completion')
  await writeFile(
    join(runDir, 'result.json'),
    JSON.stringify(
      {
        app,
        platform: process.platform,
        arch: process.arch,
        renderer: 'file://',
        modelHealth: playing.resource.health,
        segmentCount: playing.segments.length,
        firstClipDuration: clip.duration,
        firstClipBytes: wav.length,
        phase: 'ended',
      },
      null,
      2,
    ),
  )
  console.log('PASS packaged document → native synthesis → real audio playing → ended')
} catch (error) {
  if (page) await page.screenshot({ path: join(runDir, 'failed.png') }).catch(() => {})
  throw error
} finally {
  await browser?.close().catch(() => {})
  child.kill('SIGTERM')
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))])
  if (child.exitCode === null) child.kill('SIGKILL')
  await log.close()
}
