#!/usr/bin/env node
// Actual Electron + real user-supplied Altium files. Never adds fixtures to the repository.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createSmokeRuntime } from './smoke-runtime.mjs'

process.env.CCLINK_STUDIO_SMOKE_RUN_DIR ??= `/tmp/cclink-altium-acceptance-${Date.now()}`
process.env.CCLINK_STUDIO_SMOKE_RENDERER_PORT ??= '39876'
const { rootDir, runDir, logFile, rendererOrigin } = createSmokeRuntime(import.meta.url)
const workspacePath = resolve(
  process.argv.slice(2).find((arg) => arg !== '--') || join(rootDir, '生产/20260210_pcb_原理图'),
)
const names = [
  'power_audio.SchDoc',
  'type-c_in_mipi_out.SchDoc',
  'MCU.schdoc',
  'LCD.PcbDoc',
  'TYPEC_DP_TO_MIPI_V2_0.PrjPcb',
]
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        createHash('sha256')
          .update(await readFile(join(workspacePath, name)))
          .digest('hex'),
      ]),
    ),
  )
const before = await hashes()
await mkdir(runDir, { recursive: true })
await mkdir(join(rootDir, '.cache'), { recursive: true })
const corruptWorkspace = await mkdtemp(join(rootDir, '.cache', 'altium-smoke-'))
await writeFile(join(corruptWorkspace, 'broken.SchDoc'), 'not an Altium document')
let child, browser
const results = []
const errors = []
const wheelErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(predicate, label, timeout = 45_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await predicate()
    if (value) return value
    await sleep(250)
  }
  throw new Error(`Timeout: ${label}`)
}
async function openWorkspace(page, path) {
  const opened = await page.evaluate(async (path) => {
    // Use the normal main-owned recent-workspace registry, not renderer-supplied authority.
    await window.cclinkStudio.workspaceState.listLocalWorkspaces(null)
    const { openWorkspaceRef } =
      await import('/src/features/workspace-open/workspace-open-controller.ts')
    return openWorkspaceRef({ kind: 'local', path })
  }, path)
  assert(opened, 'workspace opened')
  await page.evaluate(async () => {
    const { useUIStore } = await import('/src/stores/ui-store.ts')
    useUIStore.getState().setAgentPanelMode('hidden')
    useUIStore.getState().showPanel('files')
  })
}
async function waitDrawing(page, name) {
  await page
    .locator('[data-testid="altium-drawing"]')
    .filter({ hasText: name })
    .waitFor({ timeout: 20_000 })
  await waitFor(
    () =>
      page
        .locator('.altium-stage > img')
        .evaluateAll((images) => images.some((img) => img.complete && img.naturalWidth > 0)),
    `render ${name}`,
  )
}
async function capture(page, name) {
  await page.screenshot({ path: join(runDir, `${name}.png`) })
}

