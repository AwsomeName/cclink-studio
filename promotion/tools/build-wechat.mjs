import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { marked } from 'marked'

const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(kit, '01-wechat')
const require = createRequire(import.meta.url)
let sharp
try { sharp = require('sharp') } catch {
  sharp = createRequire(join(process.env.PROMOTION_NODE_MODULES || '/Users/apple/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules', 'promotion-entry.cjs'))('sharp')
}
const palette = { paper: '#f5f3ee', navy: '#1c2d40', ink: '#293e4c', blue: '#427de4', mute: '#617582', line: '#d5dddf', pale: '#e8eef7' }
const font = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const txt = (x, y, label, size = 34, fill = palette.ink, weight = 400, attrs = '') => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${attrs}>${esc(label)}</text>`
const rect = (x, y, w, h, fill, r = 0, stroke = 'none') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`
const rule = (x1, y1, x2, y2, color = palette.line, width = 2) => `<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}"/>`
const img = (x, y, w, h, source) => `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${source}"/>`
const png = async path => `data:image/png;base64,${(await readFile(path)).toString('base64')}`
const jpeg = async path => `data:image/jpeg;base64,${(await readFile(path)).toString('base64')}`
const icon = await png(join(kit, '../resources/icon.png'))
const writing = await jpeg(join(kit, 'assets/screenshots/studio-writing.jpg'))
const browser = await jpeg(join(kit, 'assets/screenshots/studio-browser.jpg'))
const originalWriting = 'assets/screenshots/studio-writing.jpg'
const originalBrowser = 'assets/screenshots/studio-browser.jpg'
const frame = (w, h, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${rect(0, 0, w, h, palette.paper)}<g font-family="${font}">${content}</g></svg>`
const brand = (y = 44) => img(52, y, 54, 54, icon) + txt(122, y + 38, 'CCLink Studio', 30, palette.navy, 650)
const heading = (kicker, title, subtitle) => brand() + txt(1148, 80, kicker, 23, palette.mute, 500, 'text-anchor="end"') + rule(52, 130, 1148, 130) + txt(52, 218, title, 52, palette.navy, 650) + (subtitle ? txt(52, 278, subtitle, 31, palette.mute) : '')

// 原始截图作为只读图像嵌入。局部视窗仅改变取景，不重画或替换界面文字与运行状态。
const crop = (source, x, y, w, h, sourceX, sourceY, sourceW, sourceH) => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${sourceX} ${sourceY} ${sourceW} ${sourceH}" preserveAspectRatio="xMidYMid meet" overflow="hidden">${img(0, 0, 2800, 1740, source)}</svg>`
const newAssets = []
await mkdir(join(target, 'images'), { recursive: true })
async function save(name, source, extra = {}) {
  const path = join(target, 'images', name)
  await writeFile(path + '.svg', source)
  await sharp(Buffer.from(source)).png({ compressionLevel: 9 }).toFile(path + '.png')
  const data = await readFile(path + '.png')
  const meta = await sharp(data).metadata()
  newAssets.push({ file: `01-wechat/images/${name}.png`, source: `01-wechat/images/${name}.svg`, kind: 'editorial-graphic', scope: 'wechat-v2', width: meta.width, height: meta.height, sha256: createHash('sha256').update(data).digest('hex'), ...extra })
}

await save('cover-v2', frame(1200, 675,
  brand(42) + txt(1148, 80, '开源 AI 桌面工作台', 26, palette.mute, 500, 'text-anchor="end"') + rule(52, 132, 1148, 132) +
  txt(52, 268, '查资料，写文档', 70, palette.navy, 650) + txt(52, 365, '和 AI 一起动手', 70, palette.navy, 650) +
  txt(56, 438, '从一个本地工作空间开始', 30, palette.mute) +
  rect(54, 493, 174, 48, palette.pale, 24) + txt(141, 526, '本地优先', 26, '#3d5d7d', 500, 'text-anchor="middle"') +
  rect(242, 493, 228, 48, palette.pale, 24) + txt(356, 526, 'GPL-3.0-only', 26, '#3d5d7d', 500, 'text-anchor="middle"') +
  rect(826, 211, 322, 340, palette.navy, 24) + txt(987, 268, '工作空间', 34, '#fff', 550, 'text-anchor="middle"') +
  [['参考网页', '#fff'], ['本地文档', '#fff'], ['AI 协作', '#d9e7fe']].map(([label, fill], i) => rect(854, 298 + i * 74, 266, 58, fill, 12) + txt(987, 338 + i * 74, label, 30, palette.navy, 550, 'text-anchor="middle"')).join('') +
  rule(52, 593, 1148, 593) + txt(52, 640, '把网页、文档与 AI 协作放在一起', 26, palette.mute) + txt(1148, 640, '工作方式示意', 22, palette.mute, 400, 'text-anchor="end"')
))

await save('workspace-guide-v2', frame(1200, 1370,
  heading('01 / 工作台导览', '一眼看清材料、文档与 Agent', '') +
  [ [220, '01 本地资料'], [654, '02 当前文档'], [1020, '03 Agent'] ].map(([x, label]) => txt(x, 296, label, 31, palette.blue, 550, 'text-anchor="middle"')).join('') +
  img(48, 333, 1104, 686.057, writing) +
  rule(52, 1056, 1148, 1056) +
  [['01', '找到材料', '打开笔记、提纲和草稿'], ['02', '继续写作', '阅读、修改与保存文档'], ['03', '交代任务', '准备这一次的协作指令']].map(([n, title, detail], i) => txt(52, 1110 + i * 88, n, 36, palette.blue, 600) + txt(124, 1110 + i * 88, title, 40, palette.navy, 600) + txt(356, 1110 + i * 88, detail, 38, palette.mute)).join('') +
  txt(52, 1340, '真实开发版界面 · 演示文档 · Agent 指令待发送', 27, palette.mute)
), { inputSources: [originalWriting], treatment: 'Full unaltered screenshot with external area labels.' })

await save('task-detail-v2', frame(1200, 860,
  heading('02 / 任务特写', '先说清这次要做什么', '把目标、保留的观点和补充要求写进任务。') +
  crop(writing, 64, 333, 1072, 449.294, 2110, 1400, 680, 285) +
  txt(64, 830, '真实任务输入区局部 · 演示材料 · 指令尚未发送', 29, palette.mute)
), { inputSources: [originalWriting], treatment: 'Labelled task-input viewport; original screenshot is preserved and no output or execution status is fabricated.', sourceCrops: [[2110, 1400, 680, 285]] })

await save('browser-detail-v2', frame(1200, 1170,
  heading('03 / 浏览器特写', '资料页与草稿可以来回切换', '同一工作空间里的两个标签页。') +
  crop(browser, 64, 333, 1072, 641.521, 308, 88, 1788, 1070) +
  rect(64, 1012, 1072, 76, palette.pale, 16) + txt(600, 1063, '参考网页  ↔  Markdown 草稿', 35, '#3b5c7b', 550, 'text-anchor="middle"') +
  txt(64, 1136, '真实浏览器区域局部 · 网页为原创演示材料', 29, palette.mute)
), { inputSources: [originalBrowser], treatment: 'Labelled viewport retaining the original document/browser tabs and actual page.', sourceCrops: [[308, 88, 1788, 1070]] })

const steps = [
  ['01', '准备材料', '你', '打开参考网页，整理本地笔记与提纲。'],
  ['02', '交代任务', '你', '指定参考材料、目标文档和修改要求。'],
  ['03', '工具协作', 'Agent', '配置完成后，按授权读取、写入或操作。'],
  ['04', '检查保存', '你', '核对事实与表达，把成果保存为文件。'],
]
await save('workflow-v2', frame(1200, 1430,
  heading('04 / 协作方式示意', '每一环都有清楚的分工', '从准备材料，到检查和保存。') +
  steps.map(([n, title, actor, detail], i) => {
    const y = 338 + i * 236
    return rect(64, y, 1072, 200, '#fff', 22, palette.line) + txt(98, y + 65, n, 38, palette.blue, 600) + txt(186, y + 68, title, 43, palette.navy, 600) + rect(934, y + 27, 170, 52, palette.pale, 26) + txt(1019, y + 63, actor, 31, '#3e5f80', 500, 'text-anchor="middle"') + txt(186, y + 141, detail, 38, palette.mute) + (i < 3 ? txt(600, y + 229, '↓', 30, '#95abc2', 500, 'text-anchor="middle"') : '')
  }).join('') +
  txt(64, 1350, 'Agent 需配置运行时与模型服务；网页操作受站点条件影响。', 29, palette.mute) + txt(64, 1396, '示意图说明协作方式，不是任务执行记录。', 29, palette.mute)
))

const css = `
.wechat-article{max-width:940px;padding:50px 58px 64px;font-size:18px;line-height:1.95}.wechat-article h1{font-size:35px;line-height:1.5;letter-spacing:-.5px;margin-bottom:30px}.wechat-article h1 .nowrap{white-space:nowrap}.wechat-article h2{font-size:25px;line-height:1.6;margin:50px 0 22px}.wechat-article p{margin:21px 0}.wechat-article figure{margin:34px auto 12px;max-width:680px}.wechat-article figure:first-of-type{max-width:none;margin:0 0 32px}.wechat-article figure img{border:0;border-radius:5px}.wechat-article blockquote{padding:7px 24px;margin:28px 0;border-left:3px solid #427de4;background:#eef3fb;color:#264568;font-size:19px;line-height:1.9}.wechat-article blockquote p{margin:13px 0}.wechat-article p:has(>em:only-child){font-size:13px;line-height:1.75;color:#647783;margin:12px 0 30px}.wechat-meta{max-width:940px}.wechat-bottom{max-width:940px}.revision-tag{color:#4273bf}.wechat-article .source-link{overflow-wrap:anywhere}
@media(max-width:680px){.wechat-article{padding:28px 23px 42px;font-size:17px;line-height:1.95}.wechat-article h1{font-size:27px;line-height:1.5;margin-bottom:25px;letter-spacing:0}.wechat-article h2{font-size:22px;margin:38px 0 20px}.wechat-article p{margin:20px 0}.wechat-article figure{margin:28px -11px 10px;max-width:none}.wechat-article figure:first-of-type{margin:0 -11px 28px}.wechat-article blockquote{font-size:17px;padding:5px 18px;margin:24px 0}.wechat-article p:has(>em:only-child){font-size:12px;margin-bottom:25px}.wechat-meta{line-height:1.7}.wechat-bottom{line-height:1.8}}
@media print{.wechat-article{padding:0;max-width:none}.wechat-article figure{max-width:500px;break-inside:avoid}}
`
await writeFile(join(target, 'style.css'), css.trim() + '\n')
const markdown = await readFile(join(target, 'article.md'), 'utf8')
let body = marked.parse(markdown).replace(/<p>\s*<img src="([^"]+)" alt="([^"]*)"[^>]*>\s*<\/p>/g, (_, src, alt) => `<figure><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${alt}" loading="eager" decoding="async"></a></figure>`)
body = body.replace('<h1>CCLink Studio 查资料写文档的开源 AI 工作台</h1>', '<h1>CCLink Studio 查资料<span class="nowrap">写文档</span>的开源 AI 工作台</h1>')
for (const [id, heading] of [['workspace', '先把资料和草稿放在手边'], ['agent', '让 AI 对着这份材料动手'], ['browser', '网页就在旁边 需要时可以接手'], ['workflow', '从准备材料到检查保存'], ['setup', '本地能力免费 按自己的需要配置 AI'], ['start', '从一个具体任务开始试用']]) {
  body = body.replace(`<h2>${heading}</h2>`, `<h2 id="${id}">${heading}</h2>`)
}
const title = 'CCLink Studio 公众号精修稿'
await writeFile(join(target, 'preview.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self'; font-src 'self';"><title>${title}</title><link rel="stylesheet" href="../assets/style.css"><link rel="stylesheet" href="style.css"></head><body><header class="top"><a class="wordmark" href="../index.html"><img src="../../resources/icon.png" alt="">CCLink Studio</a><nav><a href="article.md">正文</a><a class="secondary" href="paragraph-review.md">逐段修订</a><a href="../index.html">返回总览</a></nav></header><div class="preview-meta wechat-meta"><span>公众号与项目首发</span><span class="revision-tag">图文精修稿 v2</span></div><main class="article wechat-article">${body}</main><footer class="bottom wechat-bottom"><a href="article.md">打开可编辑正文</a><a href="paragraph-review.md">查看逐段修订说明</a><a href="preview-v1.html">对照初稿</a></footer></body></html>`)

const manifestPath = join(kit, 'assets/asset-manifest.json')
let manifest
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch { manifest = { date: '2026-10-16', assets: [] } }
manifest.assets = [...manifest.assets.filter(a => a.scope !== 'wechat-v2'), ...newAssets]
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
const indexPath = join(kit, 'index.html')
try {
  let index = await readFile(indexPath, 'utf8')
  index = index.replace('src="assets/graphics/cover-wide.png" alt="公众号与项目首发预览"', 'src="01-wechat/images/cover-v2.png" alt="公众号与项目首发预览"')
  index = index.replace('从日常工作的麻烦讲起，介绍工作空间、Agent 协作和使用条件。', '围绕一篇文章逐段精修，配合工作台导览、真实特写和竖向分工图。')
  index = index.replace('建议先审公众号版的定位和表达，再确认社区版的能力范围，最后定官网首屏与社交媒体图卡。所有稿件均为本地图文初稿，尚未公开发布。', '公众号已逐段精修并保留初稿对照，可先核定这一版，再推进其余三版。材料均在本地保存，尚未公开发布。')
  await writeFile(indexPath, index)
} catch { /* 可单独生成公众号资料，不要求总览已存在。 */ }
console.log(JSON.stringify({ scope: 'wechat-v2', graphics: newAssets.length, output: target }))
