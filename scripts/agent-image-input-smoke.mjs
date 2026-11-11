#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

// Real production renderer, worker, IPC, asset store and Claude CLI. The model API is a
// loopback fixture: this proves transport/UX, not a real model's visual understanding.
const runDir = await mkdtemp(join(tmpdir(), 'studio-agent-images-'))
const requests = []
const results = []
let apiMode = 'ok'
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!req.url?.startsWith('/v1/messages')) return res.writeHead(404).end()
  const body = JSON.parse(Buffer.concat(chunks).toString())
  const images = body.messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content.filter((block) => block.type === 'image') : [],
  )
  requests.push(
    images.map((image) => ({
      bytes: Buffer.from(image.source.data ?? '', 'base64').length,
      mediaType: image.source.media_type,
      sha256: createHash('sha256')
        .update(Buffer.from(image.source.data ?? '', 'base64'))
        .digest('hex'),
    })),
  )
  if (apiMode === 'fail')
    return res.writeHead(400, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'IMAGE_SMOKE_REJECTED' },
      }),
    )
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  event('message_start', {
    message: {
      id: `msg_images_${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  })
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  event('content_block_delta', {
    index: 0,
    delta: { type: 'text_delta', text: `IMAGE_SMOKE_RECEIVED_${images.length}` },
  })
  event('content_block_stop', { index: 0 })
  event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })
  event('message_stop', {})
  res.end()
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
let app
let page
const pass = (name, detail) => {
  results.push({ name, detail })
  console.log(`PASS ${name}`, detail ?? '')
}
try {
  const env = { ...process.env, CCLINK_STUDIO_TEST_USER_DATA_PATH: join(runDir, 'user-data') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  app = await electron.launch({ args: [resolve('.')], env })
  page = await app.firstWindow()
  await page.waitForSelector('.main-window', { timeout: 30_000 })
  const toggle = page.locator('.app-topbar-right .app-topbar-icon')
  if ((await toggle.getAttribute('title')) === '展开 Agent 面板') await toggle.click()
  const panel = page.locator('[data-agent-panel-runtime="local"]')
  await panel.waitFor({ state: 'visible' })
  const input = panel.locator('textarea.agent-input, textarea.agent-start-input')
  const files = panel.locator('input[type="file"][accept*="image/png"]')
  const send = panel.locator('[data-agent-action="send"]')
  const thumbnails = panel.locator('.agent-image-attachment img')
  const clear = async () => {
    while (await panel.locator('.agent-image-remove').count())
      await panel.locator('.agent-image-remove').first().click()
  }
  const ready = async (count) => {
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('.agent-image-attachment img').length === count &&
        !document.querySelector('.agent-image-preparation'),
      count,
      { timeout: 60_000 },
    )
  }
  const makePng = async (width, height, noise = false) =>
    Buffer.from(
      await page.evaluate(
        async ({ width, height, noise }) => {
          const canvas = new OffscreenCanvas(width, height)
          const context = canvas.getContext('2d')
          if (noise) {
            const pixels = context.createImageData(width, height)
            let seed = 7
            for (let i = 0; i < pixels.data.length; i += 4) {
              seed ^= seed << 13
              seed ^= seed >>> 17
              seed ^= seed << 5
              pixels.data[i] = seed & 255
              pixels.data[i + 1] = (seed >>> 8) & 255
              pixels.data[i + 2] = (seed >>> 16) & 255
              pixels.data[i + 3] = 255
            }
            context.putImageData(pixels, 0, 0)
            context.fillStyle = '#fff'
            context.fillRect(0, 0, width, 180)
          }
          context.fillStyle = '#173b77'
          context.font = '36px sans-serif'
          context.fillText('CCLink image test 12345 中文截图', 24, 70)
          const blob = await canvas.convertToBlob({ type: 'image/png' })
          return await new Promise((done) => {
            const reader = new FileReader()
            reader.onload = () => done(reader.result.split(',')[1])
            reader.readAsDataURL(blob)
          })
        },
        { width, height, noise },
      ),
      'base64',
    )

  const small = await makePng(800, 300)
  await files.setInputFiles({ name: 'transparent.png', mimeType: 'image/png', buffer: small })
  await ready(1)
  assert.equal(
    await thumbnails.first().getAttribute('src'),
    `data:image/png;base64,${small.toString('base64')}`,
  )
  pass('small transparent PNG is unchanged')
  await clear()

  const noisy = await makePng(3000, 1600, true)
  assert.ok(noisy.length > 5 * 1024 * 1024 && noisy.length < 20 * 1024 * 1024)
  const boundary = Buffer.concat([noisy, Buffer.alloc(20 * 1024 * 1024 - noisy.length)])
  await files.setInputFiles({ name: '20MB.png', mimeType: 'image/png', buffer: boundary })
  await ready(1)
  const prepared = await thumbnails.first().getAttribute('src')
  const preparedBytes = Buffer.from(prepared.split(',')[1], 'base64').length
  assert.ok(preparedBytes <= 3 * 1024 * 1024)
  await panel.getByRole('button', { name: '预览发送图片 20MB.png', exact: true }).click()
  await page.getByRole('dialog').getByText('实际发送图片').waitFor()
  await page.screenshot({ path: join(runDir, '20mb-preview.png'), fullPage: true })
  await page.getByRole('button', { name: '关闭图片预览' }).click()
  pass('20MB original is compressed and previewable', {
    originalBytes: boundary.length,
    preparedBytes,
  })
  await clear()

  await files.setInputFiles({
    name: 'too-large.png',
    mimeType: 'image/png',
    buffer: Buffer.concat([boundary, Buffer.of(0)]),
  })
  await panel.getByRole('alert').filter({ hasText: '20MB' }).waitFor()
  await input.fill('保留草稿')
  assert.equal(await send.isDisabled(), true)
  await panel.getByRole('button', { name: '保留已添加图片' }).click()
  assert.equal(await input.inputValue(), '保留草稿')
  pass('over-limit input is rejected without losing text')

  const long = await makePng(800, 12000)
  await files.setInputFiles({ name: 'long.png', mimeType: 'image/png', buffer: long })
  await ready(1)
  assert.equal(await send.isDisabled(), true)
  await panel.getByRole('button', { name: '预览发送图片 long.png', exact: true }).click()
  await page.getByRole('button', { name: '查看原尺寸' }).click()
  await page.getByRole('button', { name: '已检查，使用此图' }).click()
  assert.equal(await send.isDisabled(), false)
  pass('long screenshot requires checking actual sending pixels')
  await clear()

  await files.setInputFiles({
    name: 'corrupt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  })
  await panel.getByRole('alert').waitFor()
  assert.equal(await send.isDisabled(), true)
  await panel.getByRole('button', { name: '保留已添加图片' }).click()
  pass('corrupt image remains a visible blocking error')

  const paths = Array.from({ length: 5 }, (_, i) => join(runDir, `image-${i}.png`))
  await Promise.all(paths.map((path) => writeFile(path, noisy)))
  await files.setInputFiles(paths)
  await panel.getByRole('button', { name: '取消处理' }).click()
  await page.waitForTimeout(300)
  assert.equal(await thumbnails.count(), 0)
  assert.equal(await input.inputValue(), '保留草稿')
  pass('cancelling preparation terminates work without late attachments')
  await files.setInputFiles(paths)
  await ready(5)
  const previews = await thumbnails.evaluateAll((items) => items.map((item) => item.src))
  const expected = previews.map((url) =>
    createHash('sha256')
      .update(Buffer.from(url.split(',')[1], 'base64'))
      .digest('hex'),
  )
  assert.ok(
    previews.every((url) => Buffer.from(url.split(',')[1], 'base64').length <= 3 * 1024 * 1024),
  )
  await files.setInputFiles({ name: 'sixth.png', mimeType: 'image/png', buffer: small })
  await panel.getByRole('alert').filter({ hasText: '最多发送 5 张' }).waitFor()
  assert.equal(await thumbnails.count(), 5)
  await panel.getByRole('button', { name: '保留已添加图片' }).click()
  pass('five large pictures prepare successfully; sixth is rejected')

  const configured = await page.evaluate(
    async ({ url, path }) => {
      const config = await window.cclinkStudio.settings.set({
        apiBaseUrl: url,
        modelName: 'claude-sonnet-4-6',
        claudeRuntimeSource: 'custom',
        claudeCodePath: path,
      })
      const key = await window.cclinkStudio.settings.setSecret('apiKey', 'image-smoke-key')
      return { config: config.success, key: key.success }
    },
    {
      url: `http://127.0.0.1:${server.address().port}`,
      path: resolve('.agent-runtime-staging', `darwin-${process.arch}`, 'claude'),
    },
  )
  assert.deepEqual(configured, { config: true, key: true })
  await panel.locator('[data-agent-action="runtime"]').click()
  await page.getByRole('button').filter({ hasText: 'Claude Code（备选）' }).click()
  await input.fill('Reply briefly. Do not call tools.')
  await send.click()
  await panel.getByText('IMAGE_SMOKE_RECEIVED_5', { exact: true }).waitFor({ timeout: 60_000 })
  const imageRequest = requests.find((request) => request.length === 5)
  assert.ok(imageRequest)
  assert.ok(imageRequest.every((item) => item.bytes > 0 && item.bytes <= 5 * 1024 * 1024))
  assert.equal(await thumbnails.count(), 0)
  await page.screenshot({ path: join(runDir, 'five-sent.png'), fullPage: true })
  pass('five images pass real IPC + Claude CLI and reach loopback API', {
    runtimeTranscoded: imageRequest.some((item, index) => item.sha256 !== expected[index]),
    images: imageRequest.map((item) => ({ bytes: item.bytes, mediaType: item.mediaType })),
  })

  await page.reload()
  await page.waitForSelector('.main-window')
  await panel.locator('.message-image-preview').first().waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.message-image-preview')].length === 5 &&
      [...document.querySelectorAll('.message-image-preview')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
  )
  const restored = await panel
    .locator('.message-image-preview')
    .evaluateAll((items) => items.map((image) => image.src))
  assert.deepEqual(
    restored.map((url) =>
      createHash('sha256')
        .update(Buffer.from(url.split(',')[1], 'base64'))
        .digest('hex'),
    ),
    expected,
  )
  pass('five sent image assets restore byte-identical to their Studio previews after reload')
  apiMode = 'fail'
  await files.setInputFiles({ name: 'retry.png', mimeType: 'image/png', buffer: small })
  await ready(1)
  await input.fill('RETRY_IMAGE_DRAFT')
  await send.click()
  await page.waitForFunction(
    () =>
      document.querySelector('textarea.agent-input')?.value === 'RETRY_IMAGE_DRAFT' &&
      document.querySelectorAll('.agent-image-attachment img').length === 1,
    null,
    { timeout: 30_000 },
  )
  pass('API rejection restores text and picture for retry')
  await writeFile(
    join(runDir, 'result.json'),
    JSON.stringify({ status: 'pass', results, requests }, null, 2),
  )
  console.log(`ARTIFACTS ${runDir}`)
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(runDir, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(
      join(runDir, 'failure.txt'),
      await page
        .locator('body')
        .innerText()
        .catch(() => ''),
    ).catch(() => {})
  }
  console.error(`FAIL ${error.stack}\nARTIFACTS ${runDir}`)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
}
