import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

// One real run proves query/event wiring. 99/99+ are presentation boundary fixtures,
// not 100 queued tasks and not a second production scheduler or test IPC API.
export async function runActivityCountSmoke({ evidenceDir, workspaceRoot, rootDir }) {
  const require = createRequire(import.meta.url)
  const { build } = createRequire(require.resolve('vite'))('esbuild')
  const directory = join(evidenceDir, 'counter')
  await mkdir(directory, { recursive: true })
  const common = { bundle: true, logLevel: 'silent', absWorkingDir: rootDir }
  // Test-only bundle; production main/preload outputs stay unchanged.
  await build({
    ...common,
    entryPoints: ['scripts/fixtures/activity-count-main.ts'],
    outfile: join(directory, 'main.cjs'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  })
  await build({
    ...common,
    entryPoints: ['scripts/fixtures/activity-count-renderer.tsx'],
    outfile: join(directory, 'renderer.js'),
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    alias: { '@shared': join(rootDir, 'src/shared') },
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false' },
  })
  await writeFile(
    join(directory, 'index.html'),
    '<html><head><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>',
  )
  const fixture = await _electron.launch({
    executablePath: electronPath,
    args: [
      join(directory, 'main.cjs'),
      directory,
      workspaceRoot,
      join(rootDir, 'out/preload/index.js'),
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  })
  try {
    const page = await fixture.firstWindow()
    await page.locator('.activity-bar').waitFor()
    const badge = page.locator('.activity-bar-badge')
    if (await badge.count()) throw new Error('Counter must initially be hidden')
    const started = await page.evaluate(async (workspacePath) => {
      const api = window.cclinkStudio.scheduledTasks
      const saved = await api.save({
        workspacePath,
        title: 'Counter fixture',
        instruction: '生成本地 Markdown',
        schedule: { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' },
        resources: [{ kind: 'workspace' }],
        outputPolicy: { directory: 'counter', fileNameTemplate: '{date}.md', mode: 'create-only' },
        enable: false,
      })
      if (!saved.success) throw new Error(JSON.stringify(saved))
      return api.runNow({ workspacePath, taskId: saved.task.definition.id })
    }, workspaceRoot)
    if (!started.success) throw new Error(JSON.stringify(started))
    await page.waitForFunction(
      () => document.querySelector('.activity-bar-badge')?.textContent === '1',
    )
    if (
      (await page.getByRole('status', { name: '1 个任务排队或运行中', exact: true }).count()) !== 1
    )
      throw new Error('Queued/running count is missing its accessible status')
    const status = await page.evaluate(() => window.cclinkStudio.scheduledTasks.getRuntimeStatus())
    if (status.queuedCount + Number(Boolean(status.runningRunId)) !== 1)
      throw new Error('Counter is not backed by real runtime status')
    await page.screenshot({ path: join(directory, 'runtime-one.png') })
    // Geometry-only copies, explicitly marked as fixtures; real badge remains Runtime-owned.
    const boundaries = await page.evaluate(() => {
      const source = document.querySelector('.activity-bar-badge').parentElement
      return ['99', '99+'].map((value) => {
        const row = source.cloneNode(true)
        row.dataset.presentationFixture = value
        row.querySelector('.activity-bar-badge').textContent = value
        source.parentElement.appendChild(row)
        const label = row.querySelector('.activity-bar-label').getBoundingClientRect()
        const badge = row.querySelector('.activity-bar-badge').getBoundingClientRect()
        const bounds = row.getBoundingClientRect()
        const result = { value, fits: label.right < badge.left && badge.right <= bounds.right }
        row.remove()
        return result
      })
    })
    if (boundaries.some((value) => !value.fits)) throw new Error(JSON.stringify(boundaries))
    await fixture.evaluate(() => globalThis.activityCountFixture.release())
    await page.waitForFunction(() => !document.querySelector('.activity-bar-badge'))
    const final = await page.evaluate(() => window.cclinkStudio.scheduledTasks.getRuntimeStatus())
    if (final.queuedCount || final.runningRunId) throw new Error('Runtime did not return to zero')
    const events = await fixture.evaluate(() => globalThis.activityCountFixture.events())
    await writeFile(
      join(directory, 'result.json'),
      JSON.stringify(
        { status, final, events, boundaries, executor: 'test-only; no Agent calls' },
        null,
        2,
      ),
    )
    return { events, transitions: '0 → 1 → 0', boundaries }
  } finally {
    await fixture.evaluate(() => globalThis.activityCountFixture.stop()).catch(() => {})
    await fixture.close()
  }
}
