// Real Electron: 项目设置 · 我的空间 · 科技日报. Configure a SearXNG service (local stand-in that
// enforces Basic auth and records requests), test the connection, save, run one trial
// collection and restart. Isolated home/profile; no paid API and no user data.
//
//   pnpm exec electron-vite build --outDir .cache/techdaily-build
//   DIARY_BUILD=.cache/techdaily-build node scripts/techdaily-settings-smoke.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeRoot, makeHome, firstUse } from './diary-acceptance-lib.mjs'

const shots = resolve('docs/design/techdaily-2026-11-25/acceptance')
await mkdir(shots, { recursive: true })
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const [y, m, d] = today.split('-')

// ── SearXNG stand-in ──
const requests = []
let counter = 0
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  requests.push({
    path: url.pathname,
    params: Object.fromEntries(url.searchParams),
    auth: req.headers.authorization,
  })
  if (req.headers.authorization !== 'Basic ' + Buffer.from('reader:pa55').toString('base64')) {
    res.writeHead(401).end()
    return
  }
  const q = url.searchParams.get('q') ?? ''
  const n = ++counter
  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      results: [
        {
          title: `${q} 最新进展 ${n}`,
          url: `https://news.example.cn/${y}/${m}-${d}/${n}.html`,
          engines: ['bing'],
        },
        {
          title: `${q} 海外报道 ${n}`,
          url: `https://tech.example.com/story-${n}?utm_source=x`,
          engines: ['duckduckgo news'],
          publishedDate: `${today}T03:00:00`,
        },
        { title: `${q} 百科`, url: `https://baike.baidu.com/item/${n}`, engines: ['bing'] },
        { title: `${q} 别的引擎`, url: `https://other.example.com/${n}`, engines: ['google news'] },
        {
          title: `${q} 旧闻`,
          url: `https://news.example.cn/2025/01-02/${n}.html`,
          engines: ['bing'],
        },
      ],
    }),
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const root = await makeRoot('.cclink-techdaily-settings-')
const s = await makeHome(root, 'settings')
const step = (name) => console.log('PASS ' + name)
try {
  let page = await s.launch()
  const space = await firstUse(s)
  await page.getByRole('button', { name: '项目设置', exact: true }).first().click()
  const section = page.getByLabel('科技日报设置')
  await section.getByText('还没有设置文件', { exact: false }).waitFor()
  await section.getByText('共 54 个搜索词', { exact: false }).waitFor()
  assert(await section.getByLabel('使用 DeepSeek 联网搜索').isChecked())
  await section.getByText('✗ 联网搜索未启用', { exact: false }).waitFor()
  await section.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'T1-settings-deepseek.png') })
  step('section shows Argus word list (9 domains, 54 queries) and DeepSeek not enabled')

  // SearXNG: wrong credential first, then the right one.
  await section.getByLabel('使用 SearXNG 远程服务').check()
  await section.getByText('✗ SearXNG 服务地址未配置', { exact: false }).waitFor()
  await section.getByLabel('SearXNG 服务地址').fill(base + '/')
  await section.getByRole('radio', { name: '用户名和密码（Basic）' }).check()
  await section.getByLabel('SearXNG 用户名').fill('reader')
  await section.getByLabel('SearXNG 密码').fill('wrong')
  await section.getByRole('button', { name: '测试连接' }).click()
  await section.getByText('SearXNG 拒绝访问：请检查访问凭证', { exact: false }).waitFor()
  await section.getByLabel('SearXNG 密码').fill('pa55')
  await section.getByRole('button', { name: '测试连接' }).click()
  await section
    .getByText('连接成功：5 条结果，其中 4 条来自采用的引擎，3 条带日期', { exact: false })
    .waitFor()
  await section.getByText('引擎分布', { exact: false }).waitFor()
  const testRequest = requests.at(-1)
  assert.equal(testRequest.path, '/search')
  assert.deepEqual(Object.keys(testRequest.params).sort(), [
    'categories',
    'format',
    'language',
    'q',
  ])
  assert.equal(testRequest.params.categories, 'news')
  await section.getByRole('group', { name: '搜索服务' }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'T2a-searxng-test.png') })
  step('test connection: 401 explained, then counts, engines and dates; no time_range sent')

  await section.getByRole('button', { name: '保存 SearXNG 连接' }).click()
  await section.getByText('SearXNG 地址已保存在这台电脑', { exact: false }).waitFor()
  await section.getByRole('radio', { name: '保持已保存（reader）' }).waitFor()
  const searxngFile = await readFile(join(s.profile, 'techdaily', 'searxng.json'), 'utf8')
  assert(searxngFile.includes(base) && !searxngFile.includes('pa55'))
  const credentials = await readFile(join(s.profile, 'credentials', 'credentials.json'), 'utf8')
  assert(credentials.includes('extension:searxng:default') && credentials.includes('pa55'))
  step('address on this machine (userData), password only in the credential file')

  await section.getByLabel('开启科技日报').check()
  await section.getByLabel('一次最多搜索次数').fill('3')
  await section.getByRole('button', { name: '保存科技日报设置' }).click()
  await section.getByText('已保存到 科技日报/设置.yaml', { exact: false }).waitFor()
  const yamlPath = join(space, '科技日报', '设置.yaml')
  const yaml = await readFile(yamlPath, 'utf8')
  assert(yaml.includes('# 科技日报设置') && yaml.includes('Kimi MiniMax 混元'))
  assert(/^enabled: true$/m.test(yaml) && /^search_provider: searxng$/m.test(yaml))
  assert(/^daily_call_limit: 3$/m.test(yaml) && !yaml.includes(base))
  await page.screenshot({ path: join(shots, 'T2-settings-searxng.png') })
  step('settings written to 科技日报/设置.yaml with comments kept, no address in synced file')

  page.once('dialog', (dialog) => dialog.accept())
  const before = requests.length
  await section.getByRole('button', { name: '试采一轮' }).click()
  await section
    .getByText('提前停止：达到单次调用上限 3', { exact: false })
    .waitFor({ timeout: 60000 })
  const result = section.getByLabel('试采结果')
  await result.getByText('3 次搜索', { exact: false }).waitFor()
  await result.getByText('留下 6 篇', { exact: false }).waitFor()
  assert.equal(requests.length - before, 3)
  const row = await result.locator('tbody tr').first().innerText()
  assert(row.startsWith('模型能力'), row)
  await result.locator('summary').click()
  await result.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'T3-trial-collect.png') })
  step('trial collection: 3 calls, per-domain funnel, 6 articles kept, stops at the cap')

  // Hand edit + reload; then restart keeps everything.
  await writeFile(
    yamlPath,
    yaml.replace('domain_denylist: []', 'domain_denylist: ["news.example.cn"]'),
  )
  await section.getByRole('button', { name: '重新读取' }).click()
  await section.getByLabel('使用 SearXNG 远程服务').waitFor()
  await s.close()
  page = await s.launch()
  await page.getByRole('button', { name: '项目设置', exact: true }).first().click()
  const again = page.getByLabel('科技日报设置')
  assert(await again.getByLabel('使用 SearXNG 远程服务').isChecked())
  assert.equal(await again.getByLabel('SearXNG 服务地址').inputValue(), base)
  await again.getByText('连接成功：5 条结果', { exact: false }).waitFor()
  assert(await again.getByLabel('开启科技日报').isChecked())
  assert.equal(await again.getByLabel('一次最多搜索次数').inputValue(), '3')
  assert((await readFile(yamlPath, 'utf8')).includes('news.example.cn'))
  step('restart: provider, address, last test and options restored; hand edit kept')
  await s.close()
  console.log('RESULT PASS')
} catch (error) {
  await s.fail(error)
} finally {
  server.close()
}
