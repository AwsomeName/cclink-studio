// Run with pnpm dev serving the current renderer; uses a disposable Electron profile.
// Long labels / update / toast are explicit UI fixtures, with no network or Git writes.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'
import electronPath from 'electron'

const repository = resolve(import.meta.dirname, '..')
const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
const temporary = await mkdtemp(join(tmpdir(), 'studio-clock-'))
const evidence = join(repository, 'docs/testing/status-bar-clock')
await mkdir(evidence, { recursive: true })
await mkdir(join(temporary, 'profile'))
await mkdir(join(temporary, 'home'))
await mkdir(join(temporary, 'documents'))
await writeFile(
  join(temporary, 'profile/settings.json'),
  JSON.stringify({ componentSetupPageSeenVersion: 99 }),
)
await writeFile(
  join(temporary, 'launch.cjs'),
  `
const {app} = require('electron');
app.setPath('home', ${JSON.stringify(join(temporary, 'home'))});
app.setPath('documents', ${JSON.stringify(join(temporary, 'documents'))});
app.setAppPath(${JSON.stringify(repository)});
require(${JSON.stringify(join(repository, 'out/main/index.js'))});
`,
)
let app
let page
const checks = []
const pass = (check) => {
  checks.push(check)
  console.log('PASS', check)
}
try {
  app = await _electron.launch({
    executablePath: electronPath,
    args: [join(temporary, 'launch.cjs')],
    cwd: repository,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '',
      ELECTRON_RENDERER_URL: rendererUrl,
      CCLINK_STUDIO_TEST_USER_DATA_PATH: join(temporary, 'profile'),
    },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.locator('.status-bar-clock').waitFor()
  await page.evaluate(async () => {
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    useTabStore
      .getState()
      .openTab({ type: 'browser', title: '时钟布局验收', icon: '🌐', initialUrl: 'about:blank' })
  })
  await page.locator('.status-bar-url').waitFor()
  await page.evaluate(async () => {
    const { useGitStore } = await import('/src/stores/git-store.ts')
    const { useUpdateStore } = await import('/src/stores/update-store.ts')
    const { useBrowserStore } = await import('/src/stores/browser-store.ts')
    const { useTabStore } = await import('/src/stores/tab-store.ts')
    const { useFsStore } = await import('/src/stores/fs-store.ts')
    useGitStore.setState({
      loadWorkspace: async () => {},
      refresh: async () => {},
      snapshot: {
        availability: 'available',
        branch: 'feature/' + 'long-branch-name-'.repeat(15),
        changeCount: 123456,
        additions: 123456,
        deletions: 78910,
        conflictedCount: 0,
        changes: [],
        repositoryName: 'clock-fixture',
        detached: false,
        upstream: null,
      },
    })
    useFsStore.setState({ switchingPath: '/fixture/' + '很长的工作空间名称'.repeat(15) })
    const id = useTabStore.getState().activeTabId
    useBrowserStore.setState((state) => ({
      tabs: {
        ...state.tabs,
        [id]: { ...state.tabs[id], url: 'https://example.test/' + 'long-path/'.repeat(80) },
      },
    }))
    useUpdateStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        phase: 'available',
        availableRelease: {
          version: '12345.67890.12345',
          tag: 'v12345.67890.12345',
          channel: 'stable',
          architecture: 'arm64',
          minimumSystemVersion: '13.0',
          publishedAt: '2026-11-10T00:00:00.000Z',
          releaseNotes: 'UI fixture',
          prerelease: false,
          asset: {
            name: 'fixture.dmg',
            size: 1024,
            url: 'https://example.test/fixture.dmg',
            sha256: '0'.repeat(64),
          },
        },
      },
    }))
  })
  for (const width of [1400, 1125, 1124, 1100, 900, 785, 784, 760, 640, 480]) {
    await app.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 780),
      width,
    )
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    const layout = await page.evaluate(() => {
      const box = (node) => {
        const r = node.getBoundingClientRect()
        return { left: r.left, right: r.right, width: r.width }
      }
      const bar = document.querySelector('.status-bar')
      const clock = document.querySelector('.status-bar-clock')
      return {
        viewport: innerWidth,
        bar: box(bar),
        clock: box(clock),
        height: bar.clientHeight,
        full: getComputedStyle(document.querySelector('.status-bar-clock-full')).display !== 'none',
        sides: ['left', 'right'].map((side) => {
          const group = document.querySelector('.status-bar-' + side)
          return {
            side,
            ...box(group),
            items: [...group.children].filter((e) => e.getBoundingClientRect().width > 0).map(box),
          }
        }),
      }
    })
    assert.equal(layout.height, 22)
    assert(
      Math.abs((layout.clock.left + layout.clock.right) / 2 - layout.viewport / 2) < 1,
      JSON.stringify(layout),
    )
    assert.equal(layout.full, width > 1124)
    assert.equal(await page.locator('.status-bar-edition').isVisible(), width > 784)
    assert.equal(await page.locator('.status-bar-url').isVisible(), width > 784)
    for (const side of layout.sides) {
      assert(side.side === 'left' ? side.right < layout.clock.left : side.left > layout.clock.right)
      let previous = side.left
      for (const item of side.items) {
        assert(item.left >= previous - 1 && item.right <= side.right + 1, JSON.stringify(layout))
        previous = item.right
      }
    }
    if ([1400, 900, 640].includes(width))
      await page.screenshot({ path: join(evidence, `width-${width}.png`) })
    pass(`width ${width}: centered, 22px high, correct format, long labels contained`)
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(900, 780),
  )
  await page.locator('.git-status-trigger').click()
  const popover = page.getByRole('dialog', { name: 'Git 状态', exact: true })
  await popover.waitFor()
  const hit = await popover.evaluate((e) => {
    const r = e.getBoundingClientRect()
    return e.contains(document.elementFromPoint(r.x + 20, r.y + 20))
  })
  assert(hit, 'Git popover must not be clipped by the new layout')
  await page.keyboard.press('Escape')
  await page.locator('.update-badge').click()
  await page.locator('.update-panel').waitFor()
  await page.keyboard.press('Escape')
  pass('Git popover and update panel remain usable')

  await page.clock.install({ time: new Date('2026-12-31T23:59:59') })
  await page.clock.pauseAt(new Date('2026-12-31T23:59:59'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  assert.match(await page.locator('.status-bar-clock').innerText(), /12\/31 · 23:59/)
  await page.clock.runFor(1000)
  await page.waitForFunction(() =>
    document.querySelector('.status-bar-clock').textContent.includes('01/01 · 00:00'),
  )
  assert.match(await page.locator('.status-bar-clock').getAttribute('title'), /2027\/01\/01 周五/)
  await page.clock.fastForward(7 * 60 * 60 * 1000)
  assert.match(await page.locator('.status-bar-clock').innerText(), /07:00/)
  await page.clock.setSystemTime(new Date('2027-01-02T09:18:00'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() =>
    document.querySelector('.status-bar-clock').textContent.includes('01/02 · 09:18'),
  )
  pass('minute rollover, new year, delayed timer and focus catch-up use current wall time')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' })
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
  assert.match(await page.locator('.status-bar-clock').getAttribute('title'), /America\/New_York/)
  pass('timezone changes are reflected without remounting the clock')
  await page.evaluate(async () => {
    const { useToastStore } = await import('/src/components/common/Toast.tsx')
    useToastStore
      .getState()
      .show('这是很长的提示消息，用于确认它不会覆盖左右信息。'.repeat(10), 'error')
  })
  await page.locator('.toast').waitFor()
  assert.equal(await page.locator('.status-bar-clock').isVisible(), false)
  const toast = await page.locator('.toast').boundingBox()
  const center = await page.locator('.status-bar-center').boundingBox()
  assert(toast.x >= center.x - 1 && toast.x + toast.width <= center.x + center.width + 1)
  await page.clock.runFor(8100)
  await page.locator('.status-bar-clock').waitFor()
  pass('long toast replaces the clock within the center slot, then restores it')
  await writeFile(
    join(evidence, 'result.json'),
    JSON.stringify(
      { checks, rendererUrl, clockTests: 'simulated time; no OS sleep or system clock changes' },
      null,
      2,
    ) + '\n',
  )
} catch (error) {
  await page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  throw error
} finally {
  // Exit only this disposable instance; a fixture may intentionally leave UI state
  // (such as workspace switching) that would block the normal close confirmation.
  const child = app?.process()
  const exited =
    child && child.exitCode === null
      ? new Promise((done) => child.once('exit', done))
      : Promise.resolve()
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await exited
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
