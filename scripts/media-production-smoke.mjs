#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

const { rootDir, logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
const workspacePath = await mkdtemp(join(rootDir, '.tmp-media-smoke-'))
const sourcePath = join(workspacePath, 'launch.md')
let browser = null
let started = false

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
    const log = previousLog && completeLog.startsWith(previousLog)
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
  runRestart('restart')
  started = true
  const port = await waitForCdpPort(initialLog)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = await findRendererPage()
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.waitForSelector('.main-window', { timeout: 30_000 })

  const opened = await page.evaluate(async (path) => {
    const { useFsStore } = await import('/src/stores/fs-store.ts')
    return useFsStore.getState().openRecentWorkspace(path)
  }, workspacePath)
  assert(opened, 'temporary workspace could not be opened')

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
  await page.evaluate(async ({ id, title, workspacePath }) => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    useTabStore.getState().openTab({
      type: 'media-production',
      title,
      icon: '🎬',
      workspaceRef: { kind: 'local', path: workspacePath },
      mediaProject: { projectId: id },
    })
  }, { id: project.project.id, title: project.project.title, workspacePath })

  await page.locator('.media-production-workbench').waitFor({ timeout: 15_000 })
  assert((await page.locator('.media-scene-list > button').count()) >= 4, 'scene list missing')
  assert(await page.getByRole('button', { name: 'AI 生成分镜' }).isVisible(), 'Agent proposal action missing')
  assert(await page.getByRole('button', { name: '生成图片' }).isVisible(), 'image generation action missing')
  assert(await page.getByRole('button', { name: '生成视频' }).isVisible(), 'video generation action missing')
  assert(await page.getByLabel('品牌 Logo').isVisible(), 'Logo setting missing')
  assert(await page.getByLabel(/背景音乐/).first().isVisible(), 'music setting missing')

  const exportButton = page.getByRole('button', { name: '导出成片' })
  assert(await exportButton.isDisabled(), 'export should degrade when FFmpeg is unavailable')
  const exportReason = await exportButton.getAttribute('title')
  assert(exportReason?.includes('FFmpeg'), 'export degradation reason is not visible')

  await page.getByLabel('结尾 CTA').fill('现在就试试')
  await page.getByRole('button', { name: '保存工程' }).click()
  await page.getByRole('button', { name: '已保存' }).waitFor({ timeout: 10_000 })
  const persisted = await page.evaluate(
    ({ workspacePath, projectId }) => window.cclinkStudio.mediaProjects.get(workspacePath, projectId),
    { workspacePath, projectId: project.project.id },
  )
  assert(
    persisted.success && persisted.project.brief.brand.callToAction === '现在就试试',
    'saved media project did not persist',
  )
  console.log(
    'Media production smoke passed: project creation, native workbench, generation controls, render settings, persistence, and no-FFmpeg degradation.',
  )
} finally {
  await browser?.close().catch(() => undefined)
  if (started) {
    try {
      runRestart('stop')
    } catch {
      // Best-effort smoke cleanup.
    }
  }
  await rm(workspacePath, { recursive: true, force: true })
}
