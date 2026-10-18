#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

// Use an isolated App profile; never restart the user's running Studio instance.
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR = await mkdtemp(
  join(tmpdir(), 'studio-message-images-smoke-'),
)
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= String(42000 + Math.floor(Math.random() * 1500))
const { runDir, logFile, rendererOrigin, rootDir } = createSmokeRuntime(import.meta.url)
const workspace = await mkdtemp(join(homedir(), '.cclink-studio-message-images-smoke-'))
const userData = join(runDir, 'user-data')
await mkdir(userData)
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    lastWorkspacePath: workspace,
    recentWorkspacePaths: [workspace],
  }),
)
await writeFile(
  join(userData, 'workspace-state.json'),
  JSON.stringify({
    version: 2,
    workspaces: {},
    localWorkspaces: {
      'message-image-smoke': {
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
let browser
let runtimeChild

function startRuntime() {
  const fd = openSync(logFile, 'w')
  try {
    runtimeChild = spawn('bash', ['scripts/dev.sh'], {
      cwd: rootDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
        CCLINK_STUDIO_TEST_USER_DATA_PATH: userData,
        CCLINK_STUDIO_RENDERER_PORT: new URL(rendererOrigin).port,
        CLAUDE_CONFIG_DIR: join(runDir, 'claude-config'),
      },
      detached: true,
      stdio: ['ignore', fd, fd],
    })
  } finally {
    closeSync(fd)
  }
}

async function stopRuntime() {
  if (!runtimeChild) return
  // Only stop this smoke's process group; restart.sh can reuse/stop the user's Studio.
  const pid = runtimeChild.pid
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // The isolated runtime already exited.
  }
  runtimeChild = null
}

function assert(value, message) {
  if (!value) throw new Error(message)
}
async function connect() {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const log = await readFile(logFile, 'utf8').catch(() => '')
    const match = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
    if (match) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${match[1]}`)
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith(rendererOrigin))
      if (page) {
        await page.waitForSelector('.main-window', { timeout: 30000 })
        return page
      }
      await browser.close()
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('Isolated Studio renderer did not become ready')
}

async function setPanelMode(page, mode) {
  await page.evaluate(async (mode) => {
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    useUIStore.getState().setAgentPanelMode(mode, 'user')
  }, mode)
}

async function inspectLayout(page) {
  return page
    .locator('.agent-message.user.has-images')
    .last()
    .evaluate((message) => {
      const images = message.querySelector('.message-image-list')
      const body = message.querySelector('.agent-message-body')
      const imageBox = images.getBoundingClientRect()
      const bodyBox = body.getBoundingClientRect()
      const list = message.closest('.agent-messages')
      return {
        imageBeforeText: imageBox.bottom <= bodyBox.top,
        noHorizontalOverflow: list.scrollWidth <= list.clientWidth,
        imageCount: images.children.length,
        columns: getComputedStyle(images).gridTemplateColumns,
        transparentFrame: getComputedStyle(message).backgroundColor === 'rgba(0, 0, 0, 0)',
        imageWidth: imageBox.width,
        messageWidth: message.getBoundingClientRect().width,
      }
    })
}

async function sendDraft(page, conversationId) {
  // Stub paid inference only; attachment save/read and persistence use real main IPC.
  await page.evaluate(async (id) => {
    const [{ createConversationRunController }, { useAgentStore }] = await Promise.all([
      import('/src/features/agent-conversations/conversation-run-controller.ts'),
      import('/src/stores/agent-store.ts'),
    ])
    const result = await createConversationRunController({
      conversationId: id,
      agentApi: {
        ...window.cclinkStudio.agent,
        sendMessage: async (conversationId, payload) => ({
          success: true,
          configurationReceipt: {
            conversationId,
            runId: payload.runId,
            roleRef: payload.configuration.roleRef,
            configurationRevision: payload.configuration.revision,
            configurationFingerprint: null,
            runtimeSessionMode: 'new',
            skills: [],
          },
        }),
      },
    }).send(useAgentStore.getState().conversations[id].input)
    if (result.status !== 'accepted')
      throw new Error(`Image turn rejected: ${JSON.stringify(result)}`)
    useAgentStore.getState().finishStreamingMessage(id, result.runId)
    if (useAgentStore.getState().conversations[id].pendingImages.length)
      throw new Error('Accepted turn left pending image bytes in the composer')
  }, conversationId)
}

async function showConversation(page, conversationId) {
  await page.evaluate(async (id) => {
    const [{ useAgentStore }, { useUIStore }] = await Promise.all([
      import('/src/stores/agent-store.ts'),
      import('/src/stores/ui-store.ts'),
    ])
    useAgentStore.getState().switchConversation(id)
    useUIStore.getState().setAgentPanelMode('right', 'user')
  }, conversationId)
}

async function inspectImage(page) {
  const image = page.locator('.agent-message.user .message-image-preview').first()
  await image.waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForFunction(
    () => {
      const image = document.querySelector('.agent-message.user .message-image-preview')
      return image?.complete && image.naturalWidth === 480 && image.naturalHeight === 240
    },
    undefined,
    { timeout: 15000 },
  )
  return image.evaluate((image) => {
    const box = image.getBoundingClientRect()
    return {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      width: box.width,
      height: box.height,
    }
  })
}

try {
  startRuntime()
  let page = await connect()
  await page.evaluate(async (path) => {
    const { openWorkspaceRef } =
      await import('/src/features/workspace-open/workspace-open-controller.ts')
    await openWorkspaceRef({ kind: 'local', path })
  }, workspace)
  const conversationId = await page.evaluate(async () => {
    const [{ useAgentStore }, { useWorkspaceStore }] = await Promise.all([
      import('/src/stores/agent-store.ts'),
      import('/src/stores/workspace-store.ts'),
    ])
    return useAgentStore.getState().createConversation({
      id: 'local-image-smoke',
      activate: true,
      runtime: {
        location: 'local',
        transport: 'local',
        backend: 'cclink-studio-agent',
        workspaceRef: useWorkspaceStore.getState().activeWorkspaceRef,
      },
    })
  })
  await showConversation(page, conversationId)
  const composer = page.locator('[data-agent-panel-runtime="local"] textarea').first()
  await composer.waitFor({ state: 'visible' })
  await composer.evaluate(async (element) => {
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 240
    const context = canvas.getContext('2d')
    context.fillStyle = '#163449'
    context.fillRect(0, 0, 480, 240)
    context.fillStyle = '#38bdf8'
    context.fillRect(24, 24, 432, 80)
    context.fillStyle = '#ffffff'
    context.font = '24px sans-serif'
    context.fillText('LOCAL IMAGE PREVIEW', 55, 160)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const data = new DataTransfer()
    data.items.add(new File([blob], 'local-preview.png', { type: 'image/png' }))
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  })
  await page.locator('.agent-image-attachment img').waitFor({ state: 'visible' })
  await composer.fill('确认一下这个事情')
  await page.screenshot({ path: join(runDir, 'composer.png') })
  await sendDraft(page, conversationId)
  const initial = await inspectImage(page)
  const narrow = await inspectLayout(page)
  assert(narrow.imageBeforeText && narrow.transparentFrame, 'Image is still inside the text bubble')
  assert(narrow.noHorizontalOverflow, 'Narrow conversation overflows horizontally')
  await setPanelMode(page, 'center')
  await page.waitForFunction(() => document.querySelector('.agent-panel-center'))
  await inspectImage(page)
  const wide = await inspectLayout(page)
  const wideImage = await inspectImage(page)
  assert(wide.imageBeforeText && wide.noHorizontalOverflow, 'Center image layout is invalid')
  assert(wideImage.width > 320, 'Center image is still limited to the old thumbnail size')
  const persisted = await page.evaluate(async (id) => {
    const {
      useAgentStore,
      buildAgentConversationWorkspaceSnapshot,
      flushAgentConversationWorkspaceState,
    } = await import('/src/stores/agent-store.ts')
    const state = useAgentStore.getState()
    const resources = state.conversations[id].messages.find(
      (message) => message.role === 'user',
    ).resources
    if (!resources[0].ref.imageAssetId) throw new Error('Saved attachment reference is missing')
    state.clearTransientResources(id)
    await flushAgentConversationWorkspaceState()
    const snapshot = buildAgentConversationWorkspaceSnapshot(
      useAgentStore.getState(),
      state.conversations[id].runtime.workspaceRef.path,
    )
    if (JSON.stringify(snapshot).includes('data:image/'))
      throw new Error('Image bytes entered workspace snapshot')
    return { assetId: resources[0].ref.imageAssetId, snapshot }
  }, conversationId)
  await inspectImage(page)
  await page.screenshot({ path: join(runDir, 'sent.png') })
  await page
    .locator('.agent-message.user.has-images')
    .first()
    .screenshot({
      path: join(runDir, 'single-dark.png'),
    })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page
    .locator('.agent-message.user.has-images')
    .first()
    .screenshot({
      path: join(runDir, 'single-light.png'),
    })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))

  await browser.close()
  await stopRuntime()
  startRuntime()
  page = await connect()
  await page.evaluate(async (path) => {
    const { openWorkspaceRef } =
      await import('/src/features/workspace-open/workspace-open-controller.ts')
    await openWorkspaceRef({ kind: 'local', path })
  }, workspace)
  await showConversation(page, conversationId)
  const restored = await inspectImage(page)
  await page.screenshot({ path: join(runDir, 'restored.png') })
  const restoredResource = await page.evaluate(async (id) => {
    const { useAgentStore } = await import('/src/stores/agent-store.ts')
    return useAgentStore
      .getState()
      .conversations[id].messages.find((message) => message.role === 'user').resources[0]
  }, conversationId)
  assert(!restoredResource.previewDataUrl, 'Transient image bytes survived restart')
  assert(
    restoredResource.ref.imageAssetId === persisted.assetId,
    'Restart lost the stable image reference',
  )
  await setPanelMode(page, 'center')
  const multiComposer = page.locator('[data-agent-panel-runtime="local"] textarea').first()
  await multiComposer.evaluate(async (element) => {
    const data = new DataTransfer()
    for (const [index, [width, height]] of [
      [1200, 720],
      [240, 960],
      [1600, 180],
    ].entries()) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      context.fillStyle = ['#234254', '#34473d', '#594b38'][index]
      context.fillRect(0, 0, width, height)
      context.fillStyle = '#fff'
      context.font = '36px sans-serif'
      context.fillText(`IMAGE ${index + 1}`, 24, 64)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      data.items.add(new File([blob], `image-${index + 1}.png`, { type: 'image/png' }))
    }
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  })
  await page.waitForFunction(
    () => document.querySelectorAll('.agent-image-attachment').length === 3,
  )
  await page.locator('.agent-image-attachment button').last().click()
  assert((await page.locator('.agent-image-attachment').count()) === 2, 'Remove attachment failed')
  await page.screenshot({ path: join(runDir, 'multi-composer.png') })
  await multiComposer.fill('横图和长图应该完整显示，文字放在图片下方。')
  await sendDraft(page, conversationId)
  await page.waitForFunction(() => {
    const messages = document.querySelectorAll('.agent-message.user.has-images')
    const images = messages[messages.length - 1]?.querySelectorAll('img')
    return (
      images?.length === 2 && [...images].every((image) => image.complete && image.naturalWidth)
    )
  })
  const multi = await inspectLayout(page)
  assert(
    multi.imageCount === 2 && multi.imageBeforeText && multi.noHorizontalOverflow,
    'Multi-image layout failed',
  )
  await page.screenshot({ path: join(runDir, 'multi-dark.png') })
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.screenshot({ path: join(runDir, 'multi-light.png') })
  await setPanelMode(page, 'right')
  await page.waitForFunction(() => !document.querySelector('.agent-panel-center'))
  const multiNarrow = await inspectLayout(page)
  assert(multiNarrow.noHorizontalOverflow, 'Narrow multi-image conversation overflows')
  await page.screenshot({ path: join(runDir, 'multi-narrow.png') })
  await page.evaluate(async (id) => {
    const { useAgentStore } = await import('/src/stores/agent-store.ts')
    useAgentStore.getState().addUserMessage('', id, [
      {
        id: 'missing-image',
        kind: 'image',
        label: 'missing.png',
        ref: { type: 'image', mediaType: 'image/png', size: 3 },
      },
    ])
  }, conversationId)
  const unavailable = page.locator('.agent-message.user.has-images').last()
  await unavailable
    .getByRole('status')
    .getByText('图片不可用：missing.png', { exact: true })
    .waitFor()
  const emptyBody = await unavailable.locator('.agent-message-body').evaluate((body) => ({
    height: body.getBoundingClientRect().height,
    background: getComputedStyle(body).backgroundColor,
  }))
  assert(emptyBody.height === 0, 'Image-only message renders an empty text bubble')
  assert(
    emptyBody.background === 'rgba(0, 0, 0, 0)',
    'Image-only message keeps a bubble background',
  )
  const result = {
    initial,
    restored,
    narrow,
    wide,
    wideImage,
    multi,
    multiNarrow,
    assetId: persisted.assetId,
    runtimeWasStubbed: true,
    runDir,
  }
  await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close().catch(() => undefined)
  await stopRuntime()
}
