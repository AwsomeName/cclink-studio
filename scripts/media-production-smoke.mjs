#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

process.env.CCLINK_STUDIO_SMOKE_RUN_DIR ??= `/tmp/cclink-media-workflow-${Date.now()}`
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= '39874'
const { rootDir, runDir, logFile, rendererOrigin } = createSmokeRuntime(import.meta.url)
const workspacePath = await mkdtemp(join(rootDir, '.tmp-media-smoke-'))
const sourcePath = join(workspacePath, 'launch.md')
let browser = null
let child

async function startApp() {
  await mkdir(join(runDir, 'user-data'), { recursive: true })
  await writeFile(
    join(runDir, 'user-data', 'settings.json'),
    JSON.stringify({
      lastWorkspacePath: workspacePath,
      recentWorkspacePaths: [workspacePath],
      componentSetupPageSeenVersion: 2,
    }),
  )
  await writeFile(
    join(runDir, 'user-data', 'workspace-state.json'),
    JSON.stringify({
      version: 2,
      workspaces: {},
      localWorkspaces: {
        fixture: {
          workspaceKey: workspacePath,
          workspacePath,
          ownerKey: null,
          updatedAt: Date.now(),
          storage: 'fallback',
          projectId: null,
        },
      },
    }),
  )
  const fd = openSync(logFile, 'w')
  child = spawn('bash', ['scripts/dev.sh'], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      CCLINK_STUDIO_TEST_USER_DATA_PATH: join(runDir, 'user-data'),
      CCLINK_STUDIO_RENDERER_PORT: process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT,
    },
    detached: true,
    stdio: ['ignore', fd, fd],
  })
  closeSync(fd)
}

async function stopApp() {
  if (!child) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    /* already exited */
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readLog() {
  return readFile(logFile, 'utf8').catch(() => '')
}

async function waitForCdpPort(previousLog, timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const completeLog = await readLog()
    const log =
      previousLog && completeLog.startsWith(previousLog)
        ? completeLog.slice(previousLog.length)
        : completeLog
    const match =
      log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//) ||
      log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)
    if (match) return match[1]
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('CDP port not found')
}

async function findRendererPage() {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 20_000) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith(`${rendererOrigin}/`))
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('renderer page not found')
}