try {
  await mkdir(join(runDir, 'user-data'), { recursive: true })
  await writeFile(
    join(runDir, 'user-data', 'workspace-state.json'),
    JSON.stringify({
      version: 2,
      workspaces: {},
      localWorkspaces: Object.fromEntries(
        [workspacePath, corruptWorkspace].map((path, index) => [
          String(index),
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
    join(runDir, 'user-data', 'settings.json'),
    JSON.stringify({
      lastWorkspacePath: workspacePath,
      recentWorkspacePaths: [workspacePath, corruptWorkspace],
      componentSetupPageSeenVersion: 2,
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
  const port = await waitFor(
    async () => {
      const log = await readFile(logFile, 'utf8').catch(() => '')
      return (
        log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1] ||
        log.match(/\[CCLink Studio\] CDP .*?:\s*(\d+)/)?.[1]
      )
    },
    'Electron CDP',
    90_000,
  )
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = await waitFor(
    () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().startsWith(`${rendererOrigin}/`)),
    'renderer',
  )
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.text().includes('Unable to preventDefault inside passive'))
      wheelErrors.push(message.text())
  })
  await page.setViewportSize({ width: 1560, height: 1000 })
  await page.waitForSelector('.main-window')
  await waitFor(
    () =>
      page.evaluate(async () => {
        const { useFsStore } = await import('/src/stores/fs-store.ts')
        return !useFsStore.getState().loading && !useFsStore.getState().switchingPath
      }),
    'initial workspace',
  )
  await openWorkspace(page, workspacePath)

  for (const name of names.slice(0, 4)) {
    await page.locator('.file-tree-item.file').filter({ hasText: name }).click()
    await waitDrawing(page, name)
    const result = await page.evaluate(
      (path) => window.cclinkStudio.fs.renderFile(path),
      join(workspacePath, name),
    )
    assert.equal(result.kind, 'altium-drawing')
    const svg = Buffer.from(result.content, 'base64').toString()
    assert(svg.includes('<svg'))
    assert(!svg.includes('<script'))
    if (name === 'power_audio.SchDoc') {
      for (const label of ['CS4344', 'PAM8404', 'U9', 'U5'])
        assert(svg.includes(label), `power label ${label}`)
    }
    if (name === 'LCD.PcbDoc') {
      assert(result.layers.includes('TOP') && result.layers.includes('BOTTOM'))
      assert.equal(result.counts.find((entry) => entry.label === '走线').value, 3811)
      assert.equal(result.counts.find((entry) => entry.label === '焊盘').value, 559)
      for (const dimension of ['16.76', '9.91', '46.09', '19.95'])
        assert(svg.includes(`>${dimension}</text>`), `linear dimension ${dimension}`)
      assert(!svg.includes('>10mil</text>'), 'TEXTFORMAT is not the measured dimension')
      assert(!result.layers.includes('MIDLAYER2') && !result.layers.includes('PLANE1'))
    }
    await capture(page, name)
    if (name === 'power_audio.SchDoc') {
      await page.getByLabel('显示隐藏文字', { exact: true }).check()
      await waitFor(
        () => page.getByLabel('显示隐藏文字', { exact: true }).isEnabled(),
        'hidden text',
      )
      await waitDrawing(page, name)
      const src = await page.locator('.altium-stage > img').getAttribute('src')
      const hiddenSvg = Buffer.from(src.split(',')[1], 'base64').toString()
      assert(hiddenSvg.includes('U6') && hiddenSvg.includes('EA3059C'))
      await capture(page, 'power-hidden-text')
      await page.getByLabel('显示隐藏文字', { exact: true }).uncheck()
      await waitFor(
        () => page.getByLabel('显示隐藏文字', { exact: true }).isEnabled(),
        'normal text',
      )
    }
    await page.getByRole('button', { name: '放大图纸', exact: true }).click()
    assert.equal(await page.getByLabel('图纸缩放', { exact: true }).textContent(), '125%')
    await page.getByRole('button', { name: '适合窗口', exact: true }).click()
    assert.equal(await page.getByLabel('图纸缩放', { exact: true }).textContent(), '100%')
    results.push({ file: name, counts: result.counts, warnings: result.warnings, rendered: true })
    console.log(`PASS ${name}: actual file tree → parser worker → rendered image`)
  }

  const layerSelect = page.getByLabel('PCB 层', { exact: true })
  const allSource = await page.locator('.altium-stage > img').getAttribute('src')
  for (const layer of ['TOP', 'BOTTOM', 'MID2']) {
    if (!(await layerSelect.locator(`option[value="${layer}"]`).count())) continue
    await layerSelect.selectOption(layer)
    await waitDrawing(page, 'LCD.PcbDoc')
    await waitFor(() => layerSelect.isEnabled(), 'layer load')
    assert.notEqual(await page.locator('.altium-stage > img').getAttribute('src'), allSource)
    await capture(page, `LCD-${layer}`)
  }
  const stage = page.locator('.altium-stage')
  const bounds = await stage.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 40)
  await page.mouse.up()
  assert(
    (await page.locator('.altium-stage > img').getAttribute('style')).includes(
      'translate(80px, 40px)',
    ),
  )
  await page.getByRole('button', { name: '适合窗口', exact: true }).click()
  console.log('PASS PCB layer switching, zoom, pan and fit')

  await page.locator('.file-tree-item.file').filter({ hasText: names[4] }).click()
  await page.getByTestId('altium-project').waitFor()
  assert.equal(await page.locator('.altium-project-document button:enabled').count(), 4)
  assert.equal(await page.locator('.altium-project-document button:disabled').count(), 2)
  await capture(page, 'project')
  await page
    .locator('.altium-project-document')
    .filter({ hasText: 'power_audio.SchDoc' })
    .getByRole('button')
    .click()
  await waitDrawing(page, 'power_audio.SchDoc')
  const audioStage = await page.locator('.altium-stage').boundingBox()
  await page.mouse.move(
    audioStage.x + audioStage.width * 0.3,
    audioStage.y + audioStage.height * 0.62,
  )
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -100)
    await sleep(30)
  }
  await capture(page, 'power-audio-detail')
  const zoomBeforeHorizontalWheel = await page.getByLabel('图纸缩放', { exact: true }).textContent()
  await page.mouse.wheel(100, 0)
  await sleep(100)
  assert.equal(
    await page.getByLabel('图纸缩放', { exact: true }).textContent(),
    zoomBeforeHorizontalWheel,
  )
  assert.deepEqual(wheelErrors, [])
  console.log('PASS project navigation and explicit missing references')

  // Reproduce changing a render option followed immediately by rapid file switching.
  await page.getByLabel('显示隐藏文字', { exact: true }).check()
  for (const name of names.slice(1, 4)) {
    await page.locator('.file-tree-item.file').filter({ hasText: name }).click()
  }
  await waitDrawing(page, 'LCD.PcbDoc')
  for (const name of names.slice(0, 4)) {
    await page.locator('.file-tree-item.file').filter({ hasText: name }).click()
    await waitDrawing(page, name)
  }
  console.log('PASS rapid file switching after changing render options')

  const writes = await page.evaluate(
    async (path) => {
      const outcomes = []
      for (const action of [
        () => window.cclinkStudio.fs.readTextDocument(path),
        () => window.cclinkStudio.fs.writeFile(path, 'bad'),
        () =>
          window.cclinkStudio.fs.saveTextDocument({ filePath: path, content: 'bad', force: true }),
      ]) {
        try {
          await action()
          outcomes.push('unexpected success')
        } catch (error) {
          outcomes.push(String(error))
        }
      }
      return outcomes
    },
    join(workspacePath, names[0]),
  )
  assert(writes.every((message) => message.includes('ALTIUM_READ_ONLY')))
  console.log('PASS stale text-editor read/save paths rejected')

  await openWorkspace(page, corruptWorkspace)
  await page.locator('.file-tree-item.file').filter({ hasText: 'broken.SchDoc' }).click()
  await page.getByText('无法预览文件', { exact: true }).waitFor()
  assert.equal(await page.locator('.altium-stage > img').count(), 0)
  await capture(page, 'corrupt-fallback')
  await openWorkspace(page, workspacePath)
  await page.locator('.file-tree-item.file').filter({ hasText: names[0] }).click()
  await waitDrawing(page, names[0])
  assert.deepEqual(await hashes(), before)
  assert.deepEqual(errors, [])
  await writeFile(
    join(runDir, 'acceptance.json'),
    JSON.stringify(
      {
        workspacePath,
        hashes: before,
        results,
        checks: [
          'file-tree',
          'rendered-images',
          'layer-switch',
          'zoom-pan-fit',
          'project-links',
          'read-only',
          'corrupt-fallback',
          'workspace-return',
          'rapid-file-switching',
          'wheel-without-passive-errors',
          'linear-dimensions',
          'canonical-layer-selector',
        ],
        errors,
        wheelErrors,
      },
      null,
      2,
    ),
  )
  console.log(`PASS original source hashes unchanged; evidence: ${runDir}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await browser?.close()
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {}
    await sleep(750)
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }
  await rm(corruptWorkspace, { recursive: true, force: true })
}
