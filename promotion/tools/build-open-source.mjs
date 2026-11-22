import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { marked } from 'marked'

const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const root = dirname(kit)
const target = join(kit, '02-open-source')
const require = createRequire(import.meta.url)
let sharp
try { sharp = require('sharp') } catch {
  sharp = createRequire(join(process.env.PROMOTION_NODE_MODULES || '/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules', 'promotion-entry.cjs'))('sharp')
}
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const ci = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8')
const pnpmVersion = pkg.packageManager.split('@')[1]
const nodeVersion = ci.match(/node-version:\s*['"]?(\d+)/)?.[1]
const markdown = await readFile(join(target, 'article.md'), 'utf8')
if (!markdown.includes(`pnpm@${pnpmVersion}`) || !markdown.includes(`Node.js ${nodeVersion}`)) {
  throw new Error('社区稿的环境说明与当前 packageManager/CI 不一致，请先核对正文。')
}
const p = { paper: '#f5f3ee', navy: '#1c2d40', ink: '#293e4c', blue: '#427de4', mute: '#617582', line: '#d5dddf', pale: '#e8eef7' }
const font = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const txt = (x, y, label, size = 34, fill = p.ink, weight = 400, attrs = '') => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${attrs}>${esc(label)}</text>`
const rect = (x, y, w, h, fill, r = 0, stroke = 'none') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`
const rule = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${p.line}" stroke-width="2"/>`
const img = (x, y, w, h, source) => `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${source}"/>`
const icon = `data:image/png;base64,${(await readFile(join(kit, '../resources/icon.png'))).toString('base64')}`
const writing = `data:image/jpeg;base64,${(await readFile(join(kit, 'assets/screenshots/studio-writing.jpg'))).toString('base64')}`
const frame = (w, h, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${rect(0, 0, w, h, p.paper)}<g font-family="${font}">${content}</g></svg>`
const brand = (y = 44) => img(52, y, 54, 54, icon) + txt(122, y + 38, 'CCLink Studio', 30, p.navy, 650)
const heading = (kicker, title, subtitle = '') => brand() + txt(1148, 80, kicker, 23, p.mute, 500, 'text-anchor="end"') + rule(52, 130, 1148, 130) + txt(52, 218, title, 50, p.navy, 650) + (subtitle ? txt(52, 278, subtitle, 31, p.mute) : '')
const newAssets = []
await mkdir(join(target, 'images'), { recursive: true })
async function save(name, source, extra = {}) {
  const path = join(target, 'images', name)
  await writeFile(path + '.svg', source)
  await sharp(Buffer.from(source)).png({ compressionLevel: 9 }).toFile(path + '.png')
  const data = await readFile(path + '.png')
  const meta = await sharp(data).metadata()
  newAssets.push({ file: `02-open-source/images/${name}.png`, source: `02-open-source/images/${name}.svg`, kind: 'editorial-graphic', scope: 'open-source-v2', width: meta.width, height: meta.height, sha256: createHash('sha256').update(data).digest('hex'), ...extra })
}

await save('cover-v2', frame(1200, 675,
  brand(42) + txt(1148, 80, 'GITHUB / OPEN SOURCE', 23, p.mute, 500, 'text-anchor="end"') + rule(52, 132, 1148, 132) +
  txt(52, 268, '开源 AI 工作台', 70, p.navy, 650) + txt(52, 365, '从本地文件开始', 70, p.navy, 650) +
  txt(56, 438, '浏览器 · Markdown · Terminal · Agent', 28, p.mute) +
  rect(54, 493, 228, 48, p.pale, 24) + txt(168, 526, 'GPL-3.0-only', 26, '#3d5d7d', 500, 'text-anchor="middle"') + rect(296, 493, 150, 48, p.pale, 24) + txt(371, 526, 'macOS', 26, '#3d5d7d', 500, 'text-anchor="middle"') +
  rect(826, 211, 322, 340, p.navy, 24) + txt(866, 272, 'src/', 38, '#fff', 600) +
  txt(866, 350, '├─ main', 34, '#e4ecf6', 500) + txt(866, 414, '├─ preload', 34, '#e4ecf6', 500) + txt(866, 478, '└─ renderer', 34, '#e4ecf6', 500) +
  rule(52, 593, 1148, 593) + txt(52, 640, 'Electron · React · TypeScript', 26, p.mute) + txt(1148, 640, '源码结构示意', 22, p.mute, 400, 'text-anchor="end"')
))

await save('workbench-v2', frame(1200, 1370,
  heading('01 / 真实工作台', '本地目录、文档与工具入口', '同一工作空间里的三个区域。') +
  img(48, 333, 1104, 686.057, writing) + rule(52, 1056, 1148, 1056) +
  [['01', '本地目录', '找到笔记、提纲和草稿'], ['02', '文档编辑', '读取、修改与保存 Markdown'], ['03', 'Agent', '根据指定材料准备任务']].map(([n, title, detail], i) => txt(52, 1110 + i * 88, n, 36, p.blue, 600) + txt(124, 1110 + i * 88, title, 40, p.navy, 600) + txt(356, 1110 + i * 88, detail, 37, p.mute)).join('') +
  txt(52, 1340, '真实界面 v0.1.118 · 演示文件 · 指令待发送', 28, p.mute)
), { inputSources: ['assets/screenshots/studio-writing.jpg'], treatment: 'Full unaltered native screenshot with explanatory labels outside the screenshot.' })

await save('architecture-v2', frame(1200, 1490,
  heading('02 / 源码职责', '界面、桥接与主进程各司其职', '从用户输入到领域服务的职责简图。') +
  rect(64, 333, 1072, 220, '#fff', 22, p.line) + txt(100, 407, 'renderer / React', 44, p.navy, 600) + txt(100, 475, '用户输入、文档界面与状态展示', 36, p.mute) +
  txt(600, 607, '↓ 调用 preload 白名单 API', 32, '#4a6887', 500, 'text-anchor="middle"') +
  rect(64, 659, 1072, 180, '#fff', 22, p.line) + txt(100, 731, 'preload / contextBridge', 44, p.navy, 600) + txt(100, 794, '受限 API 与跨进程通信', 36, p.mute) +
  txt(600, 905, '↕ IPC 请求与事件', 32, '#4a6887', 500, 'text-anchor="middle"') +
  rect(64, 957, 1072, 230, p.navy, 22) + txt(100, 1029, 'main / 领域服务', 44, '#fff', 600) + txt(100, 1097, '文件 · 浏览器 · Agent · Terminal', 36, '#dce6f2') + txt(100, 1151, '拥有各自的执行事实与生命周期', 35, '#dce6f2') +
  rect(64, 1231, 1072, 150, p.pale, 22) + txt(100, 1292, 'shared/ 定义跨进程契约', 37, '#355b8a', 600) + txt(100, 1346, '接口与校验规则在边界两侧复用', 34, p.mute) +
  txt(64, 1451, '职责示意 · 完整约束见 docs/architecture.md', 29, p.mute)
), { evidenceSources: ['docs/architecture.md', 'docs/development.md'], treatment: 'Explanatory diagram, not a runtime trace or new architecture proposal.' })

await save('getting-started-v2', frame(1200, 1550,
  heading('03 / 源码上手', '启动工作台与配置 Agent 分开', '先检查本地功能，再根据需要配置 AI。') +
  rect(64, 333, 1072, 230, '#fff', 22, p.line) + txt(98, 403, '01', 38, p.blue, 600) + txt(186, 403, '准备环境', 43, p.navy, 600) + txt(186, 467, `macOS 13+ · Node.js ${nodeVersion}`, 39, p.mute) + txt(186, 524, `pnpm ${pnpmVersion}（packageManager）`, 36, p.mute) +
  rect(64, 605, 1072, 320, '#fff', 22, p.line) + txt(98, 675, '02', 38, p.blue, 600) + txt(186, 675, '启动 Studio', 43, p.navy, 600) + txt(186, 735, '进入已克隆的源码目录', 35, p.mute) +
  rect(100, 771, 1000, 124, p.navy, 14) + txt(138, 819, 'pnpm install', 39, '#e6edf6', 500, 'font-family="ui-monospace,Menlo,monospace"') + txt(138, 871, 'pnpm dev', 39, '#e6edf6', 500, 'font-family="ui-monospace,Menlo,monospace"') +
  rect(64, 967, 1072, 337, '#fff', 22, p.line) + txt(98, 1037, '03', 38, p.blue, 600) + txt(186, 1037, '分别检查使用条件', 43, p.navy, 600) + txt(100, 1103, '先检查本地文件、文档和网页。', 37, p.mute) + txt(100, 1162, '使用 AI 时，再配置运行时与模型服务。', 37, p.mute) + txt(100, 1221, '通过工具调用和文件结果判断实际执行。', 37, p.mute) +
  rect(64, 1346, 1072, 94, p.pale, 20) + txt(600, 1406, '本地免 CCLink 登录；模型费用自行承担。', 34, '#3b5c7b', 500, 'text-anchor="middle"') +
  txt(64, 1510, '上手顺序示意 · 环境要求以仓库配置为准', 29, p.mute)
), { evidenceSources: ['package.json', '.github/workflows/ci.yml', 'README.md'], environment: { node: nodeVersion, pnpm: pnpmVersion }, treatment: 'Instructions and environment declaration, not a fresh-install success report.' })

const css = `
.community-article{max-width:960px;padding:50px 56px 64px;font-size:18px;line-height:1.95}.community-article h1{font-size:34px;line-height:1.5;letter-spacing:-.4px;margin-bottom:30px}.community-article h1 .nowrap{white-space:nowrap}.community-article h2{font-size:25px;line-height:1.6;margin:48px 0 22px}.community-article p{margin:21px 0}.community-article figure{margin:32px auto 12px;max-width:680px}.community-article figure:first-of-type{max-width:none;margin:0 0 30px}.community-article figure img{border:0;border-radius:5px}.community-article p:has(>em:only-child){font-size:13px;line-height:1.8;color:#647783;margin:12px 0 28px}.community-article table{font-size:15px;line-height:1.85;table-layout:fixed}.community-article td:first-child,.community-article th:first-child{width:24%;min-width:0;font-weight:550}.community-article td,.community-article th{padding:14px 15px;overflow-wrap:anywhere}.community-article pre{font-size:14px;line-height:1.95;margin:28px 0;tab-size:2}.community-article li{margin:16px 0}.community-article code{overflow-wrap:anywhere}.community-meta,.community-bottom{max-width:960px}.revision-tag{color:#4273bf}
@media(max-width:680px){.community-article{padding:28px 23px 42px;font-size:17px;line-height:1.95}.community-article h1{font-size:26px;line-height:1.5;letter-spacing:0;margin-bottom:25px}.community-article h2{font-size:22px;margin:38px 0 20px}.community-article p{margin:20px 0}.community-article figure{margin:27px -11px 10px;max-width:none}.community-article figure:first-of-type{margin:0 -11px 27px}.community-article table{font-size:14px;line-height:1.8}.community-article td:first-child,.community-article th:first-child{width:27%}.community-article td,.community-article th{padding:12px 9px}.community-article pre{font-size:12px;padding:18px;white-space:pre-wrap;overflow-wrap:anywhere}.community-article p:has(>em:only-child){font-size:12px;margin-bottom:25px}.community-article ol{padding-left:1.45em}.community-meta,.community-bottom{line-height:1.8}}
@media print{.community-article{padding:0;max-width:none}.community-article figure{max-width:500px;break-inside:avoid}.community-article table{font-size:10pt}}
`
await writeFile(join(target, 'style.css'), css.trim() + '\n')
let body = marked.parse(markdown).replace(/<p>\s*<img src="([^"]+)" alt="([^"]*)"[^>]*>\s*<\/p>/g, (_, src, alt) => `<figure><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${alt}" loading="eager" decoding="async"></a></figure>`)
body = body.replace('<h1>CCLink Studio：连接文件、网页与 Agent 的开源桌面工作台</h1>', '<h1>CCLink Studio：连接文件、网页与 Agent 的<span class="nowrap">开源桌面工作台</span></h1>')
for (const [id, label] of [['capabilities', '当前可以做什么'], ['architecture', '技术栈与源码职责'], ['start', '从源码启动'], ['try', '第一次可以怎样试'], ['contribute', '欢迎参与改进']]) body = body.replace(`<h2>${label}</h2>`, `<h2 id="${id}">${label}</h2>`)
await writeFile(join(target, 'preview.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self'; font-src 'self';"><title>CCLink Studio 开源社区精修稿</title><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="style.css"></head><body><header class="top"><a class="wordmark" href="../index.html"><img src="../../resources/icon.png" alt="">CCLink Studio</a><nav><a href="article.md">正文</a><a class="secondary" href="paragraph-review.md">逐段修订</a><a href="../index.html">返回总览</a></nav></header><div class="preview-meta community-meta"><span>GitHub 与开源社区</span><span class="revision-tag">图文精修稿 v2</span></div><main class="article community-article">${body}</main><footer class="bottom community-bottom"><a href="article.md">打开可编辑正文</a><a href="paragraph-review.md">查看逐段修订说明</a><a href="preview-v1.html">对照初稿</a></footer></body></html>`)

const manifestPath = join(kit, 'assets/asset-manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.assets = [...manifest.assets.filter(a => a.scope !== 'open-source-v2'), ...newAssets]
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
const indexPath = join(kit, 'index.html')
let index = await readFile(indexPath, 'utf8')
index = index.replace('src="assets/graphics/capability-map.png" alt="GitHub 与开源社区预览"', 'src="02-open-source/images/cover-v2.png" alt="GitHub 与开源社区预览"')
index = index.replace('交代当前本地能力、技术栈、启动方式和参与入口。', '逐段讲清能力、源码职责、启动环境和参与方式，配合真实界面与职责简图。')
index = index.replace('公众号已逐段精修并保留初稿对照，可先核定这一版，再推进其余三版。材料均在本地保存，尚未公开发布。', '公众号与开源社区版已逐段精修并保留初稿对照，官网和社交媒体版仍为初稿。材料均在本地保存，尚未公开发布。')
await writeFile(indexPath, index)
console.log(JSON.stringify({ scope: 'open-source-v2', graphics: newAssets.length, environment: { node: nodeVersion, pnpm: pnpmVersion }, output: target }))