try {
  await writeFile(
    sourcePath,
    '# CCLink Studio 新品发布\n\n更快地整理本地资料，生成可审计的宣发内容。\n\n所有本地能力免登录使用。\n',
  )
  const initialLog = await readLog()
  await startApp()
  const port = await waitForCdpPort(initialLog)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = await findRendererPage()
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForSelector('.main-window', { timeout: 30_000 })

  await page.waitForFunction(async () => {
    const { useFsStore } = await import('/src/stores/fs-store.ts')
    const state = useFsStore.getState()
    return !state.loading && !state.switchingPath
  })
  const opened = await page.evaluate(async (path) => {
    const { openWorkspaceRef } =
      await import('/src/features/workspace-open/workspace-open-controller.ts')
    return openWorkspaceRef({ kind: 'local', path })
  }, workspacePath)
  const workspaceError = await page.evaluate(
    async () => (await import('/src/stores/fs-store.ts')).useFsStore.getState().error,
  )
  assert(opened, `temporary workspace could not be opened: ${workspaceError}`)

  const project = await page.evaluate(
    async ({ workspacePath, sourcePath }) =>
      window.cclinkStudio.mediaProjects.create({
        workspacePath,
        sourcePath,
        platform: 'douyin',
        aspectRatio: '9:16',
        targetDurationSeconds: 30,
      }),
    { workspacePath, sourcePath },
  )
  assert(project.success, project.success ? '' : project.error.message)
  await page.evaluate(
    async ({ id, title, workspacePath }) => {
      const { useTabStore } = await import('/src/stores/tab-store.ts')
      useTabStore.getState().openTab({
        type: 'media-production',
        title,
        icon: '🎬',
        workspaceRef: { kind: 'local', path: workspacePath },
        mediaProject: { projectId: id },
      })
    },
    { id: project.project.id, title: project.project.title, workspacePath },
  )

  await page.locator('.video-creation-workspace').waitFor({ timeout: 15_000 })
  await page.evaluate(async () => {
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    useUIStore.getState().setAgentPanelMode('hidden')
  })
  await page.setViewportSize({ width: 1680, height: 1050 })
  const newStages = page.getByRole('navigation', { name: '视频制作阶段' })
  assert((await newStages.getByRole('button').count()) === 4, 'new four-page navigation missing')
  await page.getByLabel('第 1 段口播', { exact: true }).fill('如果有一天，还能与未来的自己对话呢？')
  await page.getByRole('button', { name: '添加段落' }).click()
  await page
    .getByLabel('第 2 段口播', { exact: true })
    .fill('用手机留下声音、面容和故事。这是关于记忆的一次实验。')
  await page.getByLabel('上移第 2 段').click()
  assert(
    (await page.getByLabel('第 1 段口播', { exact: true }).inputValue()).startsWith('用手机'),
    'paragraph reorder failed',
  )
  await page.getByLabel('下移第 1 段').click()
  await page.getByRole('button', { name: '添加段落' }).click()
  await page.getByLabel('删除第 3 段').click()
  await page.getByLabel('改写要求').fill('第一人称，自然克制，不夸大已经实现的能力。')
  await page.getByRole('button', { name: '确认口播并保存', exact: true }).click()
  await page.getByRole('button', { name: '再次确认并保存' }).waitFor()
  await page.getByRole('button', { name: 'AI 生成口播', exact: false }).click()
  await page.getByRole('dialog', { name: '确认口播生成' }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  const newFile = join(
    workspacePath,
    '.cclink-studio/media-projects',
    project.project.id,
    'project.json',
  )
  const narrationSaved = JSON.parse(await readFile(newFile, 'utf8'))
  assert(
    narrationSaved.narration.confirmedRevision === narrationSaved.narration.revision,
    'confirmed narration not saved',
  )
  assert(
    narrationSaved.scenes[0].narration === project.project.scenes[0].narration,
    'new narration mutated legacy scenes',
  )
  assert(
    (
      await readFile(
        join(
          workspacePath,
          '.cclink-studio/media-projects',
          project.project.id,
          'script/narration.md',
        ),
        'utf8',
      )
    ).includes('未来的自己'),
    'readable narration copy missing',
  )
  await page.reload()
  await page.getByRole('button', { name: '再次确认并保存' }).waitFor({ timeout: 20_000 })
  assert(
    (await page.getByLabel('第 1 段口播', { exact: true }).inputValue()).includes('未来的自己'),
    'narration did not restore',
  )

  // Test fixture only: seed an Agent-shaped persisted proposal; no real model call or billing.
  const proposalId = '11111111-1111-4111-8111-111111111111'
  narrationSaved.narration.proposal = {
    id: proposalId,
    baseNarrationRevision: narrationSaved.narration.revision,
    segments: [
      { id: '22222222-2222-4222-8222-222222222222', text: '把今天的声音和故事，留给未来的自己。' },
      { id: '33333333-3333-4333-8333-333333333333', text: '用手机开始记录，让记忆多一个入口。' },
    ],
    createdAt: Date.now(),
  }
  narrationSaved.narration.generation = {
    id: proposalId,
    status: 'succeeded',
    mode: 'generate',
    inputRevision: narrationSaved.narration.revision,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    error: null,
  }
  await writeFile(newFile, JSON.stringify(narrationSaved))
  await page.reload()
  await page.getByRole('button', { name: '采用这份口播' }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '采用这份口播' }).click()
  assert(
    (await page.getByLabel('第 1 段口播', { exact: true }).inputValue()).startsWith('把今天'),
    'proposal adoption failed',
  )
  await page.getByRole('button', { name: '确认口播并保存', exact: true }).click()
  await page.getByRole('button', { name: '再次确认并保存' }).waitFor()
  assert(
    await page.getByRole('button', { name: '采用这份口播' }).isDisabled(),
    'stale proposal should be disabled',
  )
  await page.locator('.vc-content').evaluate((el) => el.scrollTo({ top: 0 }))
  await page.evaluate(async () => {
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    useUIStore.getState().showPanel('video-creation')
  })
  await page.screenshot({ path: join(runDir, 'video-creation-01-script.png') })
  for (const [index, label] of ['分镜与素材', '声音与节奏', '预览与导出'].entries()) {
    await newStages.getByRole('button', { name: new RegExp(label) }).click()
    const skeleton = page.getByRole('region', { name: `${label}页面骨架` })
    assert(await skeleton.isVisible(), `missing skeleton: ${label}`)
    const buttons = skeleton.getByRole('button')
    for (let i = 0; i < (await buttons.count()); i++)
      assert(await buttons.nth(i).isDisabled(), 'skeleton business action must be disabled')
    await page.screenshot({ path: join(runDir, `video-creation-0${index + 2}.png`) })
  }
  await newStages.getByRole('button', { name: /稿件与口播/ }).click()
  await page.setViewportSize({ width: 960, height: 900 })
  assert(
    !(await page
      .locator('.video-creation-workspace')
      .evaluate((el) => el.scrollWidth > el.clientWidth + 2)),
    'narrow narration page overflow',
  )
  await page.screenshot({ path: join(runDir, 'video-creation-narrow.png') })
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.getByRole('button', { name: '旧版工作台', exact: true }).click()
  await page.locator('.media-production-workbench').waitFor({ timeout: 15_000 })
  const stages = page.getByRole('navigation', { name: '制作阶段' })
  assert((await stages.getByRole('button').count()) === 4, 'four workflow stages missing')
  await page.getByLabel('第 1 段口播', { exact: true }).fill('用一篇稿件，讲清楚产品的故事。')
  await page.getByLabel('第 1 段字幕', { exact: true }).fill('用一篇稿件，讲清楚产品的故事')
  await stages.getByRole('button', { name: /分镜与素材/ }).click()
  assert((await page.locator('.media-scene-list > button').count()) >= 4, 'scene list missing')
  assert(
    await page.getByRole('button', { name: 'AI 生成分镜' }).isVisible(),
    'Agent proposal action missing',
  )
  assert(
    await page.getByRole('button', { name: '导入本地图片或视频' }).isVisible(),
    'local footage import missing',
  )
  await page.getByRole('button', { name: 'AI 生成', exact: true }).click()
  assert(
    await page.getByRole('button', { name: '生成图片' }).isVisible(),
    'image generation action missing',
  )
  assert(
    await page.getByRole('button', { name: '生成视频' }).isVisible(),
    'video generation action missing',
  )
  await stages.getByRole('button', { name: /声音/ }).click()
  assert(
    await page.getByRole('button', { name: '导入旁白音频' }).isVisible(),
    'narration import missing',
  )
  assert(
    await page.getByRole('button', { name: '导入背景音乐' }).isVisible(),
    'music import missing',
  )
  // Exercise the real asset service; the native file picker is outside CDP.
  const audioPath = join(workspacePath, 'voice.wav')
  const sampleRate = 8000
  const wav = Buffer.alloc(44 + sampleRate * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(wav.length - 44, 40)
  await writeFile(audioPath, wav)
  const imported = await page.evaluate(
    async ({ workspacePath, projectId, sourcePath }) => {
      const result = await window.cclinkStudio.mediaProjects.importAsset({
        workspacePath,
        projectId,
        sourcePath,
      })
      return result
    },
    { workspacePath, projectId: project.project.id, sourcePath: audioPath },
  )
  assert(imported.success, 'real audio asset import failed')
  // Add the imported asset to the persisted draft, then reopen using the existing tab store.
  await page.getByRole('button', { name: '保存工程' }).click()
  await page.getByRole('button', { name: '已保存' }).waitFor()
  const seeded = await page.evaluate(
    async ({ workspacePath, projectId, asset }) => {
      const loaded = await window.cclinkStudio.mediaProjects.get(workspacePath, projectId)
      if (!loaded.success) return loaded
      loaded.project.assets.push(asset)
      return window.cclinkStudio.mediaProjects.save({
        workspacePath,
        expectedRevision: loaded.project.revision,
        project: loaded.project,
      })
    },
    { workspacePath, projectId: project.project.id, asset: imported.asset },
  )
  assert(seeded.success, 'audio fixture persistence failed')
  await page.reload()
  await page.getByRole('button', { name: '旧版工作台', exact: true }).click()
  await page.locator('.media-production-workbench').waitFor({ timeout: 20_000 })
  await stages.getByRole('button', { name: /声音/ }).click()
  await page.getByLabel('旁白音频', { exact: true }).selectOption(imported.asset.id)
  await page.getByLabel('背景音乐', { exact: true }).selectOption(imported.asset.id)
  await page.getByLabel('背景音量').press('Home')
  for (let index = 0; index < 12; index++) await page.getByLabel('背景音量').press('ArrowRight')
  await stages.getByRole('button', { name: /预览与导出/ }).click()
  assert(await page.getByLabel('品牌 Logo').isVisible(), 'Logo setting missing')
  assert(
    await page
      .getByLabel(/背景音乐/)
      .first()
      .isVisible(),
    'music setting missing',
  )

  const exportButton = page.getByRole('button', { name: '导出成片' })
  const runtime = await page.evaluate(() => window.cclinkStudio.mediaRender.getRuntimeStatus())
  assert(runtime.success, 'runtime status unavailable')
  assert(
    (await exportButton.isDisabled()) === !runtime.runtime.available,
    'export does not match real runtime availability',
  )
  if (!runtime.runtime.available) {
    const exportReason = await exportButton.getAttribute('title')
    assert(exportReason?.includes('FFmpeg'), 'export degradation reason is not visible')
  }

  await page.getByLabel('结尾 CTA').fill('现在就试试')
  await page.getByRole('button', { name: '保存工程' }).click()
  await page.getByRole('button', { name: '已保存' }).waitFor({ timeout: 10_000 })
  const persisted = await page.evaluate(
    ({ workspacePath, projectId }) =>
      window.cclinkStudio.mediaProjects.get(workspacePath, projectId),
    { workspacePath, projectId: project.project.id },
  )
  assert(
    persisted.success && persisted.project.brief.brand.callToAction === '现在就试试',
    'saved media project did not persist',
  )
  assert(
    persisted.project.scenes[0].narration === '用一篇稿件，讲清楚产品的故事。',
    'script did not persist',
  )
  assert(
    persisted.project.renderSettings.narrationAssetId === imported.asset.id,
    'narration did not persist',
  )
  assert(persisted.project.renderSettings.musicVolume === 0.12, 'music volume did not persist')
  assert(
    persisted.project.narration.segments[0].text.startsWith('把今天'),
    'legacy edits overwrote independent narration',
  )
  await stages.getByRole('button', { name: /分镜与素材/ }).click()
  await page.screenshot({ path: join(runDir, 'media-workflow-scenes.png') })
  await stages.getByRole('button', { name: /声音/ }).click()
  await page.screenshot({ path: join(runDir, 'media-workflow-audio.png') })
  const overflow = await page
    .locator('.media-production-workbench')
    .evaluate((el) => el.scrollWidth > el.clientWidth + 2)
  assert(!overflow, 'workflow overflows its pane')
  console.log(
    `Media workflow smoke passed: independent narration edit/reorder/delete/confirm/reopen, persisted candidate fixture adoption/staleness, 3 disabled skeleton pages, responsive screenshots, and legacy media regression. No live model call. Screenshots: ${runDir}`,
  )
} catch (error) {
  const failedPage = browser
    ?.contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith(rendererOrigin))
  if (failedPage) {
    await failedPage
      .screenshot({ path: join(runDir, 'media-workflow-failed.png') })
      .catch(() => undefined)
    console.error(
      await failedPage
        .locator('.media-production-workbench')
        .innerText()
        .catch(() => 'No workbench'),
    )
  }
  console.error(`Smoke evidence: ${runDir}`)
  throw error
} finally {
  await browser?.close().catch(() => undefined)
  await stopApp()
  await rm(workspacePath, { recursive: true, force: true })
}
