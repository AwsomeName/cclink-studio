// Real Electron: a connected remote desktop survives switching to another project and back,
// on the same VNC socket; closing the Tab still disconnects at once. Uses a local fake RFB
// server (security type None) and an isolated home/profile. Build first:
//   pnpm exec electron-vite build --outDir .cache/diary-build
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { makeRoot, makeHome, firstUse } from './diary-acceptance-lib.mjs'

const PORT = 5987
const WIDTH = 320
const HEIGHT = 200

/** Minimal RFB 3.8 server: no auth, one gray frame, then ignores input. */
function startFakeVnc() {
  const stats = { opened: 0, closed: 0 }
  const server = createServer((socket) => {
    stats.opened++
    socket.on('close', () => stats.closed++)
    socket.on('error', () => {})
    let stage = 'version'
    let framed = false
    socket.write('RFB 003.008\n')
    socket.on('data', (data) => {
      if (stage === 'version') {
        stage = 'security'
        socket.write(Buffer.from([1, 1])) // one type: None
      } else if (stage === 'security') {
        stage = 'init'
        socket.write(Buffer.from([0, 0, 0, 0])) // SecurityResult OK
      } else if (stage === 'init') {
        stage = 'running'
        const name = Buffer.from('Keep-alive smoke')
        const init = Buffer.alloc(24)
        init.writeUInt16BE(WIDTH, 0)
        init.writeUInt16BE(HEIGHT, 2)
        Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]).copy(init, 4)
        init.writeUInt32BE(name.length, 20)
        socket.write(Buffer.concat([init, name]))
      } else if (!framed && data.includes(3)) {
        framed = true
        const header = Buffer.alloc(16)
        header.writeUInt8(0, 0)
        header.writeUInt16BE(1, 2)
        header.writeUInt16BE(WIDTH, 8)
        header.writeUInt16BE(HEIGHT, 10)
        header.writeInt32BE(0, 12) // Raw
        socket.write(Buffer.concat([header, Buffer.alloc(WIDTH * HEIGHT * 4, 0x80)]))
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', () => resolve({ server, stats }))
  })
}

const { server, stats } = await startFakeVnc()
const root = await makeRoot('.cclink-desktop-keep-alive-')
const s = await makeHome(root, 'desktop')
const projectA = join(s.home, 'project-a')
const projectB = join(s.home, 'project-b')
await mkdir(projectA, { recursive: true })
await mkdir(projectB, { recursive: true })
try {
  const page = await s.launch()
  await firstUse(s, {})
  const open = async (path) => {
    await s.pickDirectory(path)
    await page.getByRole('button', { name: '新建或打开项目', exact: true }).click()
    await page.getByRole('button', { name: /打开已有项目/ }).click()
    const item = page.locator(`.project-strip-item[data-project-path="${path}"]`).first()
    await item.waitFor()
    return item
  }
  const itemA = await open(projectA)
  const itemB = await open(projectB)
  await itemA.click()
  await page.locator(`.project-strip-item.active[data-project-path="${projectA}"]`).waitFor()

  await page.getByRole('button', { name: '新建远程桌面' }).click()
  const desk = page.locator('section.remote-desktop:not([hidden])')
  await desk.getByLabel('主机名或 IP').fill('127.0.0.1')
  await desk.locator('summary').click()
  await desk.getByLabel('屏幕共享端口').fill(String(PORT))
  await desk.getByRole('button', { name: '连接', exact: true }).click()
  await desk.locator('.remote-desktop-screen canvas').waitFor()
  assert.equal(stats.opened, 1)
  await page.screenshot({ path: join(s.home, '1-connected-in-a.png') })

  // Switch to B: the desktop leaves the tab bar but the socket stays open.
  await itemB.click()
  await page.locator(`.project-strip-item.active[data-project-path="${projectB}"]`).waitFor()
  assert.equal(await page.locator('.tab.remote-desktop-live').count(), 0, 'not shown in B')
  await page.waitForTimeout(3000)
  assert.equal(stats.closed, 0, 'socket survives the switch')
  await page.screenshot({ path: join(s.home, '2-in-b.png') })

  // Back to A: the same Tab returns still connected, without a new connection.
  await itemA.click()
  await page.locator(`.project-strip-item.active[data-project-path="${projectA}"]`).waitFor()
  const tab = page.locator('.tab.remote-desktop-live')
  await tab.waitFor()
  await tab.click()
  await desk.locator('.remote-desktop-screen canvas').waitFor()
  assert.equal(await desk.locator('form.remote-desktop-form').count(), 0, 'no reconnect form')
  assert.equal(stats.opened, 1, 'no second connection')
  assert.equal(stats.closed, 0, 'still the original socket')
  await page.screenshot({ path: join(s.home, '3-back-in-a.png') })

  // Closing the Tab is not parking: it disconnects immediately.
  await tab.hover()
  await tab.locator('.tab-close').click()
  const deadline = Date.now() + 5000
  while (stats.closed === 0 && Date.now() < deadline) await page.waitForTimeout(100)
  assert.equal(stats.closed, 1, 'closing the Tab disconnects')
  console.log('PASS remote desktop survives project switch; closing the Tab disconnects')
} catch (e) {
  await s.fail(e)
} finally {
  await s.close()
  server.close()
}
