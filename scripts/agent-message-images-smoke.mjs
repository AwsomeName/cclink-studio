#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

// Use an isolated App profile; never restart the user's running Studio instance.
process.env.CCLINK_STUDIO_SMOKE_RUN_DIR = await mkdtemp(
  join(tmpdir(), 'studio-message-images-smoke-'),
)
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= String(42000 + Math.floor(Math.random() * 1500))
const { runDir, logFile, rendererOrigin, runRestart } = createSmokeRuntime(import.meta.url)
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

function assert(value, message) {
  if (!value) throw new Error(message)
}
async function connect(previousLog = '') {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    const completeLog = await readFile(logFile, 'utf8').catch(() => '')
    const log =
      previousLog && completeLog.startsWith(previousLog)
        ? completeLog.slice(previousLog.length)
        : completeLog
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
  runRestart('start')
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
  // Keep this UI/IPC smoke independent of paid inference. Attachment save/read uses real main IPC.
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
  const initial = await inspectImage(page)
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

  const previousLog = await readFile(logFile, 'utf8')
  await browser.close()
  runRestart('restart')
  page = await connect(previousLog)
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
  const result = { initial, restored, assetId: persisted.assetId, runtimeWasStubbed: true, runDir }
  await writeFile(join(runDir, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close().catch(() => undefined)
  runRestart('stop')
}
